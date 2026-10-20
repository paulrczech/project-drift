// Clusters on bars: the whole chord changes at once, on a downbeat. Where `DriftEngine.step()`
// moves one voice in free time, this works in two parts, so that every sound can follow the same
// progression:
//   pickSet   chooses a set of pitch classes from the mode — stacked fifths and fourths when it is
//             calm, seconds and sixths creeping in as the mood energises — knowing nothing of any
//             voice (see progression.ts, which draws one per bar line from the seed);
//   voiceSet  puts a given set in one voice's window so that every voice goes to the nearest tone
//             of the new chord (voice leading kept: a change of cluster is a handful of small steps,
//             never a jump). No randomness.
// Framework-free, pure.

import { sortCluster, type Cluster } from './eddy/noteUtils'

export interface SetInput {
  scale: number[] // the mode's seven pitch classes
  tonic: number
  colour: number // the pitch class that tells the mode apart
  third: number
  previous: number[] | null // the pitch classes sounding now (null at the opening)
  voices: number // 3 or 4
  arousal: number // 0 still … 1 energised
  tonicBass: boolean // the set holds the tonic (the opening and the close put it in the bass)
  recent: string[] // the sets used lately
  rng: () => number
}

export interface PickedSet {
  pcs: number[] // ascending
  key: string // for `recent`
}

export interface VoiceInput {
  pcs: number[]
  tonic: number
  previous: Cluster | null // what this voice sounds now (null at the opening)
  low: number // the voice's window
  high: number
  center: number // the register the mood leans toward
  spread: number // 0 tight … 1 wide: the voice's way of spacing a chord
  tonicBass: boolean // the lowest voice sounds the tonic
  ok: (c: Cluster) => boolean // spacing the voice can take
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
function setScore(pcs: number[], p: SetInput): number {
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

// How far the pitch classes have to travel: each new one to the nearest of the old ones, in
// semitones (what voice leading would move, without knowing any voice's octave).
function travel(from: number[], to: number[]): number {
  return to
    .filter((pc) => !from.includes(pc))
    .reduce((sum, pc) => sum + Math.min(...from.map((f) => Math.min((pc - f + 12) % 12, (f - pc + 12) % 12))), 0)
}

export function pickSet(p: SetInput): PickedSet | null {
  const k = Math.min(p.voices, p.scale.length)
  const options: { pcs: number[]; key: string; score: number }[] = []
  for (const set of subsets(p.scale, k)) {
    if (p.tonicBass && !set.includes(p.tonic)) continue
    const pcs = [...set].sort((a, b) => a - b)
    const key = pcs.join(',')
    let score = setScore(pcs, p) + (p.recent.includes(key) ? -3 : 0)
    if (p.previous) {
      score -= 0.2 * travel(p.previous, pcs)
      // a set that is hardly new is no change: at least two pitch classes must differ
      const fresh = pcs.filter((pc) => !p.previous!.includes(pc)).length
      if (fresh < Math.min(2, pcs.length - 1)) score -= 2
    }
    options.push({ pcs, key, score })
  }
  if (!options.length) return null
  // among the best few, a weighted draw
  options.sort((a, b) => b.score - a.score)
  const top = options.slice(0, 5)
  const weights = top.map((o) => Math.exp((o.score - top[0].score) / 0.8))
  let r = p.rng() * weights.reduce((a, w) => a + w, 0)
  for (let i = 0; i < top.length; i++) {
    r -= weights[i]
    if (r <= 0) return { pcs: top[i].pcs, key: top[i].key }
  }
  return { pcs: top[0].pcs, key: top[0].key }
}

// All the ways of putting these pitch classes in the window, ascending, one note each.
function voicings(pcs: number[], p: VoiceInput): Cluster[] {
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
// the mood leans toward.
function cost(c: Cluster, p: VoiceInput): number {
  const tight = 14
  const wide = Math.max(tight, 0.92 * (p.high - p.low))
  const target = tight + (wide - tight) * p.spread
  const mean = c.reduce((a, n) => a + n, 0) / c.length
  let x = (0.25 + 0.6 * p.spread) * Math.abs(c[c.length - 1] - c[0] - target) + 0.2 * Math.abs(mean - p.center)
  // a wide voicing is spread evenly, not a bass and a huddle above it
  const gaps = c.slice(1).map((n, i) => n - c[i])
  x += p.spread * 0.4 * (Math.max(...gaps) - (c[c.length - 1] - c[0]) / gaps.length)
  if (p.previous) x += movement(p.previous, c)
  return x
}

// The set in this voice's window. If the voice cannot take its spacing (a narrow window), the
// spacing check is relaxed rather than the set dropped, so every voice can follow one progression.
export function voiceSet(p: VoiceInput): Cluster | null {
  const all = voicings(p.pcs, p).filter((c) => !p.tonicBass || c[0] % 12 === p.tonic)
  for (const pool of [all.filter((c) => p.ok(c)), all]) {
    let best: Cluster | null = null
    let bestCost = Infinity
    for (const c of pool) {
      const x = cost(c, p)
      if (x < bestCost) {
        bestCost = x
        best = c
      }
    }
    if (best) return best
  }
  return null
}
