// A journey as a small JSON file: enough to rebuild it exactly (the same stops, length, key, tempo,
// sound and seed give the same music), and to open it again later or on another device.

import { BPM_MAX, BPM_MIN } from '../engine/pulse'
import { NOTE_NAMES, SHARP_NAMES } from '../engine/score'

export const PROJECT_VERSION = 1

export interface Project {
  drift: number // the file format's version
  // in journey order; `word` is only a label; `root` is the stop's key (0 = C … 11 = B), or null for
  // the same as the stop before (the first stop's is the project's `root`)
  stops: { valence: number; arousal: number; word: string; root: number | null }[]
  minutes: number | 'endless'
  key: string // e.g. "F#" (informational; `root` is what is read)
  root: number // 0 = C … 11 = B
  voice: string // a voice id: pad, voices, orchestra, pulse…
  bpm: number | null // the pulse's tempo; null for sounds without a beat
  seed: number
  modes: string[] // the mode of each stop (informational)
}

export interface Opened {
  stops: { v: number; a: number; key?: number }[]
  minutes: number
  root: number
  voice: string
  bpm: number | null
  seed: number
}

export function toProject(d: {
  points: { v: number; a: number; key?: number }[]
  words: string[]
  minutes: number
  root: number
  voice: string
  bpm?: number
  seed: number
  modes: string[]
}): Project {
  return {
    drift: PROJECT_VERSION,
    stops: d.points.map((p, i) => ({ valence: round(p.v), arousal: round(p.a), word: d.words[i], root: i === 0 ? d.root : p.key ?? null })),
    minutes: Number.isFinite(d.minutes) ? d.minutes : 'endless',
    key: NOTE_NAMES[d.root],
    root: d.root,
    voice: d.voice,
    bpm: d.bpm ?? null,
    seed: d.seed,
    modes: d.modes,
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

// Reads a project file; anything that is not one is turned away with a reason a person can read.
export function parseProject(
  text: string,
  limits: { lengths: number[]; maxStops: number }
): { ok: true; project: Opened } | { ok: false; reason: string } {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'That file is not a Drift project.' }
  }
  if (!raw || typeof raw !== 'object' || !isNum(raw.drift)) return { ok: false, reason: 'That file is not a Drift project.' }
  if (raw.drift > PROJECT_VERSION) return { ok: false, reason: 'That project was made by a newer version of Drift.' }
  if (!Array.isArray(raw.stops) || !raw.stops.length) return { ok: false, reason: 'That project has no stops.' }
  const stops = raw.stops.slice(0, limits.maxStops).map((s: any, i: number) => ({
    v: s?.valence,
    a: s?.arousal,
    // a key on the first stop is the project's own root; files from before stop keys have none
    key: i > 0 && Number.isInteger(s?.root) && s.root >= 0 && s.root <= 11 ? (s.root as number) : undefined,
  }))
  if (!stops.every((s: { v: unknown; a: unknown; key?: number }) => isNum(s.v) && isNum(s.a) && s.v >= 0 && s.v <= 1 && s.a >= 0 && s.a <= 1))
    return { ok: false, reason: 'That project has a stop that is not on the field.' }
  const named = (n: unknown) => Math.max(NOTE_NAMES.indexOf(String(n)), SHARP_NAMES.indexOf(String(n)))
  const root = Number.isInteger(raw.root) && raw.root >= 0 && raw.root <= 11 ? raw.root : named(raw.key)
  if (root < 0) return { ok: false, reason: 'That project has no key.' }
  if (!isNum(raw.seed)) return { ok: false, reason: 'That project has no seed.' }
  const wanted = raw.minutes === 'endless' ? Infinity : isNum(raw.minutes) && raw.minutes > 0 ? raw.minutes : NaN
  if (Number.isNaN(wanted)) return { ok: false, reason: 'That project has no length.' }
  // the lengths offered change over time: take the nearest one we have now
  const { lengths } = limits
  const minutes = lengths.includes(wanted)
    ? wanted
    : wanted === Infinity
      ? Infinity
      : lengths.filter(Number.isFinite).reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a))
  const bpm = isNum(raw.bpm) ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(raw.bpm))) : null
  return {
    ok: true,
    project: { stops, minutes, root, voice: typeof raw.voice === 'string' ? raw.voice : '', bpm, seed: Math.floor(raw.seed) },
  }
}
