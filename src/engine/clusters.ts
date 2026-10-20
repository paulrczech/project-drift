// Clusters on bars: the whole chord changes at once, on a downbeat. Where `DriftEngine.step()`
// moves one voice in free time, this picks a new set of pitch classes from the mode — stacked
// fifths and fourths when it is calm, seconds and sixths creeping in as the mood energises —
// and voices it so that every voice goes to the nearest tone of the new chord (voice leading
// kept: a change of cluster is a handful of small steps, never a jump). Framework-free, pure,
// deterministic for a given rng.

import { sortCluster, type Cluster } from './eddy/noteUtils'

export interface PickInput {
  scale: number[] // the mode's seven pitch classes
  tonic: number
  colour: number // the pitch class that tells the mode apart
  third: number
  previous: Cluster | null // what sounds now (null at the opening)
  voices: number // 3 or 4
  low: number // the voices' window
  high: number
  center: number // the register the mood leans toward
  arousal: number // 0 still … 1 energised
  spread: number // 0 tight … 1 wide: the voice's way of spacing a chord
  tonicBass: boolean // the lowest voice sounds the tonic (the opening and the close)
  recent: string[] // the sets of pitch classes used lately
  ok: (c: Cluster) => boolean // spacing the voice can take
  rng: () => number
}

export interface Picked {
  cluster: Cluster
  key: string // the set of pitch classes, for `recent`
}

// every way of choosing k of the items
function subsets<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const [head, ...rest] = items
  return [...subsets(rest, k - 1).map((s) => [head, ...s]), ...subsets(rest, k)]
}

// How well a set of pitch classes suits the mood. Calm: open intervals (fourths, fifths), no
// clashes. Energised: thirds and seconds are welcome. A semitone between two pitch classes is
// always shaded (it can still be voiced a ninth apart). The mode's own colour tone, the tonic and
// the third count for a little, so the mode stays audible.
function setScore(pcs: number[], p: PickInput): number {
  const calm = 1 - p.arousal
  let s = 0
  for (let i = 0; i < pcs.length; i++)
    for (let j = i + 1; j < pcs.length; j++) {
      const d = Math.abs(pcs[i] - pcs[j]) % 12
      const ic = Math.min(d, 12 - d)
      if (ic === 5) s += 0.5 + 0.9 * calm
      else if (ic === 4 || ic === 3) s += 0.3 + 0.5 * p.arousal
      else if (ic === 2) s += 0.2 * p.arousal - 0.3 * calm
      else if (ic === 1) s -= 2
      else if (ic === 6) s -= 0.3
    }
  if (pcs.includes(p.colour)) s += 1.5
  if (pcs.includes(p.tonic)) s += 0.8
  if (pcs.includes(p.third)) s += 0.5
  return s
}

// All the ways of putting these pitch classes in the window, ascending, one note each.
function voicings(pcs: number[], p: PickInput): Cluster[] {
  const choices = pcs.map((pc) => {
    const notes: number[] = []
    for (let n = p.low; n <= p.high; n++) if (n % 12 === pc) notes.push(n)
    return notes
  })
  if (choices.some((c) => !c.length)) return []
  const out: Cluster[] = []
  const walk = (i: number, so: number[]) => {
    if (i === choices.length) return void out.push(sortCluster(so))
    for (const n of choices[i]) walk(i + 1, [...so, n])
  }
  walk(0, [])
  return out
}

const ENTERS = 3 // what a voice that enters or leaves costs, in semitones of movement

// The movement from one cluster to the next, voice to nearest voice (in pitch order, the best
// pairing for a line of notes). A cluster of a different size lets one voice enter or leave.
function movement(from: Cluster, to: Cluster): number {
  const pair = (a: Cluster, b: Cluster) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]) + Math.max(0, Math.abs(n - b[i]) - 7) * 2, 0)
  if (from.length === to.length) return pair(from, to)
  if (from.length > to.length) return Math.min(...from.map((_, i) => pair(from.filter((__, j) => j !== i), to))) + ENTERS
  return Math.min(...to.map((_, i) => pair(from, to.filter((__, j) => j !== i)))) + ENTERS
}

// The cost of a voicing: small movement, a width near what the voice likes, near the register
// the mood leans toward. The tonic in the bass is required at the opening and the close.
function cost(c: Cluster, p: PickInput): number {
  const tight = 14
  const wide = Math.max(tight, 0.92 * (p.high - p.low))
  const target = tight + (wide - tight) * p.spread
  const mean = c.reduce((a, n) => a + n, 0) / c.length
  let x = (0.25 + 0.6 * p.spread) * Math.abs(c[c.length - 1] - c[0] - target) + 0.2 * Math.abs(mean - p.center)
  // a wide voicing is spread evenly, not a bass and a huddle above it
  const gaps = c.slice(1).map((n, i) => n - c[i])
  x += p.spread * 0.4 * (Math.max(...gaps) - (c[c.length - 1] - c[0]) / gaps.length)
  if (p.previous) {
    x += movement(p.previous, c)
    // a cluster that is hardly new is no change: at least two notes must differ
    const kept = c.filter((n) => p.previous!.includes(n)).length
    if (c.length - kept < Math.min(2, c.length - 1)) x += 10
  }
  return x
}

export function pickCluster(p: PickInput): Picked | null {
  const k = Math.min(p.voices, p.scale.length)
  const options: { cluster: Cluster; key: string; score: number }[] = []
  for (const pcs of subsets(p.scale, k)) {
    if (p.tonicBass && !pcs.includes(p.tonic)) continue
    const key = [...pcs].sort((a, b) => a - b).join(',')
    let best: Cluster | null = null
    let bestCost = Infinity
    for (const c of voicings(pcs, p)) {
      if (!p.ok(c)) continue
      if (p.tonicBass && c[0] % 12 !== p.tonic) continue
      const x = cost(c, p)
      if (x < bestCost) {
        bestCost = x
        best = c
      }
    }
    if (!best) continue
    const fresh = p.recent.includes(key) ? -3 : 0
    options.push({ cluster: best, key, score: setScore(pcs, p) + fresh - 0.2 * bestCost })
  }
  if (!options.length) return null
  // among the best few, a weighted draw
  options.sort((a, b) => b.score - a.score)
  const top = options.slice(0, 5)
  const weights = top.map((o) => Math.exp((o.score - top[0].score) / 0.8))
  let r = p.rng() * weights.reduce((a, w) => a + w, 0)
  for (let i = 0; i < top.length; i++) {
    r -= weights[i]
    if (r <= 0) return { cluster: top[i].cluster, key: top[i].key }
  }
  return { cluster: top[0].cluster, key: top[0].key }
}
