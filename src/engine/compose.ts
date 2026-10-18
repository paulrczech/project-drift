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

import { DriftEngine, beatFor, type Move, type Rung } from './drift'

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
  hold: number
  arousal?: number // 0 still … 1 energised (default 0.4)
}

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

export interface Walk {
  start: number
  end: number
  flips: number[] // times of the ladder flips that fall in this walk (after merging)
}

// One step up (+1, brighter) or down (-1, darker) the ladder.
export interface Flip {
  time: number
  dir: 1 | -1
}

export interface Layout {
  walks: Walk[]
  flips: Flip[] // every ladder step, in time order
  arousals: number[] // per waypoint
  duration: number // Infinity if the last hold is Infinity
}

export const DEFAULT_AROUSAL = 0.4

// The pad fades in over ~2s and out over ~2s, so changes of mode closer together than this
// blur into one another. Steps that would land closer are made together, as one change of
// several semitone moves — still voice-led, and still arriving where the journey goes.
export const MIN_FLIP_GAP = 2.5

export function layoutTimeline(waypoints: Waypoint[], walk: number | number[]): Layout {
  const walks: Walk[] = []
  const raw: Flip[] = []
  let at = 0
  waypoints.forEach((w, i) => {
    at += w.hold
    const next = waypoints[i + 1]
    if (!next) return
    const seconds = Array.isArray(walk) ? walk[i] : walk
    const n = Math.abs(next.rung - w.rung)
    const dir = next.rung > w.rung ? 1 : -1
    for (let k = 0; k < n; k++) raw.push({ time: at + ((k + 0.5) * seconds) / n, dir })
    walks.push({ start: at, end: at + seconds, flips: [] })
    at += seconds
  })

  // Merge steps that fall within MIN_FLIP_GAP of the first of their group. Steps in
  // opposite directions cancel, so a brief excursion too quick to hear is simply skipped.
  const flips: Flip[] = []
  for (let i = 0; i < raw.length; ) {
    let j = i
    let net = 0
    while (j < raw.length && raw[j].time - raw[i].time < MIN_FLIP_GAP) net += raw[j++].dir
    for (let k = 0; k < Math.abs(net); k++) flips.push({ time: raw[i].time, dir: net > 0 ? 1 : -1 })
    i = j
  }
  for (const f of flips) {
    const w = walks.find((x) => f.time >= x.start && f.time <= x.end)
    if (w) w.flips.push(f.time)
  }
  return { walks, flips, arousals: waypoints.map((w) => w.arousal ?? DEFAULT_AROUSAL), duration: at }
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

  constructor(plan: TimelinePlan) {
    this.rng = plan.rng ?? Math.random
    this.beat = plan.beat
    this.attack = plan.attack ?? ATTACK
    this.links = plan.links ?? [plan.link ?? LINK]
    this.overlap = plan.overlap ?? this.attack
    this.maxLast = plan.maxHold ?? MAX_LAST
    this.settle = this.overlap + 0.5
    this.lookahead = Math.max(...this.links) * 1.15 + this.settle + 1
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
    this.linkSeed = Math.floor(this.rng() * 2 ** 31)
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
    return this.beat ?? beatFor(arousalAt(this.layout, t))
  }

  // While walking, harmonic moves speed up so each flip can be followed by a voice
  // (never faster than the pad can articulate).
  private beatAt(t: number): number {
    const w = this.layout.walks.find((x) => t >= x.start && t < x.end)
    const base = this.beatBase(t)
    if (!w || !w.flips.length) return base
    return Math.max(MIN_BEAT, Math.min(base, (w.end - w.start) / (w.flips.length * 1.2)))
  }

  private flip(f: { time: number; dir: 1 | -1 }) {
    this.engine.shift(f.dir) // voices holding the changed degree follow it
    this.marks.push({ time: f.time, kind: 'shift', rung: this.engine.rung })
    // the shifted notes have to be reflected in what is sounding
    const cluster = this.engine.cluster
    for (const n of [...this.open.keys()]) if (!cluster.includes(n)) this.finishNote(n, f.time)
    for (const n of cluster) if (!this.open.has(n)) this.begin(n, f.time)
  }

  private advance(target: number) {
    // no harmonic moves in the last 4 seconds of a finite plan, however it is chunked
    const limit = Math.min(target, this.layout.duration - 4)
    while (this.t < limit) {
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
