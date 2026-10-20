// A drift as a score: what a DAW wants. The same performer that plays a drift (same plan, same
// seed, same tempo) is asked for its notes, but a pad's re-strikes are put back together into the
// long notes the harmony really holds, split by section for the orchestra. Pure: no Tone.

import { LADDER } from './drift'
import { Composer, arousalAt, downbeat, stateAt, textIndexAt, type TimelinePlan } from './compose'
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
  cuts: Cut[] // where the music can be cut into clips (empty: nowhere — sustained voices in free time)
  sections: { name: string; time: number }[] // a sketch's named sections, where each is arrived at (the file's seconds)
  heldCuts: boolean // a note held across a cut is kept in the clips either side (sustained voices); else only notes that begin in a clip
}

// A stretch of the file that makes a clip: a cluster on bars (sustained voices) or a four-bar phrase
// (the pulse). Times are the file's, in seconds.
export interface Cut {
  start: number
  end: number
  stop: number // the stop whose section it falls in (the readout's switch: the middle of each walk)
  mode: string // the mode (and key) it begins in; "a to b" when it changes inside
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
  const performer = performerFor(voice, finite, mulberry(seed), tempo, seed)
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
  // where clusters (or, for the pulse, patterns) on bars begin, change their rhythm, or give way to free time
  const what = performer instanceof PulseComposer ? 'pattern' : 'chords'
  if (layout.barSeconds)
    layout.bars.forEach((b, i) => {
      if (i && b === layout.bars[i - 1]) return
      if (!i && !b) return
      // a stop's setting takes over at the middle of the walk to it; clusters then change on the next downbeat of its grid
      const w = layout.walks[i - 1]
      const mid = w ? (w.start + w.end) / 2 : START
      markers.push({ time: Math.max(0, (b ? downbeat(layout, mid, b) : mid) - START), text: b ? `${what} every ${b} bar${b > 1 ? 's' : ''}` : `${what} free` })
    })
  // where a pulse changes its grid
  if (performer instanceof PulseComposer)
    for (const sw of performer.switches) markers.push({ time: Math.max(0, sw.time - START), text: `grid ${GRID_LABEL[sw.grid]}` })
  // where a sketch's sections begin (pushed last, so the mode marker stays the first at a time)
  const sections = layout.sections.filter((s) => s.name).map((s) => ({ name: s.name, time: Math.max(0, s.time - START) }))
  for (const s of sections) markers.push({ time: s.time, text: `section ${s.name}` })
  markers.sort((a, b) => a.time - b.time)

  // where the music can be cut into clips
  const cuts: Cut[] = []
  const cut = (from: number, to: number) => {
    const a = stateAt(layout, from)
    const b = stateAt(layout, to - 1e-6)
    const first = name(a.rung, a.tonic)
    const last = name(b.rung, b.tonic)
    cuts.push({ start: Math.max(0, from - START), end: to - START, stop: textIndexAt(layout, from), mode: first === last ? first : `${first} to ${last}` })
  }
  if (performer instanceof Composer) {
    // each cluster lasts its bars, or until the next one (the grid may change under it), or the end
    const cs = performer.clusters
    cs.forEach((c, i) => {
      if (!c.bars) return
      const to = Math.min(cs[i + 1]?.time ?? Infinity, c.time + c.bars * layout.barSeconds, layout.duration)
      if (to - c.time > 0.5) cut(c.time, to)
    })
  } else if (performer instanceof PulseComposer) {
    // a pattern on bars lasts its bars; elsewhere, four-bar phrases (the cell is one bar; the grid only
    // changes on a phrase line)
    const phrase = 4 * (240 / performer.bpm)
    const cs = performer.clusters
    let ci = 0
    for (let from = START; from < layout.duration - 0.5; ) {
      while (ci < cs.length && cs[ci].time < from - 1e-4) ci++
      const here = cs[ci] && Math.abs(cs[ci].time - from) < 1e-4
      const next = cs[ci + (here ? 1 : 0)]?.time ?? Infinity
      const to = Math.min(from + (here ? cs[ci].bars * layout.barSeconds : phrase), next, layout.duration)
      cut(from, to)
      from = to
    }
  }
  const modes = waypoints.map((w, i) => name(w.rung, layout.tonics[i])).filter((m, i, a) => m !== a[i - 1])
  return { bpm, tracks, markers, duration: layout.duration, key: NOTE_NAMES[layout.tonic0], uniformKey, modes, cuts, sections, heldCuts: performer instanceof Composer }
}

// ── clips ───────────────────────────────────────────────────────────────────────────
// A score cut into clips for a DAW's clip view (Ableton Session View, Logic Live Loops): one per
// cut, each a whole number of bars from its own start, notes clipped at its end. Clips whose notes
// repeat exactly are one clip, used again; `slots` is the order they play in.

export interface Clip {
  bpm: number
  bars: number
  stop: number
  mode: string
  tracks: ScoreTrack[] // notes from 0
}

export interface ClipSlot {
  clip: number // index into `clips`
  bar: number // the bar it begins on in the whole journey, from 1
  stop: number
  section: number // index into the score's sections (-1: before the first, or none)
}

export function clipsOf(score: Score): { clips: Clip[]; slots: ClipSlot[] } {
  const barSeconds = 240 / score.bpm
  const clips: Clip[] = []
  const slots: ClipSlot[] = []
  const seen = new Map<string, number>()
  for (const cut of score.cuts) {
    const bars = Math.max(1, Math.ceil((cut.end - cut.start) / barSeconds - 0.02))
    const end = cut.start + bars * barSeconds
    const tracks: ScoreTrack[] = []
    for (const t of score.tracks) {
      const notes: ScoreNote[] = []
      for (const n of t.notes) {
        const kept = score.heldCuts ? n.time < end - 1e-6 && n.time + n.duration > cut.start + 0.05 : n.time >= cut.start - 1e-6 && n.time < end - 1e-6
        if (!kept) continue
        const time = Math.max(n.time, cut.start)
        const duration = Math.min(n.time + n.duration, end) - time
        if (duration >= 0.05) notes.push({ midi: n.midi, time: time - cut.start, duration, velocity: n.velocity })
      }
      if (notes.length) tracks.push({ ...t, notes })
    }
    if (!tracks.length) continue
    // the same notes at the same places are the same clip (loudness aside)
    const key = `${bars}|${tracks.map((t) => t.name + ':' + t.notes.map((n) => `${n.midi}@${Math.round(n.time * 100)}+${Math.round(n.duration * 100)}`).join(',')).join(';')}`
    let at = seen.get(key)
    if (at === undefined) {
      at = clips.length
      seen.set(key, at)
      clips.push({ bpm: score.bpm, bars, stop: cut.stop, mode: cut.mode, tracks })
    } else {
      // the louder of the two, so a note that was easing in is not what the clip keeps
      clips[at].tracks.forEach((t, k) => t.notes.forEach((n, j) => (n.velocity = Math.max(n.velocity, tracks[k].notes[j].velocity))))
    }
    slots.push({ clip: at, bar: Math.round(cut.start / barSeconds) + 1, stop: cut.stop, section: score.sections.filter((x) => x.time <= cut.start + 1e-3).length - 1 })
  }
  return { clips, slots }
}
