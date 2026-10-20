// One progression for every sound. On bars, the harmony is a list of lines — a bar at which the
// whole chord changes — each a set of pitch classes in the mode of that moment. It is a function of
// the journey's layout and the seed alone: no voice, no register, no engine. The pad, the choir, the
// orchestra and the pulse each read the same list and only decide how to voice it (the sections in
// their windows, the pulse as the tones of its cell), so files exported from one seed fit together in
// a DAW: the same chords on the same bars, not just the same modes.
//
// Where the lines fall is decided here, once: bar k (from START, at the journey's tempo) is a line when
// its stop's `bars` is n > 0 and k is a multiple of n — except in the last 4 seconds of a finite
// journey, which have no changes. Free stretches have no lines (each sound moves in its own way there).
// The first line, if it falls on the first bar, is the opening, and the last of a finite journey is the
// close: both put the tonic in the bass. Generated in order, so it does not depend on how a sound asks.

import { colorPc, pcsOf, thirdPc, voicesFor } from './drift'
import { arousalAt, barsAt, stateAt, START, type Layout } from './compose'
import { pickSet } from './clusters'
import { mulberry } from './rng'

export interface Line {
  bar: number // 0 is the first bar (at START)
  time: number // seconds
  bars: number // the stop's setting: how many bars this chord lasts
  rung: number // the mode and key it is in
  tonic: number
  pcs: number[] // the pitch classes, ascending
  opening: boolean
  close: boolean
}

// A pitch class stays in the chord for at most this many bars, counted from the line it came in, and
// then the next chord leaves it (its voice goes to the nearest tone). Choral sense: a singer does not
// hold one note longer than four bars. A chord that itself lasts longer (every 8 bars) cannot be cut by
// this; it just never carries a pitch class across a line. Where the mode and the number of voices leave
// no way round, a pitch class stays for one more chord.
export const HOLD_BARS = 4

const AHEAD = 64 // bars generated at a time on an endless journey

export class Progression {
  private lines: Line[] = []
  private byBar = new Map<number, Line>()
  private nextBar = 0 // the next bar to look at
  private lastBar: number // the final line's bar of a finite journey (-1: none, Infinity: endless)
  private rng: () => number
  private recent: string[] = []
  private previous: number[] | null = null
  private since = new Map<number, number>() // the bar each pitch class of the sounding set came in at
  private voices: number
  private readonly bar: number
  private readonly limit: number // no line at or after this time

  constructor(private layout: Layout, seed: number) {
    this.bar = layout.barSeconds
    this.rng = mulberry((seed ^ 0x5bd1e995) >>> 0)
    this.voices = voicesFor(layout.arousals[0], 4)
    const finite = Number.isFinite(layout.duration)
    this.limit = finite ? layout.duration - 4 : Infinity
    this.lastBar = Infinity
    if (finite) {
      this.lastBar = -1
      for (let k = 0; START + k * this.bar < this.limit; k++) if (this.isLine(k)) this.lastBar = k
      this.until(Infinity)
    }
  }

  private timeOf = (k: number) => START + k * this.bar

  private isLine(k: number): boolean {
    const t = this.timeOf(k)
    const n = barsAt(this.layout, t)
    return n > 0 && k % n === 0 && t < this.limit
  }

  // Generate every line up to (and including) time t.
  private until(t: number) {
    if (!this.bar) return
    while (this.nextBar <= this.lastBar && this.timeOf(this.nextBar) <= t) {
      const k = this.nextBar++
      if (this.isLine(k)) this.add(k)
    }
  }

  private add(k: number) {
    const time = this.timeOf(k)
    const { rung, tonic } = stateAt(this.layout, time + 1e-6) // steps due on this bar line are made
    const arousal = arousalAt(this.layout, time)
    const opening = k === 0
    const close = k === this.lastBar
    this.voices = voicesFor(arousal, this.voices)
    const scale = [...pcsOf(rung, tonic)]
    // a pitch class that would sound past HOLD_BARS if this chord kept it has to go
    const bars = barsAt(this.layout, time)
    const stale = opening || !this.previous ? [] : this.previous.filter((pc) => k + bars - (this.since.get(pc) ?? k) > HOLD_BARS)
    const picked = pickSet({
      scale,
      tonic,
      colour: colorPc(rung, tonic),
      third: thirdPc(rung, tonic),
      previous: opening ? null : this.previous,
      voices: this.voices,
      arousal,
      tonicBass: opening || close,
      recent: this.recent,
      stale,
      rng: this.rng,
    })
    const pcs = picked ? picked.pcs : scale.slice(0, this.voices).sort((a, b) => a - b)
    if (picked) {
      this.recent.push(picked.key)
      if (this.recent.length > 4) this.recent.shift()
    }
    const came = new Map<number, number>()
    for (const pc of pcs) came.set(pc, !opening && this.previous?.includes(pc) ? this.since.get(pc) ?? k : k)
    this.since = came
    this.previous = pcs
    const line: Line = { bar: k, time, bars, rung, tonic, pcs, opening, close }
    this.lines.push(line)
    this.byBar.set(k, line)
  }

  // Every line generated so far (a finite journey's are all there from the start).
  get generated(): readonly Line[] {
    return this.lines
  }

  // The line at bar k, if there is one.
  atBar(k: number): Line | undefined {
    this.until(this.timeOf(k) + 1e-6)
    return this.byBar.get(k)
  }

  // The first line at or after time t (and its index, which counts lines from 0).
  firstFrom(t: number): { line: Line; index: number } | undefined {
    this.until(Number.isFinite(t) ? t + AHEAD * this.bar : t)
    const index = this.lines.findIndex((l) => l.time >= t - 1e-6)
    return index < 0 ? undefined : { line: this.lines[index], index }
  }

  // The line after the one at `index`.
  after(index: number): Line | undefined {
    this.until(this.lines[index] ? this.lines[index].time + AHEAD * this.bar : 0)
    return this.lines[index + 1]
  }
}
