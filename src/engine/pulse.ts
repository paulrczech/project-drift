// The second way to play a drift: an ostinato. Where the pad lets chords swell and move
// in free time, this keeps a steady pulse of repeated notes. It begins with ONE note, the
// tonic, and the notes of the chord join the pattern one at a time as the journey goes on,
// a gradual process in the manner of Reich and Glass. The harmony beneath is the same engine
// as ever: the mode walk, the one-voice moves, arousal — only how the chord is performed
// changes. Tempo follows arousal (slower when still, quicker when energised).
//
// Pure and deterministic for a given rng, and streaming (`pull(until)`), like Composer.

import { DriftEngine, beatFor, colorPc, thirdPc, type Rung } from './drift'
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

export interface PulsePlan extends VoiceParams {
  waypoints: Waypoint[]
  walk: number | number[]
  tempoScale?: number // from TEMPO_FEEL
  growth?: number // seconds between one more note joining (default: set by the length)
}

const START = 0.25 // seconds before the first pulse
const HOLD = 0.92 // how much of a step a note is held

// The notes in the order they join the pattern: the tonic first — always, even at the moments
// the chord does not hold it, so the opening note never wavers — then the mode's colour tone,
// its third, its fifth, then whatever else the chord holds.
function joinOrder(cluster: number[], rung: Rung, tonic: number, tonicNote: number): number[] {
  const color = colorPc(rung, tonic)
  const third = thirdPc(rung, tonic)
  const fifth = (tonic + 7) % 12
  const rank = (n: number) => {
    const pc = n % 12
    return pc === color ? 1 : pc === third ? 2 : pc === fifth ? 3 : 4
  }
  const rest = cluster.filter((n) => n % 12 !== tonic).sort((a, b) => rank(a) - rank(b) || a - b)
  return [tonicNote, ...rest]
}

// Up, then back down through the inner notes: a b c d c b …
function updown(notes: number[]): number[] {
  const up = [...notes].sort((a, b) => a - b)
  return [...up, ...up.slice(1, -1).reverse()]
}

export class PulseComposer {
  readonly layout: Layout
  private engine: DriftEngine
  private rng: () => number
  private beat: number | undefined
  private tempoScale: number
  private growth: number
  private flips: Flip[]
  private nextFlip = 0
  private moveAt: number // when the next harmonic move happens
  private t = START // the next pulse
  private k = 0 // pulse counter, so the pattern carries on across changes of chord

  constructor(plan: PulsePlan) {
    this.rng = plan.rng ?? Math.random
    this.beat = plan.beat
    this.tempoScale = plan.tempoScale ?? 1
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
    // a full pattern after about a third of a finite journey (never faster than every 6s)
    const d = this.layout.duration
    this.growth = plan.growth ?? (Number.isFinite(d) ? Math.min(45, Math.max(6, (0.35 * d) / 3)) : 30)
    this.moveAt = this.baseBeat(0) * (0.6 + 0.4 * this.rng())
  }

  get tonic(): number {
    return this.engine.tonic
  }

  private baseBeat(t: number): number {
    return this.beat ?? beatFor(arousalAt(this.layout, t))
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

  // Events that start before `until`, in time order. Call with an increasing `until`.
  pull(until: number): NoteEvent[] {
    const out: NoteEvent[] = []
    const end = Math.min(until, this.layout.duration)
    while (this.t < end) {
      const t = this.t
      this.harmonyAt(t)
      const a = arousalAt(this.layout, t)
      const step = 30 / pulseBpm(a, this.tempoScale) // an eighth note
      const order = joinOrder(this.engine.cluster, this.engine.rung, this.engine.tonic, this.engine.tonicNote)
      const count = Math.min(order.length, 1 + Math.floor((t - START) / this.growth))
      const pattern = updown(order.slice(0, count))
      const i = this.k % pattern.length
      out.push({
        time: t,
        note: pattern[i],
        hold: step * HOLD,
        chain: 0,
        velocity: i === 0 ? 1 : 0.8,
      })
      this.k++
      this.t += step
    }
    return out
  }
}
