// A drift as a score: what a DAW wants. The same performer that plays a drift (same plan, same
// seed, same tempo) is asked for its notes, but a pad's re-strikes are put back together into the
// long notes the harmony really holds, split by section for the orchestra. Pure: no Tone.

import { LADDER } from './drift'
import { Composer, arousalAt, downbeat, stateAt, type TimelinePlan } from './compose'
import { GRID_LABEL, PulseComposer, START, clampBpm } from './pulse'
import { mulberry } from './rng'
import { performerFor, type Tempo } from './performer'
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
  key: string // the key it starts in
  uniformKey: boolean // false when the journey changes key (then each mode label carries its key)
  modes: string[] // the mode (and, if the key changes, key) of each stop, in order (repeats merged)
}

// Key names as musicians write them (Eb major, not D# major); F# is the one sharp.
export const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
// the sharp spellings, accepted when reading files and text
export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Sounds with no beat (the pad, the sections) are written at the journey's tempo when there is
// one (so files of every sound line up in a DAW: a mode change falls on the same bar and beat in
// each), else at 60 BPM, where a beat is a second. Their notes sit where they sounded either way.
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
  tempo: Tempo = {}
): Score {
  // a finite copy of the plan
  const waypoints = plan.waypoints.map((w) => ({ ...w, hold: Number.isFinite(w.hold) ? w.hold : ENDLESS_TAIL }))
  const finite = { ...plan, waypoints }
  const performer = performerFor(voice, finite, mulberry(seed), tempo)
  const layout = performer.layout
  const events = performer.pull(Infinity)
  const tracks: ScoreTrack[] = []
  let bpm = tempo.bpm ? clampBpm(tempo.bpm) : FREE_BPM
  // The pulse's first pulse sits at 0 (it sounds START seconds into the drift), so every file is shifted
  // by START: a mode change then falls at the same time in the pulse's file as in the pad's.

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
          time: Math.max(0, h.start - START),
          // a hair short, so a voice that hands a pitch on does not make the same note overlap itself
          duration: Math.max(0.1, h.end - Math.max(START, h.start) - 0.01),
          velocity: voice.layers.length > 1 ? Math.min(1, Math.max(0.2, (r.velocity / loudest) * 0.85)) : 0.7,
        })
      }
    }
    tracks.push(...[...byLayer.values()].filter((t) => t.notes.length))
  }

  // the mode (and key, if it changes), wherever either changes
  const uniformKey = layout.tonics.every((t) => t === layout.tonics[0])
  const name = (rung: number, tonic: number) => `${uniformKey ? '' : NOTE_NAMES[tonic] + ' '}${LADDER[rung]}`
  const markers = [{ time: 0, text: name(layout.rung0, layout.tonic0) }]
  for (const f of layout.flips) {
    const now = stateAt(layout, f.time) // every step at this instant included
    const last = markers[markers.length - 1]
    const text = name(now.rung, now.tonic)
    const time = Math.max(0, f.time - START)
    if (time - last.time < 1e-6) last.text = text
    else markers.push({ time, text })
  }
  // where clusters on bars begin, change their rhythm, or give way to free time
  if (performer instanceof Composer && layout.barSeconds)
    layout.bars.forEach((b, i) => {
      if (i && b === layout.bars[i - 1]) return
      if (!i && !b) return
      // a stop's setting takes over at the middle of the walk to it; clusters then change on the next downbeat of its grid
      const w = layout.walks[i - 1]
      const mid = w ? (w.start + w.end) / 2 : START
      markers.push({ time: Math.max(0, (b ? downbeat(layout, mid, b) : mid) - START), text: b ? `chords every ${b} bar${b > 1 ? 's' : ''}` : 'chords free' })
    })
  // where a pulse changes its grid
  if (performer instanceof PulseComposer)
    for (const sw of performer.switches) markers.push({ time: Math.max(0, sw.time - START), text: `grid ${GRID_LABEL[sw.grid]}` })
  markers.sort((a, b) => a.time - b.time)
  const modes = waypoints.map((w, i) => name(w.rung, layout.tonics[i])).filter((m, i, a) => m !== a[i - 1])
  return { bpm, tracks, markers, duration: layout.duration, key: NOTE_NAMES[layout.tonic0], uniformKey, modes }
}
