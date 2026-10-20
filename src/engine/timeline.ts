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

import { BARS, DEFAULT_BARS, DEFAULT_VARIATION, START, VARIATIONS, type Bars, type Variation, type Waypoint } from './compose'
import { DENSITIES, GRIDS, type Density, type Grid } from './pulse'
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
    // bar 1 is START seconds into the music, so the first stop's settle carries them: every later stop
    // then begins on a bar line, and so does each section
    hold: n.holdSeconds ?? n.holdBars * bar + (i === 0 ? START : 0),
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

// ── as a file ─────────────────────────────────────────────────────────────────────────

export const hasSections = (t: Timeline) => t.sections.some((s) => s.name)

// the stops a timeline passes through, as the field holds them
export const pointsOf = (t: Timeline) =>
  nodesOf(t).map((n) => ({
    v: n.v,
    a: n.a,
    ...(n.key === undefined ? {} : { key: n.key }),
    ...(n.grid === undefined ? {} : { grid: n.grid }),
    ...(n.density === undefined ? {} : { density: n.density }),
    ...(n.variation === undefined ? {} : { variation: n.variation }),
    ...(n.bars === undefined ? {} : { bars: n.bars }),
  }))

const round = (n: number) => Math.round(n * 10000) / 10000

// JSON has no Infinity: a node that stays has a null hold. Exact seconds (Journeyer's) are not kept:
// a file holds bars.
export function timelineToJSON(t: Timeline) {
  return {
    bpm: t.bpm,
    sections: t.sections.map((s) => ({
      name: s.name,
      nodes: s.nodes.map((n) => ({
        v: round(n.v),
        a: round(n.a),
        key: n.key ?? null,
        grid: n.grid ?? null,
        density: n.density ?? null,
        variation: n.variation ?? null,
        bars: n.bars ?? null,
        holdBars: Number.isFinite(n.holdBars) ? round(n.holdBars) : null,
        walkBars: round(n.walkBars),
      })),
    })),
  }
}

export const MAX_SECTIONS = 32
export const MAX_NODES = 64

// Reads a timeline from a file; anything wrong is turned away with a reason.
export function parseTimeline(raw: any, bpmRange: [number, number]): { ok: true; timeline: Timeline } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason })
  const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections) || !raw.sections.length) return no('That project has no sections.')
  if (!isNum(raw.bpm) || raw.bpm < bpmRange[0] || raw.bpm > bpmRange[1]) return no('That project has no tempo.')
  if (raw.sections.length > MAX_SECTIONS) return no('That project has too many sections.')
  const sections: Section[] = []
  let count = 0
  for (const rs of raw.sections) {
    if (!rs || !Array.isArray(rs.nodes) || !rs.nodes.length) return no('That project has an empty section.')
    const nodes: Node[] = []
    for (const rn of rs.nodes) {
      count++
      if (!rn || !isNum(rn.v) || !isNum(rn.a) || rn.v < 0 || rn.v > 1 || rn.a < 0 || rn.a > 1) return no('That project has a stop that is not on the field.')
      if (!isNum(rn.walkBars) || rn.walkBars < 0) return no('That project has a walk with no length.')
      const stays = rn.holdBars === null
      if (!stays && (!isNum(rn.holdBars) || rn.holdBars <= 0)) return no('That project has a stop with no length.')
      const node: Node = { v: rn.v, a: rn.a, holdBars: stays ? Infinity : rn.holdBars, walkBars: rn.walkBars }
      if (Number.isInteger(rn.key) && rn.key >= 0 && rn.key <= 11) node.key = rn.key
      if (GRIDS.includes(rn.grid)) node.grid = rn.grid
      if (DENSITIES.includes(rn.density)) node.density = rn.density
      if (VARIATIONS.includes(rn.variation)) node.variation = rn.variation
      if (BARS.includes(rn.bars)) node.bars = rn.bars
      nodes.push(node)
    }
    sections.push({ name: typeof rs.name === 'string' ? rs.name.slice(0, 40) : '', nodes })
  }
  if (count > MAX_NODES) return no('That project has too many stops.')
  const all = sections.flatMap((s) => s.nodes)
  // only the last node may stay; the first has its variation and bars set
  if (all.slice(0, -1).some((n) => !Number.isFinite(n.holdBars))) return no('Only the last stop can stay.')
  all[0].variation ??= DEFAULT_VARIATION
  all[0].bars ??= DEFAULT_BARS
  return { ok: true, timeline: { bpm: raw.bpm, sections } }
}
