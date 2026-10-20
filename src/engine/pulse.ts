// The second way to play a drift: an ostinato. Where the pad lets chords swell and move in
// free time, this keeps a quiet, steady pulse — a short cell of notes that repeats, like the
// patterns of Reich, Glass or Pärt's tintinnabuli, but generated as the journey goes.
//
// THE CELL. One bar of four beats, each divided into `grid` steps (1 = quarters, 2 = eighths,
// 3 = eighth triplets, 4 = sixteenths; eighths are the default), repeated. The strong steps (the
// beats) play the chord's tones in an arpeggio; the weak steps between them are mostly rests, with
// a few scale steps passing between the chord tones. How many weak steps sound is the DENSITY:
// by default arousal sets it (a sparse cell when still, a fuller one when energised), or the
// listener fixes it (sparse / medium / full, which is every step). Arousal also sets the tempo. Everything sits in a warm register,
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
// VARIATION (per stop; still / gentle / flowing) sets how much of this happens: how long the
// harmony waits between moves, how many differing notes are substituted at once (still: only on
// phrase lines), and how much a phrase varies (still: a breath in every other phrase; gentle: a
// change in the fourth cycle; flowing: a tweak in most bars, and the arpeggio takes another shape
// at every phrase line). Gentle is the original behaviour.
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
  paceFor,
  variationAt,
  START,
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
export const BPM_MAX = 200
export const clampBpm = (bpm: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)))

export interface PulsePlan extends VoiceParams {
  waypoints: Waypoint[]
  walk: number | number[]
  bpm?: number // the fixed tempo; by default `defaultBpm` of the journey, scaled by `tempoScale`
  tempoScale?: number // from TEMPO_FEEL
  grid?: Grid // steps per beat; default 2 (eighths)
  density?: Density // how many weak steps sound; default 'auto' (from arousal)
}

// Steps per beat: the cell is one bar of four beats.
export const GRIDS = [1, 2, 3, 4] as const
export type Grid = (typeof GRIDS)[number]
export const DEFAULT_GRID: Grid = 2
// as a DAW's grid menu names them, and as a person might hear them
export const GRID_LABEL: Record<Grid, string> = { 1: '1/4', 2: '1/8', 3: '1/8T', 4: '1/16' }
export const GRID_NAME: Record<Grid, string> = { 1: 'quarter notes', 2: 'eighth notes', 3: 'eighth-note triplets', 4: 'sixteenth notes' }

// Density: the share of the cell's steps that sound. 'auto' follows arousal, as the pulse always
// has (at most three quarters of the steps). Each stop may set its own grid and density: the
// grid changes once, at the middle of the walk to that stop (on the next phrase line, so a bar is
// never cut short); the density eases along the walk. The beats always sound, so the quarter grid has
// nothing to vary. At 'full' no step is left silent: where no scale step lies between two chord
// tones, the step plays the tone's upper neighbour (and the tone again after it).
export const DENSITIES = ['auto', 'sparse', 'medium', 'full'] as const
export type Density = (typeof DENSITIES)[number]
export const DEFAULT_DENSITY: Density = 'auto'
const SHARE = { sparse: 0.5, medium: 0.75, full: 1 } as const // full = every step: a continuous stream
const AUTO_SHARE = [0.625, 0.75, 0.75] // by weakLevel(arousal): auto never fills the bar

const BEATS = 4 // beats in the cell
const PHRASE = 4 // cycles in a phrase
const ROOT_NEAR = 53 // the tonic sits at B2-A#3; the cell spans about an octave and a half above it, within the samples (to C5)
export { START }
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
// More shapes, reached only by flowing's changes of shape (the first pick is from TEMPLATES, so
// every other level's random stream is as it was): descending, rotated starts, a fall from the top.
const MORE_TEMPLATES = [
  [2, 1, 0, 1],
  [0, 3, 2, 1],
  [1, 0, 1, 2],
  [1, 2, 3, 2],
  [3, 1, 2, 1],
  [0, 1, 3, 2],
]
const ALL_TEMPLATES = [...TEMPLATES, ...MORE_TEMPLATES]
// Which weak steps sound on the eighth grid, by how many (kept as they were, so default journeys
// are unchanged). Other grids spread them evenly through the bar.
const WEAK_EIGHTHS: Record<number, number[]> = { 0: [], 1: [5], 2: [3, 7], 3: [1, 3, 5] }

// The `n` weak steps of a cell that sound: evenly spread through its weak steps.
function weakSteps(grid: number, n: number): number[] {
  if (grid === 2 && n in WEAK_EIGHTHS) return WEAK_EIGHTHS[n]
  const weak: number[] = []
  for (let i = 0; i < BEATS * grid; i++) if (i % grid !== 0) weak.push(i)
  return Array.from({ length: n }, (_, j) => weak[Math.floor(((j + 0.5) * weak.length) / n)])
}

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
  private templateIdx: number
  private seed: number

  // the cell as it is being played, and how its notes are changing
  private grids: Grid[] // per stop
  private densities: Density[]
  private grid: Grid // the grid being played
  private pos = 0 // the step within the cell
  private barAt = START // when the current cell began
  readonly switches: { time: number; grid: Grid }[] = [] // where the grid changed, for the score's markers
  private cellSteps: number // steps in the cell
  private shown: Cell = []
  private leaving: boolean[] // softening before a substitution
  private planned: number[] = [] // positions to substitute at the next cycle
  private arriving: number[] // new notes ease in: 0.5, 0.75, 1
  private playing: Cell = [] // this cycle's cell (with the phrase's variation)
  private cycle = -1

  constructor(plan: PulsePlan) {
    this.rng = plan.rng ?? Math.random
    this.beat = plan.beat
    this.bpm = clampBpm(plan.bpm ?? defaultBpm(plan.waypoints, plan.tempoScale ?? 1))
    // each stop's grid and density: its own, else the stop before's, else the plan's
    const grid0 = GRIDS.includes(plan.grid as Grid) ? (plan.grid as Grid) : DEFAULT_GRID
    const density0 = DENSITIES.includes(plan.density as Density) ? (plan.density as Density) : DEFAULT_DENSITY
    this.grids = []
    this.densities = []
    plan.waypoints.forEach((w, i) => {
      this.grids.push(GRIDS.includes(w.grid as Grid) ? (w.grid as Grid) : i ? this.grids[i - 1] : grid0)
      this.densities.push(DENSITIES.includes(w.density as Density) ? (w.density as Density) : i ? this.densities[i - 1] : density0)
    })
    this.grid = this.grids[0]
    this.cellSteps = BEATS * this.grid
    this.leaving = Array(this.cellSteps).fill(false)
    this.arriving = Array(this.cellSteps).fill(1)
    this.layout = layoutTimeline(plan.waypoints, plan.walk, plan.tonic)
    this.flips = this.layout.flips
    this.engine = new DriftEngine({
      rung: plan.waypoints[0].rung,
      tonic: this.layout.tonic0,
      register: plan.register,
      span: plan.span,
      ceiling: plan.ceiling,
      arousal: this.layout.arousals[0],
      rng: this.rng,
    })
    this.templateIdx = Math.floor(this.rng() * TEMPLATES.length)
    this.seed = Math.floor(this.rng() * 2 ** 31)
    this.moveAt = this.baseBeat(0) * (0.6 + 0.4 * this.rng())
  }

  get tonic(): number {
    return this.engine.tonic
  }

  private baseBeat(t: number): number {
    return (this.beat ?? beatFor(arousalAt(this.layout, t)) * HARMONY_SLOWER) * paceFor(variationAt(this.layout, t))
  }

  // How much the music changes at time t, as one of three levels (the in-between of an easing
  // walk takes the nearest).
  private levelAt(t: number): 'still' | 'gentle' | 'flowing' {
    const a = variationAt(this.layout, t)
    return a < 0.25 ? 'still' : a > 0.75 ? 'flowing' : 'gentle'
  }

  // Make the engine's chord the chord at time t: every step and mode change up to t, in order.
  private harmonyAt(t: number) {
    for (;;) {
      const nf = this.nextFlip < this.flips.length ? this.flips[this.nextFlip].time : Infinity
      if (Math.min(nf, this.moveAt) > t) return
      if (nf <= this.moveAt) {
        const f = this.flips[this.nextFlip++]
        if (f.kind === 'key') this.engine.modulate(f.dir)
        else this.engine.shift(f.dir)
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

  // The scale steps that truly pass between two chord tones, in the order they are met leaving
  // the first; none if the tones are adjacent (the steps stay rests). If the two are the same
  // note, a neighbour above.
  private passing(from: number, to: number, scale: number[]): number[] {
    if (from === to) {
      const above = scale.find((n) => n > from)
      return above === undefined ? [] : [above]
    }
    const between = scale.filter((n) => (to > from ? n > from && n < to : n > to && n < from))
    return to > from ? between : between.reverse()
  }

  // A figure around a chord tone for a step with nothing to pass through: its upper neighbour
  // (the lower if that would climb out of the register), then the tone itself.
  private neighbour(tone: number, k: number, scale: number[]): number | null {
    if (k % 2 === 1) return tone
    const up = scale.find((n) => n > tone)
    if (up !== undefined && up <= 76) return up
    return [...scale].reverse().find((n) => n < tone) ?? null
  }

  // The grid at time t: a stop's own from the middle of the walk to it.
  private gridAt(t: number): Grid {
    let g = this.grids[0]
    this.layout.walks.forEach((w, i) => {
      if (t >= (w.start + w.end) / 2) g = this.grids[i + 1]
    })
    return g
  }

  // The share of steps that sound at time t: a stop's density, easing along each walk to the next.
  private shareAt(t: number): number {
    const of = (d: Density) => (d === 'auto' ? AUTO_SHARE[weakLevel(this.engine.arousal)] : SHARE[d])
    const { walks } = this.layout
    for (let i = 0; i < walks.length; i++) {
      const w = walks[i]
      if (t < w.start) return of(this.densities[i])
      if (t < w.end) {
        const from = of(this.densities[i])
        const to = of(this.densities[i + 1])
        return from + (to - from) * ((t - w.start) / (w.end - w.start))
      }
    }
    return of(this.densities[this.densities.length - 1])
  }

  // How many of the cell's weak steps sound: the density's share of the whole cell, less the beats.
  private weakCount(): number {
    const weak = this.cellSteps - BEATS
    return Math.min(weak, Math.max(0, Math.round(this.shareAt(this.barAt) * this.cellSteps) - BEATS))
  }

  // A new grid takes over on a phrase line. The beats keep their notes; the steps between begin
  // soft and ease in over the next bars.
  private switchGrid(grid: Grid) {
    const old = this.grid
    this.switches.push({ time: this.barAt, grid })
    const kept = Array.from({ length: BEATS }, (_, b) => this.shown[b * old] ?? null)
    this.grid = grid
    this.cellSteps = BEATS * grid
    this.shown = this.targetCell()
    kept.forEach((note, b) => note !== null && (this.shown[b * grid] = note))
    this.leaving = Array(this.cellSteps).fill(false)
    this.planned = []
    this.arriving = Array.from({ length: this.cellSteps }, (_, j) => (j % grid === 0 ? 1 : 0.25))
  }

  private targetCell(): Cell {
    const tones = this.chordTones()
    const scale = getScaleNotes(this.engine.tonic, LADDER[this.engine.rung], 36, 90)
    const g = this.grid
    const cell: Cell = Array(this.cellSteps).fill(null)
    const strong = ALL_TEMPLATES[this.templateIdx].map((idx) => tones[idx % tones.length])
    strong.forEach((note, beat) => (cell[beat * g] = note))
    const n = this.weakCount()
    const fill = n === this.cellSteps - BEATS && n > 0 // every step sounds: none is left silent
    for (const step of weakSteps(g, n)) {
      const beat = Math.floor(step / g)
      const between = this.passing(strong[beat], strong[(beat + 1) % BEATS], scale)
      const k = (step % g) - 1 // the first weak step of a beat takes the nearest passing tone, then on towards the next
      cell[step] = between[k] ?? (fill ? this.neighbour(strong[beat], k, scale) : null)
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
    const level = this.levelAt(this.barAt)
    const phrase = Math.floor(this.cycle / PHRASE)
    const inPhrase = this.cycle % PHRASE
    // flowing: on every phrase line the arpeggio takes another shape (its notes follow one by one)
    if (level === 'flowing' && this.cycle > 0 && inPhrase === 0)
      this.templateIdx =
        (this.templateIdx + 1 + Math.floor(unit(this.seed, phrase + 1299709) * (ALL_TEMPLATES.length - 1))) % ALL_TEMPLATES.length
    const target = this.targetCell()

    if (this.cycle === 0) {
      this.shown = target
    } else {
      // notes that arrived earlier ease in a little more (0.5 -> 0.75 -> 1)...
      for (let j = 0; j < this.cellSteps; j++) if (this.arriving[j] < 1) this.arriving[j] = Math.min(1, this.arriving[j] + 0.25)
      // ...and the substitutions planned last cycle take place now, the new notes starting soft
      for (const j of this.planned) {
        this.shown[j] = target[j]
        this.arriving[j] = 0.5
      }
      this.planned = []

      // what no longer fits? notes outside the mode first, then the rest, a few at a time
      const diffs: number[] = []
      for (let j = 0; j < this.cellSteps; j++) if (this.shown[j] !== target[j]) diffs.push(j)
      const bad = (j: number) => (this.shown[j] !== null && !this.inMode(this.shown[j] as number) ? 0 : 1)
      diffs.sort((a, b) => bad(a) - bad(b) || a - b)
      // how many change at once: still waits for a phrase line (the ones outside the mode go first)
      const phraseLine = inPhrase === PHRASE - 1
      const take =
        level === 'still' ? (phraseLine ? Math.ceil(diffs.length / 2) : 0) : Math.max(1, Math.ceil(diffs.length / (level === 'flowing' ? 2 : 3)))
      this.planned = diffs.slice(0, take)
      this.leaving = Array(this.cellSteps).fill(false)
      for (const j of this.planned) this.leaving[j] = true
    }

    // the phrase's variation: gentle, in its last cycle; still, only a breath in every other phrase;
    // flowing, in most bars after the phrase line, with two bolder tweaks (an octave on one beat;
    // the bar started a beat late)
    this.playing = [...this.shown]
    let v = 0
    if (level === 'still') v = inPhrase === PHRASE - 1 && phrase % 2 === 1 ? 2 : 0
    else if (level === 'flowing') v = inPhrase > 0 ? Math.floor(unit(this.seed, phrase * PHRASE + inPhrase + 7919) * 6) : 0
    else if (inPhrase === PHRASE - 1) v = Math.floor(unit(this.seed, phrase) * 4)
    if (v > 0) {
      const g = this.grid
      if (v === 4) {
        const at = (1 + Math.floor(unit(this.seed, phrase * PHRASE + inPhrase + 31337) * (BEATS - 1))) * g
        const n = this.playing[at]
        if (n !== null) this.playing[at] = n + 12 <= 76 ? n + 12 : n - 12 >= 40 ? n - 12 : n
      }
      if (v === 5) this.playing = [...this.playing.slice(g), ...this.playing.slice(0, g)]
      const lift = 3 * g // the last beat
      if (v === 1 && this.playing[lift] !== null && (this.playing[lift] as number) + 12 <= 76) this.playing[lift] = (this.playing[lift] as number) + 12 // lift
      if (v === 2) this.playing[2 * g] = null // a breath
      if (v === 3 && g > 1 && this.playing[0] !== null) {
        const scale = getScaleNotes(this.engine.tonic, LADDER[this.engine.rung], 36, 90)
        this.playing[this.cellSteps - 1] = scale.find((n) => n > (this.playing[0] as number)) ?? null // a turn back to the start
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
      if (this.pos === this.cellSteps) this.pos = 0
      if (this.pos === 0) {
        this.barAt = t
        const next = this.gridAt(t)
        if (this.cycle >= 0 && (this.cycle + 1) % PHRASE === 0 && next !== this.grid) this.switchGrid(next)
      }
      const g = this.grid
      const stepInCycle = this.pos
      if (stepInCycle === 0) this.startCycle()
      const step = 60 / (this.bpm * g) // a step, constant

      let note = this.playing[stepInCycle]
      // near the end of a finite journey the cell thins: passing notes go, then the upper chord tones
      const f = Number.isFinite(d) ? t / d : 0
      if (note !== null && f > 0.78 && stepInCycle % g !== 0) note = null
      if (note !== null && f > 0.88 && stepInCycle !== 0 && stepInCycle !== 2 * g) note = null

      if (note !== null) {
        const role = stepInCycle === 0 ? 1 : stepInCycle % g === 0 ? 0.82 : 0.6
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
      this.pos++
      this.t += step
    }
    return out
  }
}
