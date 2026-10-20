// Turns the engine's moves into timed note events. Deterministic for a given rng: no
// Tone, no clock. Anything that can play a note at a time can play this, live or offline.
//
// Pad samples are 8s long, so a sustained voice is re-articulated in overlapping links:
// each new link fades in while the old one releases, and a voice that moves hands over
// to its new note the same way (a legato crossfade, not a cut).
//
// A `Composer` is a stream: `pull(until)` returns the events that start before `until`,
// composing only as far ahead as it needs. A plan whose last hold is Infinity never ends
// (settle in the final mode until stopped); a finite plan can also be composed in one go
// with `composeTimeline`.

import type { Density, Grid } from './pulse'
import { DEFAULT_TONIC, DriftEngine, beatFor, type Move, type Rung } from './drift'
import { Progression, type Line } from './progression'

export const START = 0.3 // seconds before the first pulse of the pulse, and the first bar line of a pad on bars

export interface NoteEvent {
  time: number // seconds from the start
  note: number // MIDI
  hold: number // seconds before release
  chain: number // which re-strike schedule this belongs to (a layer plays only its own chain)
  velocity?: number // 0-1 (default 1): a pulse accents the start of each pattern
}

// A voice's whole sounding time, before the sampler's re-strikes: for a DAW, one long note.
export interface HeldNote {
  note: number
  start: number
  end: number
}

export interface Mark {
  time: number
  kind: 'shift'
  rung: Rung
}

// A drift is a list of waypoints: settle at a mode for `hold` seconds, then walk the
// ladder to the next waypoint over `walk` seconds. The two-point journey is the simplest
// case; a film cue (sad → nostalgic → joyful) is just more waypoints. The last waypoint's
// hold may be Infinity.
export interface Waypoint {
  rung: Rung
  tonic?: number // pitch class of this stop's key; left out, it is the previous stop's (the first: the plan's)
  hold: number
  arousal?: number // 0 still … 1 energised (default 0.4)
  // the pulse's feel at this stop; left out, the stop before's (the first: the plan's)
  grid?: Grid
  density?: Density
  variation?: Variation // how much the music changes here; left out, the stop before's (the first: gentle)
  bars?: Bars // sustained voices: change the whole cluster every this many bars (0: free time); left out, the stop before's (the first: free)
}

// VARIATION: how much the music changes over time, for every voice. It sets the pace of the
// harmony's moves (and, for the pulse, how fast its notes are substituted and how much its
// phrases vary). 'gentle' is how Drift has always moved. A stop's variation eases into the next
// along the walk between them, as a number: 0 still, 0.5 gentle, 1 flowing.
export const VARIATIONS = ['still', 'gentle', 'flowing'] as const
export type Variation = (typeof VARIATIONS)[number]
export const DEFAULT_VARIATION: Variation = 'gentle'
export const VARIATION_AMOUNT: Record<Variation, number> = { still: 0, gentle: 0.5, flowing: 1 }

// CLUSTERS ON BARS (pad, choir, orchestra): instead of one voice moving now and then, the whole
// cluster changes on a downbeat every `bars` bars (4/4, at the journey's tempo), each voice to the
// nearest tone of the new cluster. Mode and key steps then land on those same downbeats. 0 is the
// free time Drift has always had.
export const BARS = [0, 1, 2, 4, 8] as const
export type Bars = (typeof BARS)[number]
export const DEFAULT_BARS: Bars = 0
export const DEFAULT_BARS_BPM = 60 // the tempo bars are counted in when none is given
export const BARS_LABEL: Record<Bars, string> = { 0: 'free', 1: '1', 2: '2', 4: '4', 8: '8' } // the menu's chips
export const BARS_OPTION: Record<Bars, string> = { 0: 'free', 1: '1 bar', 2: '2 bars', 4: '4 bars', 8: '8 bars' } // a stop's list
export const BARS_NAME: Record<Bars, string> = { 0: 'free time', 1: 'every bar', 2: 'every 2 bars', 4: 'every 4 bars', 8: 'every 8 bars' }
// the factor on the time between harmonic moves: still waits 1.6 times as long, flowing 0.6
export const paceFor = (amount: number) => (amount <= 0.5 ? 1.6 - 1.2 * amount : 1.2 - 0.6 * amount)

export interface TimelinePlan {
  waypoints: Waypoint[]
  walk: number | number[] // seconds per walk (one value, or one per gap between waypoints)
  tonic?: number // pitch class, 0-11 (default D)
  register?: number // semitones to shift the register (a high voice sits higher)
  span?: number // semitones between the lowest and highest note any voice may reach
  ceiling?: number // an absolute highest note
  // How the voice's samples are re-struck (defaults suit 8s pad samples):
  attack?: number // seconds the sampler takes to fade a note in
  link?: number // seconds between re-strikes of a held voice
  links?: number[] // or one interval per chain (see NoteEvent.chain); overrides `link`
  overlap?: number // seconds an old strike goes on after the next one starts (default: attack)
  maxHold?: number // longest a single strike may be held (shorter than the samples)
  beat?: number // fixed seconds between harmonic moves; by default arousal sets it
  bpm?: number // the journey's tempo: what bars are counted in (default 60)
  spread?: number // clusters on bars: 0 tight … 1 wide voicing (default 0)
  seed?: number // the journey's seed: on bars, the progression every sound shares is drawn from it
  sections?: SectionMark[] // a sketch's sections, as labels over the journey (see timeline.ts); the engine ignores them
  rng?: () => number
}

// What a voice asks of the composer (see voices.ts); all optional.
export interface VoiceParams {
  tonic?: number // pitch class, 0-11 (default D)
  register?: number
  span?: number
  ceiling?: number
  attack?: number
  link?: number
  links?: number[] // one re-strike interval per chain, so layers do not pulse in unison
  overlap?: number // seconds an old strike goes on after the next one starts (default: attack)
  maxHold?: number
  beat?: number
  seed?: number
  rng?: () => number
}

export interface JourneyPlan extends VoiceParams {
  from: Rung
  to: Rung
  holdA: number // seconds settled in the first mode
  shiftSeconds: number // seconds spent walking the ladder
  holdB: number // seconds settled in the second mode
}

export const ATTACK = 2 // sampler fade-in, seconds (keep in step with the sampler)
export const RELEASE = 3
const LINK = 5.5 // default seconds between re-articulations of a held voice
const OPENING_STAGGER = 1.5 // seconds between the voices entering at the start
const MIN_BEAT = 2 // the pad's fade-in is 2s; faster harmonic moves just smear
const MAX_LAST = 7.5 // default longest final link (the samples are 8s)

// A section starts at waypoint `from` (the journey's first node of it).
export interface SectionMark {
  name: string
  from: number
}

export interface Walk {
  start: number
  end: number
  flips: number[] // times of the ladder flips that fall in this walk (after merging)
}

// One step up (+1, brighter) or down (-1, darker) the ladder.
// A `rung` step moves the mode one rung up (+1, brighter) or down (-1); a `key` step moves the
// key a perfect fifth up (+1, sharper) or down (-1). Each changes exactly one pitch class.
export interface Flip {
  time: number
  dir: 1 | -1
  kind: 'rung' | 'key'
}

export interface Layout {
  walks: Walk[]
  flips: Flip[] // every mode or key step, in time order
  rung0: number // the mode and key the drift starts in
  tonic0: number
  tonics: number[] // per waypoint
  arousals: number[] // per waypoint
  variations: number[] // per waypoint: VARIATION_AMOUNT
  bars: number[] // per waypoint: clusters on bars (0: free), as far as the stop's stretch allows
  barsAsked: number[] // per waypoint: what was asked for (differs from `bars` where it did not fit)
  barSeconds: number // one bar, in seconds, when any stop is on bars (else 0)
  sections: { name: string; from: number; time: number }[] // where each section is arrived at (the end of the walk into its first stop; 0 for the first)
  duration: number // Infinity if the last hold is Infinity
}

export const DEFAULT_AROUSAL = 0.4

// The pad fades in over ~2s and out over ~2s, so changes of mode closer together than this
// blur into one another. Steps that would land closer are made together, as one change of
// several semitone moves — still voice-led, and still arriving where the journey goes.
export const MIN_FLIP_GAP = 2.5

// The way round the circle of fifths from one key to another: how many fifths up (+) or down (-),
// the shorter way (a tritone goes up).
export function fifthsBetween(from: number, to: number): number {
  const k = ((((to - from) * 7) % 12) + 12) % 12 // 7 is its own inverse mod 12
  return k > 6 ? k - 12 : k
}

export function layoutTimeline(waypoints: Waypoint[], walk: number | number[], startTonic = DEFAULT_TONIC, bpm?: number, sections: SectionMark[] = []): Layout {
  const walks: Walk[] = []
  const raw: Flip[] = []
  const tonics: number[] = []
  waypoints.forEach((w, i) => tonics.push(w.tonic ?? (i === 0 ? startTonic : tonics[i - 1])))
  const variations: number[] = []
  waypoints.forEach((w, i) =>
    variations.push(w.variation && w.variation in VARIATION_AMOUNT ? VARIATION_AMOUNT[w.variation] : i ? variations[i - 1] : VARIATION_AMOUNT[DEFAULT_VARIATION])
  )
  const bars: Bars[] = []
  waypoints.forEach((w, i) => bars.push(BARS.includes(w.bars as Bars) ? (w.bars as Bars) : i ? bars[i - 1] : DEFAULT_BARS))
  let at = 0
  waypoints.forEach((w, i) => {
    at += w.hold
    const next = waypoints[i + 1]
    if (!next) return
    const seconds = Array.isArray(walk) ? walk[i] : walk
    const n = Math.abs(next.rung - w.rung)
    const dir = next.rung > w.rung ? 1 : -1
    const k = fifthsBetween(tonics[i], tonics[i + 1])
    const m = Math.abs(k)
    // mode steps and key steps share the walk, spread evenly among one another
    const total = n + m
    let keys = 0
    for (let j = 0; j < total; j++) {
      const time = at + ((j + 0.5) * seconds) / total
      if (Math.round(((j + 1) * m) / total) > keys) {
        keys++
        raw.push({ time, dir: k > 0 ? 1 : -1, kind: 'key' })
      } else raw.push({ time, dir, kind: 'rung' })
    }
    walks.push({ start: at, end: at + seconds, flips: [] })
    at += seconds
  })

  // Merge steps that fall within MIN_FLIP_GAP of the first of their group. Steps in
  // opposite directions cancel, so a brief excursion too quick to hear is simply skipped.
  const flips: Flip[] = []
  for (let i = 0; i < raw.length; ) {
    let j = i
    const net = { rung: 0, key: 0 }
    while (j < raw.length && raw[j].time - raw[i].time < MIN_FLIP_GAP) net[raw[j].kind] += raw[j++].dir
    for (const kind of ['key', 'rung'] as const)
      for (let k = 0; k < Math.abs(net[kind]); k++) flips.push({ time: raw[i].time, dir: net[kind] > 0 ? 1 : -1, kind })
    i = j
  }
  // On bars (needs the tempo), a stop's setting is capped to the longest one that fits its stretch
  // (from the middle of the walk to it to the middle of the walk away: an 8-bar change cannot
  // happen in a stop that lasts 7 s), and the steps are then laid on downbeats.
  const barSeconds = bpm && bars.some((b) => b > 0) ? 240 / bpm : 0
  const barsAsked = bars.slice()
  if (barSeconds) {
    const mid = (i: number) => (walks[i].start + walks[i].end) / 2
    bars.forEach((b, i) => {
      const room = (i < walks.length ? mid(i) : at) - (i ? mid(i - 1) : 0)
      while (b > 1 && b * barSeconds > room) b = BARS[BARS.indexOf(b) - 1]
      bars[i] = b
    })
    // A step lands on a downbeat of its stop's grid, never in the last seconds, each on its own as
    // far as the walk allows (the steps of one half-walk are spread over the downbeats there, in
    // order); when there are more steps than downbeats, they share them as evenly as can be.
    const groups = new Map<string, { f: Flip[]; wi: number; half: number }>()
    for (const f of flips) {
      const found = walks.findIndex((x) => f.time <= x.end)
      const wi = found < 0 ? walks.length - 1 : found
      const half = f.time >= mid(wi) ? 1 : 0
      const key = `${wi}:${half}`
      if (!groups.has(key)) groups.set(key, { f: [], wi, half })
      groups.get(key)!.f.push(f)
    }
    let last = 0
    for (const { f: group, wi, half } of groups.values()) {
      const n = bars[wi + half]
      if (n) {
        const span = n * barSeconds
        const nearest = (t: number) => Math.max(0, Math.round((t - START) / span))
        // the half-walk, widened by half a span (as far as plain rounding would reach), and after the
        // step before
        const lo = Math.max(half ? mid(wi) - span / 2 : walks[wi].start, START)
        const hi = Math.min(half ? walks[wi].end : mid(wi) + span / 2, walks[wi].end, at - 6)
        const kmin = Math.max(Math.ceil((lo - START) / span - 1e-9), last > START ? Math.floor((last - START) / span + 1e-9) + 1 : 0)
        const kmax = Math.floor((hi - START) / span + 1e-9)
        const room = kmax - kmin + 1
        let ks: number[]
        if (room <= 0) {
          // no downbeat in this half-walk: the nearest one, pulled back before the closing seconds
          ks = group.map((f) => {
            let k = nearest(f.time)
            while (START + k * span > at - 6 && k > 0) k--
            return k
          })
        } else if (room >= group.length) {
          ks = group.map((f) => Math.min(kmax, Math.max(kmin, nearest(f.time))))
          for (let j = 1; j < ks.length; j++) ks[j] = Math.max(ks[j], ks[j - 1] + 1)
          for (let j = ks.length - 1; j >= 0; j--) ks[j] = Math.min(ks[j], j + 1 < ks.length ? ks[j + 1] - 1 : kmax)
        } else ks = group.map((_, j) => kmin + Math.floor((j * room) / group.length))
        group.forEach((f, j) => (f.time = START + ks[j] * span))
      }
      for (const f of group) {
        f.time = Math.max(f.time, last)
        last = f.time
      }
    }
  }
  for (const f of flips) {
    const w = walks.find((x) => f.time >= x.start && f.time <= x.end)
    if (w) w.flips.push(f.time)
  }
  return {
    walks,
    flips,
    rung0: waypoints[0].rung,
    tonic0: tonics[0],
    tonics,
    arousals: waypoints.map((w) => w.arousal ?? DEFAULT_AROUSAL),
    variations,
    bars,
    barsAsked,
    barSeconds,
    sections: sections.map((m) => ({ ...m, time: m.from ? walks[m.from - 1].end : 0 })),
    duration: at,
  }
}

// The mode and key sounding at time t: the start, moved by every step made so far.
export function stateAt(layout: Layout, t: number): { rung: number; tonic: number } {
  let rung = layout.rung0
  let fifths = 0
  for (const f of layout.flips) {
    if (f.time > t) break
    if (f.kind === 'rung') rung += f.dir
    else fifths += f.dir
  }
  return { rung, tonic: (((layout.tonic0 + 7 * fifths) % 12) + 12) % 12 }
}

// Arousal at time t: constant while settled, a straight line along each walk.
export function arousalAt(layout: Layout, t: number): number {
  for (let i = 0; i < layout.walks.length; i++) {
    const w = layout.walks[i]
    if (t < w.start) return layout.arousals[i]
    if (t < w.end) {
      const p = (t - w.start) / (w.end - w.start)
      return layout.arousals[i] + (layout.arousals[i + 1] - layout.arousals[i]) * p
    }
  }
  return layout.arousals[layout.arousals.length - 1]
}

// The variation at time t (0 still … 1 flowing): a stop's own, easing along each walk to the next.
export function variationAt(layout: Layout, t: number): number {
  const v = layout.variations
  for (let i = 0; i < layout.walks.length; i++) {
    const w = layout.walks[i]
    if (t < w.start) return v[i]
    if (t < w.end) return v[i] + (v[i + 1] - v[i]) * ((t - w.start) / (w.end - w.start))
  }
  return v[v.length - 1]
}

// Clusters on bars at time t: a stop's setting from the middle of the walk to it.
export function barsAt(layout: Layout, t: number): number {
  if (!layout.barSeconds) return 0
  return layout.bars[layout.walks.filter((w) => (w.start + w.end) / 2 <= t).length]
}

// The first downbeat of an `n`-bar grid at or after t (`after`: strictly after).
export function downbeat(layout: Layout, t: number, n: number, after = false): number {
  const span = n * layout.barSeconds
  const k = (t - START) / span
  return START + (after ? Math.floor(k + 1e-9) + 1 : Math.ceil(k - 1e-9)) * span
}

// Where we are along the waypoints at time t, as a fractional index: 0 = at the first,
// 1 = at the second, 0.5 = halfway through the first walk. Drives the visuals.
export function positionAt(layout: Layout, t: number): number {
  for (let i = 0; i < layout.walks.length; i++) {
    const w = layout.walks[i]
    if (t < w.start) return i
    if (t < w.end) return i + (t - w.start) / (w.end - w.start)
  }
  return layout.walks.length
}

// Which waypoint's text to show: it changes at the midpoint of each walk.
export function textIndexAt(layout: Layout, t: number): number {
  return layout.walks.filter((w) => (w.start + w.end) / 2 <= t).length
}

interface Entry {
  id: number
  note: number
  start: number
  end: number // Infinity while the voice is still sounding
  chains: { at: number; k: number }[] // per chain: time of the next link, and its index (-1: complete)
}

// Deterministic jitter per (seed, voice, link), so the result does not depend on how
// the stream is chunked.
function unit(seed: number, id: number, k: number): number {
  let h = (seed ^ Math.imul(id + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) | 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export class Composer {
  readonly layout: Layout
  readonly marks: Mark[] = []
  readonly clusters: { time: number; bars: number }[] = [] // each change of cluster on bars (the first is the opening), for cutting clips
  readonly held: HeldNote[] = [] // every note a voice held (complete once a finite plan is pulled to its end)
  private engine: DriftEngine
  private rng: () => number
  private beat: number | undefined
  private linkSeed: number
  private attack: number
  private links: number[]
  private overlap: number
  private maxLast: number
  private settle: number // a link this close to a voice's end is merged into the last one
  private lookahead: number // how far the engine must run before a link can be judged final
  private open = new Map<number, Entry>()
  private closed: Entry[] = []
  private nextId = 0
  private t: number // every harmonic move before t has been made
  private flips: Flip[]
  private nextFlip = 0
  private finished = false
  private spread: number
  private prog: Progression | null = null // on bars: the progression every sound shares

  constructor(plan: TimelinePlan) {
    this.rng = plan.rng ?? Math.random
    this.beat = plan.beat
    this.attack = plan.attack ?? ATTACK
    this.links = plan.links ?? [plan.link ?? LINK]
    this.overlap = plan.overlap ?? this.attack
    this.maxLast = plan.maxHold ?? MAX_LAST
    this.settle = this.overlap + 0.5
    this.lookahead = Math.max(...this.links) * 1.15 + this.settle + 1
    this.spread = plan.spread ?? 0
    this.layout = layoutTimeline(plan.waypoints, plan.walk, plan.tonic, plan.bpm ?? DEFAULT_BARS_BPM, plan.sections)
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
    this.linkSeed = Math.floor(this.rng() * 2 ** 31)
    if (this.layout.barSeconds) this.prog = new Progression(this.layout, plan.seed ?? Math.floor(this.rng() * 2 ** 31))
    const first = this.prog?.firstFrom(START)
    if (first && first.line.bar === 0) {
      // on bars from the start: the opening cluster sounds together on the first downbeat
      this.t = START
      this.barStep(first)
      return
    }
    this.engine.cluster.forEach((note, i) => this.begin(note, i * OPENING_STAGGER))
    this.t = this.beatBase(0) * (0.6 + 0.4 * this.rng()) + this.engine.cluster.length * OPENING_STAGGER
  }

  get tonic(): number {
    return this.engine.tonic
  }

  // Events that start before `until`, in time order. Call with an increasing `until`.
  pull(until: number): NoteEvent[] {
    const { duration } = this.layout
    if (!this.finished && until + this.lookahead >= duration) {
      this.advance(duration - 4)
      this.finish()
    } else if (!this.finished) {
      this.advance(until + this.lookahead)
    }
    // Everything before the clock has been decided. A ladder flip that is due but not yet
    // applied can still close a voice, so the clock never runs past one.
    // It also stops at the plan's end, where every voice is cut: the stream can overshoot
    // its target by a beat, and that must not make a link look safe.
    const clock = this.finished
      ? Infinity
      : Math.min(
          this.t,
          duration,
          this.nextFlip < this.flips.length ? this.flips[this.nextFlip].time : Infinity
        )
    const out: NoteEvent[] = []
    for (const e of this.open.values()) this.emit(e, clock, until, out)
    for (const e of this.closed) this.emit(e, clock, until, out)
    this.closed = this.closed.filter((e) => e.chains.some((c) => c.k >= 0))
    out.sort((a, b) => a.time - b.time)
    return out
  }

  private begin(note: number, t: number) {
    this.open.set(note, {
      id: this.nextId++,
      note,
      start: t,
      end: Infinity,
      chains: this.links.map(() => ({ at: t, k: 0 })),
    })
  }

  private finishNote(note: number, t: number) {
    const e = this.open.get(note)
    if (!e) return
    e.end = t
    this.held.push({ note: e.note, start: e.start, end: t })
    this.closed.push(e)
    this.open.delete(note)
  }

  private apply(m: Move, t: number) {
    if (m.from !== null) this.finishNote(m.from, t)
    if (m.to !== null) this.begin(m.to, t)
  }

  // Seconds between harmonic moves at time t, before any walk speed-up.
  private beatBase(t: number): number {
    const raw = this.beat ?? beatFor(arousalAt(this.layout, t))
    return Math.max(raw * paceFor(variationAt(this.layout, t)), Math.min(raw, MIN_BEAT)) // flowing never outruns the pad's fade-in
  }

  // While walking, harmonic moves speed up so each flip can be followed by a voice
  // (never faster than the pad can articulate).
  private beatAt(t: number): number {
    const w = this.layout.walks.find((x) => t >= x.start && t < x.end)
    const base = this.beatBase(t)
    if (!w || !w.flips.length) return base
    return Math.max(MIN_BEAT, Math.min(base, (w.end - w.start) / (w.flips.length * 1.2)))
  }

  private flip(f: Flip) {
    // voices holding the changed degree follow it
    if (f.kind === 'key') this.engine.modulate(f.dir)
    else this.engine.shift(f.dir)
    this.marks.push({ time: f.time, kind: 'shift', rung: this.engine.rung })
    // the shifted notes have to be reflected in what is sounding
    const cluster = this.engine.cluster
    for (const n of [...this.open.keys()]) if (!cluster.includes(n)) this.finishNote(n, f.time)
    for (const n of cluster) if (!this.open.has(n)) this.begin(n, f.time)
  }

  // Clusters on bars: this.t is a bar line of the progression. Steps made earlier sound at their own
  // time; those on the line are made together with the new cluster, which every voice reaches from
  // the cluster it was in (a tone both share is held across the bar line). The chord itself is the
  // progression's, the same for every sound; this voice only voices it.
  private barStep({ line, index }: { line: Line; index: number }) {
    const t = line.time
    this.clusters.push({ time: t, bars: line.bars })
    const { flips, layout } = this
    while (this.nextFlip < flips.length && flips[this.nextFlip].time < t - 1e-6) this.flip(flips[this.nextFlip++])
    while (this.nextFlip < flips.length && flips[this.nextFlip].time <= t + 1e-6) {
      const f = flips[this.nextFlip++]
      if (f.kind === 'key') this.engine.modulate(f.dir)
      else this.engine.shift(f.dir)
      this.marks.push({ time: f.time, kind: 'shift', rung: this.engine.rung })
    }
    this.engine.setArousal(arousalAt(layout, t))
    this.engine.follow(line.pcs, { spread: this.spread, opening: line.opening, close: line.close })
    const cluster = this.engine.cluster
    for (const note of [...this.open.keys()]) if (!cluster.includes(note)) this.finishNote(note, t)
    for (const note of cluster) if (!this.open.has(note)) this.begin(note, t)
    // on to the next line (after the last, where the stop's chord would have ended)
    this.t = this.prog!.after(index)?.time ?? t + line.bars * layout.barSeconds
  }

  private advance(target: number) {
    // no harmonic moves in the last 4 seconds of a finite plan, however it is chunked
    const limit = Math.min(target, this.layout.duration - 4)
    while (this.t < limit) {
      if (barsAt(this.layout, this.t)) {
        // (a free stretch ends on the next line)
        const next = this.prog!.firstFrom(this.t)
        if (!next) {
          this.t = limit
          continue
        }
        this.t = next.line.time
        if (this.t < limit) this.barStep(next)
        continue
      }
      while (this.nextFlip < this.flips.length && this.flips[this.nextFlip].time <= this.t)
        this.flip(this.flips[this.nextFlip++])
      this.engine.setArousal(arousalAt(this.layout, this.t))
      const m = this.engine.step()
      if (m) this.apply(m, this.t)
      this.t += this.beatAt(this.t) * (0.75 + 0.5 * this.rng())
    }
  }

  private finish() {
    while (this.nextFlip < this.flips.length) this.flip(this.flips[this.nextFlip++])
    for (const note of [...this.open.keys()]) this.finishNote(note, this.layout.duration)
    this.finished = true
  }

  // One sounding note becomes a chain of overlapping sampler hits. A link's hold can only
  // be fixed once we know whether the voice outlives the next link, so emission waits
  // until the engine has run far enough to say.
  private emit(e: Entry, clock: number, until: number, out: NoteEvent[]) {
    e.chains.forEach((c, j) => {
      const link = this.links[j]
      while (c.k >= 0 && c.at < until) {
        const next = c.at + link * (0.85 + 0.3 * unit(this.linkSeed + j * 7919, e.id, c.k))
        if (e.end !== Infinity && next > e.end - this.settle) {
          const remain = e.end - c.at
          if (remain > this.maxLast) {
            // too long for one sample: split the remainder in two overlapping links
            const half = remain / 2
            out.push({ time: c.at, note: e.note, hold: half + this.overlap, chain: j })
            c.at += half
            c.k++
            continue
          }
          out.push({ time: c.at, note: e.note, hold: Math.max(0.5, remain), chain: j })
          c.k = -1 // chain complete
          return
        }
        if (e.end === Infinity && clock < next + this.settle) return // not decidable yet
        out.push({ time: c.at, note: e.note, hold: next - c.at + this.overlap, chain: j })
        c.at = next
        c.k++
      }
    })
  }
}

// A finite plan composed in one go.
export function composeTimeline(plan: TimelinePlan): {
  events: NoteEvent[]
  marks: Mark[]
  duration: number
} {
  const c = new Composer(plan)
  if (!Number.isFinite(c.layout.duration)) throw new Error('composeTimeline needs a finite plan')
  const events = c.pull(Infinity)
  return { events, marks: c.marks, duration: c.layout.duration }
}

export function composeJourney(plan: JourneyPlan) {
  const { from, to, holdA, shiftSeconds, holdB, ...rest } = plan
  return composeTimeline({
    waypoints: [
      { rung: from, hold: holdA },
      { rung: to, hold: holdB },
    ],
    walk: shiftSeconds,
    ...rest,
  })
}
