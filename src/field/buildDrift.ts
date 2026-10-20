// What a Begin works out, with no Vue in it: the stops and the sound menu's settings in, the timeline, the plan, its
// layout in time, the stages shown in the readout and the record an export is made from out. The only
// chance in it is `random`, drawn in a fixed order (the key, then the seed), so a test can give it
// fixed numbers.

import { NOTE_NAMES } from '../engine/score'
import { BARS_NAME, layoutTimeline, type Bars, type Layout, type TimelinePlan, type Variation } from '../engine/compose'
import type { Density, Grid } from '../engine/pulse'
import { modeName } from '../engine/drift'
import { barSecondsAt, pointsOf, totalBars, timelineFromStops, toPlan, type Timeline } from '../engine/timeline'
import { describe, type Point } from './moodPlane'

export type Plan = Omit<TimelinePlan, 'rng'>

// one entry of the readout: a mode (and key) the journey sounds in, and the stops it covers
export interface Stage {
  mode: string
  key: number // pitch class
  label: string // "dorian", or "Ab major" when the journey changes key
  rung: number
  from: number
  to: number
}

// what is kept on screen for a composer to note: key, modes, tempo, seed
export interface Readout {
  key: string
  uniform: boolean
  stages: Stage[]
  bpm?: number
  bars?: number
  eased?: boolean
  seed: string
}

// what was begun, so it can be taken away exactly as it sounded (same plan, seed, voice, tempo)
export interface DriftRecord {
  voiceId: string
  plan: Plan
  seed: number
  bpm?: number
  grid?: Grid
  density?: Density
  stops: string
  minutes: number
  key: string // the key it starts in
  head: string // the key as it begins a file name ('' when the journey changes key)
  modes: string[] // one label per stage
  points: Point[]
  words: string[]
  timeline: Timeline
}

export const ordinal = (n: number) => `stop ${n}`
export const lengthName = (m: number) => (m === Infinity ? 'with no end' : m === 1 ? 'for 1 minute' : `for ${m} minutes`)

export interface DriftInput {
  points: Point[]
  minutes: number
  voiceId: string
  pulse: boolean // the sound is the pulse
  bpm: number // the tempo this drift is begun with (every sound)
  grid: Grid // the sound menu's
  density: Density
  variation: Variation
  bars: Bars
  rootChoice: number | null // the key chosen, or null for a new one each drift
  kept: { seed: number; key: number } | null // "keep seed"
  seedOverride: number | null // an opened project's seed, for this Begin only
  random: () => number // [0, 1), as Math.random
  // A sketch: a timeline made elsewhere (a project file). It replaces the stops, length and tempo above
  // (its nodes are the stops; its tempo is the drift's); the sound menu's variation and bars are then the
  // first node's, and the key is still `rootChoice` / kept / new.
  timeline?: Timeline
}

export interface Drift {
  timeline: Timeline // the journey counted in bars (Journeyer's is one section)
  plan: Plan
  seed: number
  bpm: number
  grid?: Grid // the pulse's only
  density?: Density
  voiceId: string
  layout: Layout
  readout: Readout
  record: DriftRecord
  announcement: string
  eased: { stop: number; asked: Bars; got: Bars }[]
}

export function buildDrift(input: DriftInput): Drift {
  const { voiceId, pulse } = input
  const bpm = input.timeline?.bpm ?? input.bpm
  const points: Point[] = input.timeline ? pointsOf(input.timeline) : input.points
  // a sketch's length is its bars at its tempo (Infinity if its last stop stays)
  const minutes = input.timeline ? totalBars(input.timeline) * (barSecondsAt(bpm) / 60) : input.minutes
  const wordFor = describe
  // each stop's key: the first is the journey's (chosen, or kept, or a fresh one each drift); a later stop
  // with none chosen keeps the key of the stop before it
  const tonics: number[] = []
  points.forEach((p, i) =>
    tonics.push(i === 0 ? input.rootChoice ?? input.kept?.key ?? Math.floor(input.random() * 12) : p.key ?? tonics[i - 1])
  )
  // Length is for the whole drift: 15% settled where you are, 30% arriving where you are going (ending in
  // the fade), the middle 55% travelling (see timelineFromStops)
  const timeline = input.timeline ?? timelineFromStops(points, minutes, bpm, { variation: input.variation, bars: input.bars })
  const { waypoints, walk, sections } = toPlan(timeline, tonics)
  const plan: Plan = { waypoints, walk, sections, tonic: tonics[0] }
  const seed = input.seedOverride ?? input.kept?.seed ?? Math.floor(input.random() * 2 ** 31)
  const grid = pulse ? input.grid : undefined
  const density = pulse ? input.density : undefined
  const uniform = tonics.every((t) => t === tonics[0])
  const stages: Stage[] = []
  plan.waypoints.forEach((w, i) => {
    const last = stages[stages.length - 1]
    if (last && last.rung === w.rung && last.key === tonics[i]) last.to = i
    else {
      const mode = modeName(w.rung)
      stages.push({ mode, key: tonics[i], label: uniform ? mode : `${NOTE_NAMES[tonics[i]]} ${mode}`, rung: w.rung, from: i, to: i })
    }
  })
  const layout = layoutTimeline(plan.waypoints, plan.walk, plan.tonic, bpm, plan.sections)
  // the tempo is shown where it matters: the pulse plays to it, and bars are counted in it
  const onBars = plan.waypoints.some((w) => w.bars)
  // a stop's chord setting that does not fit its stretch of the journey is eased to the longest that does
  const eased = layout.bars.flatMap((b, i) => (b !== layout.barsAsked[i] ? [{ stop: i, asked: layout.barsAsked[i] as Bars, got: b as Bars }] : []))
  const readout: Readout = {
    key: NOTE_NAMES[tonics[0]],
    uniform,
    stages,
    bpm: pulse || onBars ? bpm : undefined,
    bars: layout.barSeconds && Number.isFinite(layout.duration) ? Math.round(layout.duration / layout.barSeconds) : undefined,
    eased: eased.length > 0,
    seed: `seed ${seed}`,
  }
  const words = points.map(wordFor)
  const record: DriftRecord = {
    voiceId,
    plan,
    seed,
    bpm,
    grid,
    density,
    stops: words.join(' > '),
    minutes,
    key: readout.key,
    head: uniform ? readout.key : '',
    modes: stages.map((st) => st.label),
    points: points.map((p) => ({ ...p })),
    words,
    timeline,
  }
  const barsAtFirst = (plan.waypoints[0].bars ?? 0) as Bars
  const route =
    words.length === 1
      ? `in ${words[0]}`
      : `from ${words[0]}${words.length > 2 ? ` through ${words.slice(1, -1).join(', ')}` : ''} to ${words[words.length - 1]}`
  const announcement =
    `Drifting ${route} ${input.timeline && Number.isFinite(minutes) ? `for ${Math.round(totalBars(input.timeline))} bars` : lengthName(minutes)}, ${uniform ? `in ${NOTE_NAMES[tonics[0]]}` : `from ${NOTE_NAMES[tonics[0]]} to ${NOTE_NAMES[tonics[tonics.length - 1]]}`}${pulse || onBars ? `, ${bpm} beats per minute` : ''}${onBars && barsAtFirst ? `, a new ${pulse ? 'pattern' : 'cluster'} ${BARS_NAME[barsAtFirst]}` : ''}.` +
    eased.map((e) => ` ${pulse ? 'Pattern' : 'Chords'} at ${ordinal(e.stop + 1)} eased from ${BARS_NAME[e.asked]} to ${BARS_NAME[e.got]}, to fit.`).join('')
  return { timeline, plan, seed, bpm, grid, density, voiceId, layout, readout, record, announcement, eased }
}
