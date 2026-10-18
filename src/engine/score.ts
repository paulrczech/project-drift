// A drift as a score: what a DAW wants. The same performer that plays a drift (same plan, same
// seed, same tempo) is asked for its notes, but a pad's re-strikes are put back together into the
// long notes the harmony really holds, split by section for the orchestra. Pure: no Tone.

import { LADDER } from './drift'
import { Composer, arousalAt, type TimelinePlan } from './compose'
import { PulseComposer, START } from './pulse'
import { mulberry } from './rng'
import { performerFor } from './performer'
import { routeNote, type Voice } from './voices'

export interface ScoreNote {
  midi: number
  time: number // seconds
  duration: number
  velocity: number // 0-1
}

export interface ScoreTrack {
  name: string
  program: number // General MIDI program, 0-127
  notes: ScoreNote[]
}

export interface Score {
  bpm: number
  tracks: ScoreTrack[]
  markers: { time: number; text: string }[] // the mode as it changes
  duration: number
  key: string
  modes: string[] // the mode of each stop, in order (consecutive repeats merged)
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Sounds with no beat (the pad, the sections) are written at 60 BPM, so a beat is a second and
// the notes sit where they sounded.
const FREE_BPM = 60
// An endless journey has no end to export: its walk, then this much of the final mode.
export const ENDLESS_TAIL = 60
const PAD_PROGRAM = 89 // GM "Pad 2 (warm)"
const PROGRAMS: Record<string, number> = {
  basses: 43, // contrabass
  celli: 42,
  violas: 41,
  violins: 40,
  horns: 60, // french horn
  clarinets: 71,
  flutes: 73,
  choir: 52, // choir aahs
  'choir-female': 52,
  'choir-male': 52,
  pulse: 81, // lead 2 (sawtooth)
}
const VELOCITY = 0.8 // as the player

export function scoreFor(
  voice: Voice,
  plan: Omit<TimelinePlan, 'rng'>,
  seed: number,
  tempo: { bpm?: number } = {}
): Score {
  // a finite copy of the plan
  const waypoints = plan.waypoints.map((w) => ({ ...w, hold: Number.isFinite(w.hold) ? w.hold : ENDLESS_TAIL }))
  const finite = { ...plan, waypoints }
  const performer = performerFor(voice, finite, mulberry(seed), tempo)
  const layout = performer.layout
  const events = performer.pull(Infinity)
  const tracks: ScoreTrack[] = []
  let bpm = FREE_BPM

  if (performer instanceof PulseComposer) {
    bpm = performer.bpm
    const notes: ScoreNote[] = []
    for (const e of events) {
      const r = routeNote(voice, e.note, arousalAt(layout, e.time))[0]
      if (!r) continue
      notes.push({
        midi: r.note,
        time: Math.max(0, e.time - START),
        duration: e.hold,
        velocity: Math.min(1, VELOCITY * (e.velocity ?? 1) * r.velocity),
      })
    }
    // a repeated pitch rings into its next strike in the sampler; in a DAW that would be an overlap
    // of the same note, which many instruments cut short or drop, so each ends where the next begins
    const nextOf = new Map<number, ScoreNote>()
    for (const n of [...notes].reverse()) {
      const next = nextOf.get(n.midi)
      if (next && n.time + n.duration > next.time) n.duration = Math.max(0.05, next.time - n.time - 0.005)
      nextOf.set(n.midi, n)
    }
    tracks.push({ name: voice.label, program: PROGRAMS[voice.id] ?? PROGRAMS.pulse, notes })
  } else if (performer instanceof Composer) {
    const loudest = Math.max(...voice.layers.map((l) => l.gain))
    const byLayer = new Map<string, ScoreTrack>()
    for (const layer of voice.layers)
      byLayer.set(layer.id, {
        name: voice.layers.length > 1 ? layer.id : voice.label,
        program: PROGRAMS[layer.id] ?? PAD_PROGRAM,
        notes: [],
      })
    for (const h of [...performer.held].sort((a, b) => a.start - b.start || a.note - b.note)) {
      for (const r of routeNote(voice, h.note, arousalAt(layout, h.start))) {
        byLayer.get(r.layer.id)!.notes.push({
          midi: r.note,
          time: h.start,
          // a hair short, so a voice that hands a pitch on does not make the same note overlap itself
          duration: Math.max(0.1, h.end - h.start - 0.01),
          velocity: voice.layers.length > 1 ? Math.min(1, Math.max(0.2, (r.velocity / loudest) * 0.85)) : 0.7,
        })
      }
    }
    tracks.push(...[...byLayer.values()].filter((t) => t.notes.length))
  }

  // the mode, wherever it changes
  let rung = waypoints[0].rung
  const markers = [{ time: 0, text: LADDER[rung] }]
  for (const f of layout.flips) {
    rung += f.dir
    const last = markers[markers.length - 1]
    if (f.time - last.time < 1e-6) last.text = LADDER[rung]
    else markers.push({ time: f.time, text: LADDER[rung] })
  }
  const modes = waypoints.map((w) => LADDER[w.rung]).filter((m, i, a) => m !== a[i - 1])
  return { bpm, tracks, markers, duration: layout.duration, key: NOTE_NAMES[plan.tonic ?? 2], modes }
}
