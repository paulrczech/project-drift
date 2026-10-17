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

// The pitch class that marks a mode (see above), for anything that needs to rank a chord's notes.
export const colorPc = (rung: Rung, tonic: number) => (tonic + COLOR_INTERVAL[rung]) % 12
// The pitch class of a mode's third.
export const thirdPc = (rung: Rung, tonic: number) => (tonic + SCALE_MAP[LADDER[rung]].intervals[2]) % 12

// One change to what is sounding. A voice moving has both; a voice entering has no
// `from`; a voice leaving has no `to`.
export interface Move {
  from: number | null
  to: number | null
}

export interface DriftOptions {
  rung: Rung
  tonic?: number // pitch class of the tonal centre, 0-11 (default D)
  low?: number // lowest MIDI note any voice may reach (default: just under the tonic)
  high?: number // highest
  arousal?: number // 0 still … 1 energised (default 0.4); see setArousal
  register?: number // semitones to shift the whole register (a high voice sits higher)
  span?: number // semitones between the lowest and highest note a voice may reach
  ceiling?: number // an absolute highest note (a voice that must not be pitched above its samples)
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

// An open voicing built from the mode's own degrees: root, fifth, (ninth,) third.
export function seedCluster(rung: Rung, tonic = DEFAULT_TONIC, voices = 4, register = 0): Cluster {
  const iv = SCALE_MAP[LADDER[rung]].intervals
  const degree = (n: number) => iv[n - 1] // 1-indexed scale degree in semitones
  const root = rootNear(tonic, 50 + register)
  const notes = [root, root + degree(5), root + 12 + degree(3)]
  if (voices >= 4) notes.push(root + 12 + degree(2))
  return sortCluster(notes)
}

// Arousal shapes the music in a few steady ways (all read live, so a walk between two
// moods can calm or quicken as it goes):
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
// Seconds between harmonic moves: slow when still, brisk when energised.
export const beatFor = (arousal: number) => lerp(9, 3.5, clamp01(arousal))
// Two enter above, one leave below: a little hysteresis so it does not flutter.
const voicesFor = (arousal: number, current: number) =>
  arousal >= 0.33 ? 4 : arousal < 0.27 ? 3 : current

// Voicings stay open at the bottom and may close up higher, as in Eddy's seed rules.
// Calm music opens them further above G3: seconds are left to energetic moods.
function minGap(lowerNote: number, calm: boolean): number {
  if (lowerNote < 55) return 5 // below G3: a fourth or wider
  if (lowerNote < 60) return calm ? 4 : 3 // below C4: a (minor) third or wider
  return calm ? 3 : 2
}

function wellSpaced(c: Cluster, calm: boolean): boolean {
  for (let i = 0; i < c.length - 1; i++) if (c[i + 1] - c[i] < minGap(c[i], calm)) return false
  return true
}

export class DriftEngine {
  cluster: Cluster
  rung: Rung
  readonly tonic: number
  readonly register: number
  readonly low: number
  readonly high: number
  arousal: number
  private rng: () => number
  private recent: string[] = []
  // Pitch classes the last mode change introduced that no voice has sounded yet.
  // The stream goes for these first, so a transition is heard, not just implied.
  pending = new Set<number>()

  constructor(opts: DriftOptions) {
    this.rung = opts.rung
    this.tonic = opts.tonic ?? DEFAULT_TONIC
    this.register = opts.register ?? 0
    this.low = opts.low ?? this.root - 2
    this.high = opts.high ?? Math.min(this.low + (opts.span ?? WINDOW_SPAN), opts.ceiling ?? Infinity)
    this.rng = opts.rng ?? Math.random
    this.arousal = clamp01(opts.arousal ?? 0.4)
    this.cluster = seedCluster(opts.rung, this.tonic, voicesFor(this.arousal, 4), this.register)
    this.remember()
  }

  // 0 still … 1 energised. Moves the register the voices lean toward and how closely they
  // may sit; the number of voices follows at the next step.
  setArousal(arousal: number) {
    this.arousal = clamp01(arousal)
  }

  private get calm(): boolean {
    return this.arousal < 0.35
  }

  // The voices lean toward this mean pitch: deeper when still, brighter when energised.
  // Relative to the root, so every key plays the same shape of music.
  private get center(): number {
    return this.root + lerp(6, 20, this.arousal)
  }

  private get root(): number {
    return rootNear(this.tonic, 50 + this.register)
  }

  // The tonic in this engine's register, whether or not the chord holds it at the moment:
  // an anchor for anything that needs one steady note.
  get tonicNote(): number {
    return this.root
  }

  private get modeThird(): number {
    return (this.tonic + SCALE_MAP[LADDER[this.rung]].intervals[2]) % 12
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
    const want = voicesFor(this.arousal, this.cluster.length)
    if (this.cluster.length < want) return this.addVoice()
    if (this.cluster.length > want) return this.removeVoice()
    return this.tryStep() ?? (this.forget(), this.tryStep())
  }

  // How much a voice matters to the mode's character: the tonic, the colour tone and the
  // third, when it is the only one sounding them.
  private importance(note: number, cluster: Cluster): number {
    const pc = note % 12
    const color = (this.tonic + COLOR_INTERVAL[this.rung]) % 12
    const sole = (target: number) =>
      pc === target && cluster.filter((n) => n % 12 === target).length === 1 ? 1 : 0
    return 3 * sole(color) + 2 * sole(this.tonic) + sole(this.modeThird)
  }

  // A voice enters on a note the chord is missing (colour tone, third, tonic), in the
  // register the music is leaning toward.
  private addVoice(): Move | null {
    const allowed = pcsOf(this.rung, this.tonic)
    const color = (this.tonic + COLOR_INTERVAL[this.rung]) % 12
    const have = new Set(this.cluster.map((n) => n % 12))
    let best: { note: number; score: number }[] = []
    let top = -Infinity
    for (let note = this.low; note <= this.high; note++) {
      if (!allowed.has(note % 12) || this.cluster.includes(note)) continue
      const next = sortCluster([...this.cluster, note])
      if (!wellSpaced(next, this.calm)) continue
      const score =
        2 * (!have.has(color) && note % 12 === color ? 1 : 0) +
        2 * (!have.has(this.modeThird) && note % 12 === this.modeThird ? 1 : 0) +
        (!have.has(this.tonic) && note % 12 === this.tonic ? 1 : 0) -
        Math.abs(note - this.center) / 8
      if (score > top + 1e-9) {
        top = score
        best = [{ note, score }]
      } else if (Math.abs(score - top) < 1e-9) best.push({ note, score })
    }
    if (!best.length) return null
    const note = best[Math.floor(this.rng() * best.length)].note
    this.cluster = sortCluster([...this.cluster, note])
    this.remember()
    this.cluster.forEach((n) => this.pending.delete(n % 12))
    return { from: null, to: note }
  }

  // The least important voice leaves (the bass last, so the root keeps its footing).
  private removeVoice(): Move | null {
    if (this.cluster.length <= 3) return null
    const rank = (n: number) => this.importance(n, this.cluster) + (n === this.cluster[0] ? 0.5 : 0)
    const lowest = Math.min(...this.cluster.map(rank))
    const pool = this.cluster.filter((n) => rank(n) === lowest)
    const note = pool[Math.floor(this.rng() * pool.length)]
    this.cluster = this.cluster.filter((n) => n !== note)
    this.remember()
    return { from: note, to: null }
  }

  // Prefer clusters that bring in a just-changed degree, keep the mode's colour tone, the
  // tonic and the third — then, among those, lean toward the register the mood calls for.
  // One time in six, any fresh cluster, so nothing is pinned.
  private choose(fresh: Cluster[]): Cluster {
    if (this.rng() < 1 / 6) return fresh[Math.floor(this.rng() * fresh.length)]
    const color = (this.tonic + COLOR_INTERVAL[this.rung]) % 12
    const has = (c: Cluster, pc: number) => (c.some((n) => n % 12 === pc) ? 1 : 0)
    const score = (c: Cluster) =>
      3 * c.filter((n) => this.pending.has(n % 12)).length +
      2 * has(c, color) +
      has(c, this.tonic) +
      has(c, this.modeThird)
    const best = Math.max(...fresh.map(score))
    const pool = fresh.filter((c) => score(c) === best)
    // weighted pick: a step that brings the mean pitch nearer the centre is favoured. One
    // step shifts the mean by under a semitone, so the weight rewards the *progress* made.
    const mean = (c: Cluster) => c.reduce((a, n) => a + n, 0) / c.length
    const now = Math.abs(mean(this.cluster) - this.center)
    const weight = (c: Cluster) => Math.exp(4 * (now - Math.abs(mean(c) - this.center)))
    const total = pool.reduce((a, c) => a + weight(c), 0)
    let r = this.rng() * total
    for (const c of pool) {
      r -= weight(c)
      if (r <= 0) return c
    }
    return pool[pool.length - 1]
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
          wellSpaced(c, this.calm) &&
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
