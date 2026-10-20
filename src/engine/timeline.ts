// A journey counted in bars: sections, each a list of nodes (a node is a stop: a mood, with the
// settings it may carry), and for every node how long it settles and how long the voice-led walk to
// the next one takes. Pure data and arithmetic — no Vue, no Tone, no chance. `toPlan` turns it into
// the plan the composer already takes (lengths in seconds at the timeline's tempo), so everything
// from `layoutTimeline` on is unchanged.
//
// Journeyer (a length in minutes, up to six stops, one continuous walk) is one section made by
// `timelineFromStops`. A sketch is several sections: they are labels over the same continuous
// journey, and the walk that ends a section is as long as its node says — 0 bars is a cut on the
// bar line (the whole chord changes at once, still voice-led).

import type { Bars, Variation, Waypoint } from './compose'
import type { Density, Grid } from './pulse'
import { rungFor } from './moods'

export interface Node {
  v: number // valence 0..1
  a: number // arousal 0..1
  // what the node sets; left out, it is the node before's (the first node's variation and bars are always set)
  key?: number
  grid?: Grid
  density?: Density
  variation?: Variation
  bars?: Bars
  holdBars: number // bars settled here (Infinity: stay)
  walkBars: number // bars of walk to the next node (ignored on the last)
  // Journeyer's lengths come from minutes, not bars. These are the exact seconds they were worked out
  // in, which `toPlan` uses when present (bars × seconds-per-bar would differ in the last digits, and
  // a seed's music must not move). `snapToBars` drops them: a timeline in whole bars has none.
  holdSeconds?: number
  walkSeconds?: number
}

export interface Section {
  name: string // '' for an unnamed section (Journeyer's)
  nodes: Node[]
}

export interface Timeline {
  bpm: number
  sections: Section[]
}

// the part of a plan a timeline gives: the composer's plan minus the key and the random source
export interface TimelineShape {
  waypoints: Waypoint[]
  walk: number | number[]
  sections: { name: string; from: number }[] // from: the waypoint each section starts at
}

export const BEATS_PER_BAR = 4
export const barSecondsAt = (bpm: number) => (BEATS_PER_BAR * 60) / bpm

export const nodesOf = (t: Timeline): Node[] => t.sections.flatMap((s) => s.nodes)

// Bars of the whole timeline (Infinity when the last node stays).
export function totalBars(t: Timeline): number {
  const nodes = nodesOf(t)
  return nodes.reduce((sum, n, i) => sum + n.holdBars + (i < nodes.length - 1 ? n.walkBars : 0), 0)
}

// The plan's waypoints and walks. `tonics` is one pitch class per node, already resolved (a node
// with no key of its own has the key of the node before; the first is the journey's).
export function toPlan(t: Timeline, tonics: number[]): TimelineShape {
  const nodes = nodesOf(t)
  const bar = barSecondsAt(t.bpm)
  const waypoints: Waypoint[] = nodes.map((n, i) => ({
    rung: rungFor(n.v),
    arousal: n.a,
    tonic: tonics[i],
    variation: n.variation,
    grid: n.grid,
    density: n.density,
    bars: n.bars,
    hold: n.holdSeconds ?? n.holdBars * bar,
  }))
  const walks = nodes.slice(0, -1).map((n) => n.walkSeconds ?? n.walkBars * bar)
  const equal = walks.every((w) => w === walks[0])
  const from: number[] = []
  t.sections.reduce((i, s) => (from.push(i), i + s.nodes.length), 0)
  return {
    waypoints,
    walk: walks.length === 0 ? 0 : equal ? walks[0] : walks,
    sections: t.sections.map((s, k) => ({ name: s.name, from: from[k] })),
  }
}

// Whole bars: every length rounded to a whole number of bars (a settle lasts at least one bar).
export function snapToBars(t: Timeline): Timeline {
  const whole = (x: number) => (Number.isFinite(x) ? Math.round(x) : x)
  return {
    ...t,
    sections: t.sections.map((s) => ({
      ...s,
      nodes: s.nodes.map(({ holdSeconds, walkSeconds, ...n }) => ({ ...n, holdBars: Math.max(1, whole(n.holdBars)), walkBars: Math.max(0, whole(n.walkBars)) })),
    })),
  }
}

// Journeyer's journey as a timeline: a length in minutes shared out as 15% settled where you are,
// 55% travelling (a third of a leg settled at each middle stop), 30% arriving and fading out; ∞
// travels over ten minutes, then stays. Lengths come out as fractions of a bar — they are not
// rounded, so the music is as it always was.
export function timelineFromStops(
  points: { v: number; a: number; key?: number; grid?: Grid; density?: Density; variation?: Variation; bars?: Bars }[],
  minutes: number,
  bpm: number,
  first: { variation: Variation; bars: Bars } // the first stop's variation and bars are the sound menu's
): Timeline {
  const endless = minutes === Infinity
  const total = (endless ? 10 : minutes) * 60
  const bar = barSecondsAt(bpm)
  const n = points.length
  const nodes: Node[] = points.map((p, i) => ({
    v: p.v,
    a: p.a,
    // a later stop may set the pulse's grid and density, and every sound's variation; the first stop's are the sound menu's
    ...(i > 0 ? { key: p.key, grid: p.grid, density: p.density } : {}),
    variation: i > 0 ? p.variation : first.variation,
    bars: i > 0 ? p.bars : first.bars,
    holdBars: 0,
    walkBars: 0,
  }))
  const set = (node: Node, hold: number, walk: number) => {
    node.holdSeconds = hold
    node.holdBars = hold / bar
    node.walkSeconds = walk
    node.walkBars = walk / bar
  }
  if (n === 1) set(nodes[0], endless ? Infinity : total, 0)
  else {
    const leg = (total * 0.55) / (n - 1 + 0.3 * (n - 2))
    nodes.forEach((node, i) =>
      set(node, i === 0 ? total * 0.15 : i === n - 1 ? (endless ? Infinity : total * 0.3) : leg * 0.3, i < n - 1 ? leg : 0)
    )
  }
  return { bpm, sections: [{ name: '', nodes }] }
}
