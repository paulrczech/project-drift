// Drift's generative harmony: a slow stream of one-voice moves inside a mode, and
// mode-to-mode transitions that are real voice leading. Pure TypeScript — no Tone,
// no Vue — so it can be measured in Node and scheduled by whatever plays it.
//
// Every mood in a drift lives on ONE tonal centre (D unless told otherwise), so the
// brightness ladder is a set of parallel modes. Adjacent rungs differ by exactly one scale degree, a semitone
// apart, so walking the ladder moves one voice by one semitone at a time.

import { SCALE_MAP, getScaleNotes } from './eddy/scales'
import { STRATEGY_MAP } from './eddy/strategies'
import { generateCandidates } from './eddy/voiceLeading'
import { type Cluster, sortCluster } from './eddy/noteUtils'

export const DEFAULT_TONIC = 2 // D (pitch class, 0 = C)

// Brightest to darkest. Each step down lowers exactly one degree by a semitone.
export const LADDER = [
  'lydian',
  'major',
  'mixolydian',
  'dorian',
  'minor',
  'phrygian',
  'locrian',
] as const
export type Rung = number // index into LADDER

// One-voice, stepwise strategies from Eddy's deck. Anything that moves several
// voices at once, leaps ('free'), or borrows from outside the key is left out.
const GENTLE = [
  'keep-most-dissonant',
  'top-stays',
  'hold-bass',
  'drop-the-third',
  'same-root-new-quality',
  'least-expected-survives',
  'two-common-contrary',
].filter((id) => STRATEGY_MAP[id])

// The interval above the tonic that tells each mode apart from its neighbours: Lydian's
// #4, Ionian's leading tone, Mixolydian's b7, Dorian's natural 6, Aeolian's b6,
// Phrygian's b2, Locrian's b5. The stream keeps one on the air so the mode is heard,
// not just implied.
const COLOR_INTERVAL = [6, 11, 10, 9, 8, 1, 6]

export interface Move {
  from: number
  to: number
}

export interface DriftOptions {
  rung: Rung
  tonic?: number // pitch class of the tonal centre, 0-11 (default D)
  low?: number // lowest MIDI note any voice may reach (default: just under the tonic)
  high?: number // highest
  voices?: number
  rng?: () => number
}

// The register moves with the tonic, so every key plays the same shape of music: the
// root sits near D3 (anywhere from G#2 to G#3), the window starts just under it and
// spans a little over two octaves. Samples cover E2-C6, so every window fits.
const WINDOW_SPAN = 28

export function rootNear(tonic: number, near = 50): number {
  let best = near
  for (let n = near - 6; n <= near + 5; n++) if (n % 12 === tonic) best = n
  return best
}

function pcsOf(rung: Rung, tonic: number): Set<number> {
  return new Set(SCALE_MAP[LADDER[rung]].intervals.map((i) => (tonic + i) % 12))
}

// An open voicing built from the mode's own degrees: root, fifth, ninth, third.
export function seedCluster(rung: Rung, tonic = DEFAULT_TONIC): Cluster {
  const iv = SCALE_MAP[LADDER[rung]].intervals
  const degree = (n: number) => iv[n - 1] // 1-indexed scale degree in semitones
  const root = rootNear(tonic)
  return sortCluster([root, root + degree(5), root + 12 + degree(2), root + 12 + degree(3)])
}

// Voicings stay open at the bottom and may close up higher, as in Eddy's seed rules.
function minGap(lowerNote: number): number {
  if (lowerNote < 55) return 5 // below G3: a fourth or wider
  if (lowerNote < 60) return 3 // below C4: a minor third or wider
  return 2
}

function wellSpaced(c: Cluster): boolean {
  for (let i = 0; i < c.length - 1; i++) if (c[i + 1] - c[i] < minGap(c[i])) return false
  return true
}

export class DriftEngine {
  cluster: Cluster
  rung: Rung
  readonly tonic: number
  readonly low: number
  readonly high: number
  private rng: () => number
  private recent: string[] = []
  // Pitch classes the last mode change introduced that no voice has sounded yet.
  // The stream goes for these first, so a transition is heard, not just implied.
  pending = new Set<number>()

  constructor(opts: DriftOptions) {
    this.rung = opts.rung
    this.tonic = opts.tonic ?? DEFAULT_TONIC
    this.low = opts.low ?? rootNear(this.tonic) - 2
    this.high = opts.high ?? this.low + WINDOW_SPAN
    this.rng = opts.rng ?? Math.random
    this.cluster = seedCluster(opts.rung, this.tonic)
    this.remember()
  }

  get scaleId(): string {
    return LADDER[this.rung]
  }

  // Notes of the current cluster that are not in the current mode. Zero except
  // for the moment between a rung change and the voices following it.
  strays(): number {
    const allowed = pcsOf(this.rung, this.tonic)
    return this.cluster.filter((n) => !allowed.has(n % 12)).length
  }

  // One voice moves one step inside the current mode. Returns null if nothing
  // sensible is available (the caller can simply wait a beat and try again).
  step(): Move | null {
    return this.tryStep() ?? (this.forget(), this.tryStep())
  }

  // Prefer clusters that bring in a just-changed degree, keep the mode's colour tone
  // and keep the tonic — but one time in six, any fresh cluster, so nothing is pinned.
  private choose(fresh: Cluster[]): Cluster {
    if (this.rng() < 1 / 6) return fresh[Math.floor(this.rng() * fresh.length)]
    const color = (this.tonic + COLOR_INTERVAL[this.rung]) % 12
    const score = (c: Cluster) =>
      3 * c.filter((n) => this.pending.has(n % 12)).length +
      2 * (c.some((n) => n % 12 === color) ? 1 : 0) +
      (c.some((n) => n % 12 === this.tonic) ? 1 : 0)
    const best = Math.max(...fresh.map(score))
    const pool = fresh.filter((c) => score(c) === best)
    return pool[Math.floor(this.rng() * pool.length)]
  }

  private forget() {
    this.recent = [this.cluster.join(',')]
  }

  private tryStep(): Move | null {
    const order = [...GENTLE].sort(() => this.rng() - 0.5)
    for (const id of order) {
      const options = generateCandidates(this.cluster, STRATEGY_MAP[id], {
        keyLockActive: true,
        keyRoot: this.tonic,
        scaleId: this.scaleId,
        bounds: { min: this.low, max: this.high },
        maxCandidates: 1000,
        rng: this.rng,
      })
      const fresh = options.filter(
        (c) =>
          wellSpaced(c) &&
          c[0] >= this.low &&
          c[c.length - 1] <= this.high &&
          !this.recent.includes(c.join(',')),
      )
      if (!fresh.length) continue
      const next = this.choose(fresh)
      const move = diff(this.cluster, next)
      this.cluster = next
      this.remember()
      this.cluster.forEach((n) => this.pending.delete(n % 12))
      return move
    }
    return null
  }

  // Move to an adjacent rung. The one degree that changes is a semitone shift,
  // so each voice holding that pitch class follows it by a semitone. Returns
  // the moves (possibly none: the change then shows up as the stream wanders).
  shift(direction: 1 | -1): Move[] {
    const to = this.rung + direction
    if (to < 0 || to >= LADDER.length) return []
    const before = pcsOf(this.rung, this.tonic)
    const after = pcsOf(to, this.tonic)
    const gone = [...before].find((pc) => !after.has(pc))!
    const came = [...after].find((pc) => !before.has(pc))!
    this.rung = to
    this.pending.delete(gone)
    this.pending.add(came)

    const moves: Move[] = []
    const next = [...this.cluster]
    next.forEach((note, i) => {
      if (note % 12 !== gone) return
      // Darkening lowers the degree; brightening raises it.
      let target = note - direction
      // If the semitone is already taken, take the same pitch class an octave away.
      if (next.includes(target)) target += 12 * (this.rng() < 0.5 ? 1 : -1)
      moves.push({ from: note, to: target })
      next[i] = target
    })
    this.cluster = sortCluster(next)
    this.remember()
    this.cluster.forEach((n) => this.pending.delete(n % 12))
    return moves
  }

  private remember() {
    this.recent.push(this.cluster.join(','))
    if (this.recent.length > 6) this.recent.shift()
  }
}

function diff(a: Cluster, b: Cluster): Move {
  const from = a.find((n) => !b.includes(n))
  const to = b.find((n) => !a.includes(n))
  if (from === undefined || to === undefined) return { from: a[0], to: a[0] }
  return { from, to }
}

// Exposed for tests and for the scheduler's own sanity checks.
export function modeNotes(rung: Rung, tonic: number, low: number, high: number): number[] {
  return getScaleNotes(tonic, LADDER[rung], low, high)
}
