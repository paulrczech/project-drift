// The second way to play a drift: an ostinato. Where the pad lets chords swell and move in
// free time, this keeps a quiet, steady pulse — a short cell of notes that repeats, like the
// patterns of Reich, Glass or Pärt's tintinnabuli, but generated as the journey goes.
//
// THE CELL. Eight steps (an eighth note each), repeated. The strong steps (0, 2, 4, 6) play the
// chord's tones in an arpeggio; the weak steps (1, 3, 5, 7) are mostly rests, with a few scale
// steps passing between the chord tones. Arousal sets how many weak steps sound (a sparse cell
// when still, a fuller one when energised) and the tempo. Everything sits in a warm register,
// C3 to C5, and every note belongs to the current mode by construction. The TEMPO IS FIXED for
// the whole journey (a constant grid is what a DAW export needs, and it keeps the echo steady):
// by default it comes from the journey's mean arousal; the listener can scale it (slow / medium /
// fast) or set an exact BPM. Arousal still shapes density, dynamics and how the harmony moves.
//
// THE PROCESS. The harmony beneath is the usual engine — the mode walk, one-voice moves — and
// the cell follows it by SUBSTITUTION, one note at a time. At the end of a cycle the notes that
// no longer fit are marked; during the next cycle they soften; at the following cycle each is
// replaced (the new note eases in over two cycles). Notes outside the current mode go first. So
// the pattern keeps its identity while the notes that do not work are removed and ones that do
// are added, never a jolt.
//
// THE SHAPE. Phrases of four cycles with a small variation in the fourth; a dynamic arc that
// rises and falls over a finite journey; and, near the end, the cell thins (passing notes, then
// the upper chord tones) until the tonic is left alone.
//
// Pure and deterministic for a given rng, and streaming (`pull(until)`), like Composer.

import { DriftEngine, LADDER, beatFor, colorPc, rootNear, thirdPc } from './drift'
import { getScaleNotes } from './eddy/scales'
import {
  arousalAt,
  layoutTimeline,
  type Flip,
  type Layout,
  type NoteEvent,
  type VoiceParams,
  type Waypoint,
} from './compose'

export const BPM_STILL = 54
export const BPM_ENERGISED = 90

// "slow / medium / fast" scale the whole tempo curve, so a journey still quickens and eases
// with the mood whichever is chosen.
export const TEMPO_FEEL = { slow: 0.8, medium: 1, fast: 1.25 } as const
export type TempoFeel = keyof typeof TEMPO_FEEL

export function pulseBpm(arousal: number, scale = 1): number {
  const a = Math.min(1, Math.max(0, arousal))
  return (BPM_STILL + (BPM_ENERGISED - BPM_STILL) * a) * scale
}

// The journey's tempo when none is chosen: from its mean arousal, scaled by the feel.
export function defaultBpm(waypoints: { arousal?: number }[], scale = 1): number {
  const a = waypoints.map((w) => w.arousal ?? 0.4)
  return pulseBpm(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), scale)
}

export const BPM_MIN = 40
export const BPM_MAX = 140
export const clampBpm = (bpm: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)))

export interface PulsePlan extends VoiceParams {
  waypoints: Waypoint[]
  walk: number | number[]
  bpm?: number // the fixed tempo; by default `defaultBpm` of the journey, scaled by `tempoScale`
  tempoScale?: number // from TEMPO_FEEL
}

const CELL = 8 // steps in the cell
const PHRASE = 4 // cycles in a phrase
const ROOT_NEAR = 53 // the tonic sits at B2-A#3; the cell spans about an octave and a half above it, within the samples (to C5)
export const START = 0.3 // seconds before the first pulse
const HOLD = 1.5 // a note rings this many steps (it overlaps the next; the echo does the rest)
const MAX_TONES = 4 // chord tones in the cell
// An ostinato holds its shape longer than a pad's chords do: the harmony beneath moves this much slower.
const HARMONY_SLOWER = 2.2

// Which chord tones the strong steps play (indices into the tones, ascending in pitch): smooth
// shapes — up and back, root-fifth-third-fifth, a rising run, a lift to the top and down.
const TEMPLATES = [
  [0, 1, 2, 1],
  [0, 2, 1, 2],
  [0, 1, 2, 3],
  [0, 2, 3, 2],
]
// Which weak steps sound, by how energised the music is.
const WEAK_STEPS = [[5], [3, 7], [1, 3, 5]]

const weakLevel = (arousal: number) => (arousal < 0.35 ? 0 : arousal < 0.65 ? 1 : 2)

// A small deterministic hash to unit interval, so a phrase's variation does not depend on how
// the stream is chunked.
function unit(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) | 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

type Cell = (number | null)[]

// Events carry where they fall in the cell (for tests and tuning); players ignore the extras.
export interface PulseEvent extends NoteEvent {
  step: number
  cycle: number
}

export class PulseComposer {
  readonly layout: Layout
  private engine: DriftEngine
  private rng: () => number
  private beat: number | undefined
  readonly bpm: number // fixed for the whole journey
  private flips: Flip[]
  private nextFlip = 0
  private moveAt: number // when the next harmonic move happens
  private t = START // the next step
  private k = 0 // steps so far
  private template: number[]
  private seed: number

  // the cell as it is being played, and how its notes are changing
  private shown: Cell = []
  private leaving: boolean[] = Array(CELL).fill(false) // softening before a substitution
  private planned: number[] = [] // positions to substitute at the next cycle
  private arriving: number[] = Array(CELL).fill(1) // new notes ease in: 0.5, 0.75, 1
  private playing: Cell = [] // this cycle's cell (with the phrase's variation)
  private cycle = -1

  constructor(plan: PulsePlan) {
    this.rng = plan.rng ?? Math.random
    this.beat = plan.beat
    this.bpm = clampBpm(plan.bpm ?? defaultBpm(plan.waypoints, plan.tempoScale ?? 1))
    this.layout = layoutTimeline(plan.waypoints, plan.walk)
    this.flips = this.layout.flips
    this.engine = new DriftEngine({
      rung: plan.waypoints[0].rung,
      tonic: plan.tonic,
      register: plan.register,
      span: plan.span,
      ceiling: plan.ceiling,
      arousal: this.layout.arousals[0],
      rng: this.rng,
    })
    this.template = TEMPLATES[Math.floor(this.rng() * TEMPLATES.length)]
    this.seed = Math.floor(this.rng() * 2 ** 31)
    this.moveAt = this.baseBeat(0) * (0.6 + 0.4 * this.rng())
  }

  get tonic(): number {
    return this.engine.tonic
  }

  private baseBeat(t: number): number {
    return this.beat ?? beatFor(arousalAt(this.layout, t)) * HARMONY_SLOWER
  }

  // Make the engine's chord the chord at time t: every step and mode change up to t, in order.
  private harmonyAt(t: number) {
    for (;;) {
      const nf = this.nextFlip < this.flips.length ? this.flips[this.nextFlip].time : Infinity
      if (Math.min(nf, this.moveAt) > t) return
      if (nf <= this.moveAt) {
        this.engine.shift(this.flips[this.nextFlip++].dir)
      } else {
        this.engine.setArousal(arousalAt(this.layout, this.moveAt))
        this.engine.step()
        this.moveAt += this.baseBeat(this.moveAt) * (0.75 + 0.5 * this.rng())
      }
    }
  }

  // ── the cell the harmony calls for ──────────────────────────────────────────────────
  // The chord's tones as an open, harp-like voicing above the tonic, ascending. Close intervals
  // (a second above the root) go up an octave as a ninth, so the low register never clusters:
  // D dorian becomes D3 F3 A3 E4.
  private chordTones(): number[] {
    const tonic = this.engine.tonic
    const rung = this.engine.rung
    const color = colorPc(rung, tonic)
    const third = thirdPc(rung, tonic)
    const fifth = (tonic + 7) % 12
    const rank = (pc: number) => (pc === color ? 1 : pc === third ? 2 : pc === fifth ? 3 : 4)
    const pcs = [...new Set(this.engine.cluster.map((n) => n % 12))].filter((pc) => pc !== tonic)
    pcs.sort((a, b) => rank(a) - rank(b) || ((a - tonic + 12) % 12) - ((b - tonic + 12) % 12))
    const above = pcs.slice(0, MAX_TONES - 1).map((pc) => (pc - tonic + 12) % 12)
    if (above.length < 2) above.push((fifth - tonic + 12) % 12) // a chord needs at least three tones
    const root = rootNear(tonic, ROOT_NEAR)
    const tones = [root, ...above.map((o) => root + (o <= 2 ? o + 12 : o))]
    return tones.sort((a, b) => a - b)
  }

  // A scale step that truly passes between two chord tones, nearest the one it leaves; none
  // if they are adjacent (the step stays a rest). If the two are the same note, a neighbour above.
  private passing(from: number, to: number, scale: number[]): number | null {
    if (from === to) return scale.find((n) => n > from) ?? null
    const between = scale.filter((n) => (to > from ? n > from && n < to : n > to && n < from))
    if (!between.length) return null
    return to > from ? between[0] : between[between.length - 1]
  }

  private targetCell(): Cell {
    const tones = this.chordTones()
    const scale = getScaleNotes(this.engine.tonic, LADDER[this.engine.rung], 36, 90)
    const cell: Cell = Array(CELL).fill(null)
    const strong = this.template.map((idx) => tones[idx % tones.length])
    strong.forEach((note, i) => (cell[i * 2] = note))
    for (const step of WEAK_STEPS[weakLevel(this.engine.arousal)]) {
      const from = strong[(step - 1) / 2]
      const to = strong[((step + 1) / 2) % 4]
      cell[step] = this.passing(from, to, scale)
    }
    return cell
  }

  private inMode(note: number): boolean {
    const { tonic, rung } = this.engine
    return getScaleNotes(tonic, LADDER[rung], note, note).length > 0
  }

  // ── a new cycle: change the cell by one substitution at a time ──────────────────────
  private startCycle() {
    this.cycle++
    const target = this.targetCell()

    if (this.cycle === 0) {
      this.shown = target
    } else {
      // notes that arrived earlier ease in a little more (0.5 -> 0.75 -> 1)...
      for (let j = 0; j < CELL; j++) if (this.arriving[j] < 1) this.arriving[j] = Math.min(1, this.arriving[j] + 0.25)
      // ...and the substitutions planned last cycle take place now, the new notes starting soft
      for (const j of this.planned) {
        this.shown[j] = target[j]
        this.arriving[j] = 0.5
      }
      this.planned = []

      // what no longer fits? notes outside the mode first, then the rest, a few at a time
      const diffs: number[] = []
      for (let j = 0; j < CELL; j++) if (this.shown[j] !== target[j]) diffs.push(j)
      const bad = (j: number) => (this.shown[j] !== null && !this.inMode(this.shown[j] as number) ? 0 : 1)
      diffs.sort((a, b) => bad(a) - bad(b) || a - b)
      const take = Math.max(1, Math.ceil(diffs.length / 3))
      this.planned = diffs.slice(0, take)
      this.leaving = Array(CELL).fill(false)
      for (const j of this.planned) this.leaving[j] = true
    }

    // the phrase's variation, in its last cycle only
    this.playing = [...this.shown]
    const phrase = Math.floor(this.cycle / PHRASE)
    if (this.cycle % PHRASE === PHRASE - 1) {
      const v = Math.floor(unit(this.seed, phrase) * 4)
      if (v === 1 && this.playing[6] !== null && (this.playing[6] as number) + 12 <= 76) this.playing[6] = (this.playing[6] as number) + 12 // lift
      if (v === 2) this.playing[4] = null // a breath
      if (v === 3 && this.playing[0] !== null) {
        const scale = getScaleNotes(this.engine.tonic, LADDER[this.engine.rung], 36, 90)
        this.playing[7] = scale.find((n) => n > (this.playing[0] as number)) ?? null // a turn back to the start
      }
    }
  }

  // ── dynamics ────────────────────────────────────────────────────────────────────────
  private arc(t: number): number {
    const d = this.layout.duration
    if (!Number.isFinite(d)) return 0.75
    const f = Math.min(1, Math.max(0, t / d))
    return 0.55 + 0.3 * Math.sin(Math.PI * f) ** 1.5
  }

  // Events that start before `until`, in time order. Call with an increasing `until`.
  pull(until: number): PulseEvent[] {
    const out: PulseEvent[] = []
    const d = this.layout.duration
    const end = Math.min(until, d)
    while (this.t < end) {
      const t = this.t
      this.harmonyAt(t)
      const stepInCycle = this.k % CELL
      if (stepInCycle === 0) this.startCycle()
      const step = 30 / this.bpm // an eighth note, constant

      let note = this.playing[stepInCycle]
      // near the end of a finite journey the cell thins: passing notes go, then the upper chord tones
      const f = Number.isFinite(d) ? t / d : 0
      if (note !== null && f > 0.78 && stepInCycle % 2 === 1) note = null
      if (note !== null && f > 0.88 && stepInCycle !== 0 && stepInCycle !== 4) note = null

      if (note !== null) {
        const role = stepInCycle === 0 ? 1 : stepInCycle % 2 === 0 ? 0.82 : 0.6
        let v = role * this.arc(t) * this.arriving[stepInCycle]
        if (this.leaving[stepInCycle]) v *= 0.5
        if (!this.inMode(note)) v *= 0.55 // a note the mode no longer wants: kept quiet until replaced
        out.push({
          time: t,
          note,
          hold: step * HOLD,
          chain: 0,
          velocity: Math.min(1, Math.max(0.08, v)),
          step: stepInCycle,
          cycle: this.cycle,
        })
      }
      this.k++
      this.t += step
    }
    return out
  }
}
