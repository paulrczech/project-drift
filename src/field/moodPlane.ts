// The mood field: the plane of valence (left → right, unpleasant → pleasant) and arousal
// (bottom → top, still → energised) that the engine already works in. Pure functions only:
// where each of the 21 words sits, which one is nearest, how to move between them with
// the arrow keys, and what colours belong at any point (the 21 palettes blended by
// distance, so the whole screen is a continuous map of feeling).

import { MOODS } from '../engine/moods'
import { emotionPalettes } from '../data/EmotionGradient'

export interface Point {
  v: number // valence 0..1
  a: number // arousal 0..1
  key?: number // the stop's key (pitch class); left out, it is the key of the stop before
}

export interface Emotion extends Point {
  label: string
}

export const EMOTIONS: Emotion[] = Object.entries(MOODS).map(([label, m]) => ({
  label,
  v: m.valence,
  a: m.arousal,
}))

const dist = (p: Point, q: Point) => Math.hypot(p.v - q.v, p.a - q.a)

export function nearestEmotion(p: Point): { emotion: Emotion; distance: number } {
  let best = EMOTIONS[0]
  let d = Infinity
  for (const e of EMOTIONS) {
    const x = dist(p, e)
    if (x < d) {
      d = x
      best = e
    }
  }
  return { emotion: best, distance: d }
}

// A touch or click this close to a word lands exactly on it.
export const SNAP = 0.045

// How to name a place on the field: the word itself, or "near" the closest one.
export function describe(p: Point): string {
  const { emotion, distance } = nearestEmotion(p)
  return distance <= SNAP ? emotion.label : `near ${emotion.label}`
}

export function snap(p: Point): Point {
  const { emotion, distance } = nearestEmotion(p)
  return distance <= SNAP ? { v: emotion.v, a: emotion.a } : p
}

// Which word is `from`'s neighbour in a direction — for arrow-key navigation. Prefers
// words straight ahead over words off to the side; returns undefined at an edge.
export function neighbour(
  from: Emotion,
  dir: 'left' | 'right' | 'up' | 'down'
): Emotion | undefined {
  const sx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
  const sy = dir === 'up' ? 1 : dir === 'down' ? -1 : 0
  let best: Emotion | undefined
  let bestScore = Infinity
  for (const e of EMOTIONS) {
    if (e === from) continue
    const dx = e.v - from.v
    const dy = e.a - from.a
    const along = dx * sx + dy * sy
    if (along <= 0.005) continue
    const across = Math.abs(sx ? dy : dx)
    const score = along + 2.5 * across
    if (score < bestScore) {
      bestScore = score
      best = e
    }
  }
  return best
}

// ── colour ──────────────────────────────────────────────────────────────────────────────
// Blending is done in OKLab so that a mix of two colours looks like a colour between them
// rather than a muddy grey.

type Lab = [number, number, number]

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = lin((n >> 16) & 255)
  const g = lin((n >> 8) & 255)
  const b = lin(n & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function labToHex([L, A, B]: Lab): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const enc = (c: number) => {
    c = Math.min(1, Math.max(0, c))
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(v * 255)
  }
  return '#' + lin.map((c) => enc(c).toString(16).padStart(2, '0')).join('')
}

const LABS: Record<string, Lab[]> = Object.fromEntries(
  Object.entries(emotionPalettes).map(([k, v]) => [k, v.map(hexToLab)])
)

// Inverse-distance blend of all 21 palettes: at a word it is exactly that word's colours;
// between words it is a smooth mix. Three colours, slot by slot. The power is high enough
// that each dot shows its own colours, low enough that the field has no hard edges.
const POWER = 3
export function paletteAt(p: Point): string[] {
  const weights = EMOTIONS.map((e) => 1 / (dist(p, e) ** POWER + 1e-6))
  const total = weights.reduce((a, w) => a + w, 0)
  return [0, 1, 2].map((slot) => {
    const lab: Lab = [0, 0, 0]
    EMOTIONS.forEach((e, i) => {
      const c = LABS[e.label][slot]
      for (let k = 0; k < 3; k++) lab[k] += (weights[i] / total) * c[k]
    })
    return labToHex(lab)
  })
}

export function mixPalettes(a: string[], b: string[], t: number): string[] {
  return a.map((hex, i) => {
    const x = hexToLab(hex)
    const y = hexToLab(b[i])
    return labToHex([0, 1, 2].map((k) => x[k] + (y[k] - x[k]) * t) as Lab)
  })
}

// Colours along a journey through several points: `position` is the fractional index
// (0 = first point, 1 = second, 0.5 = halfway between them).
export function palettePath(points: Point[], position: number): string[] {
  if (points.length === 1) return paletteAt(points[0])
  const i = Math.min(points.length - 2, Math.max(0, Math.floor(position)))
  const t = Math.min(1, Math.max(0, position - i))
  return mixPalettes(paletteAt(points[i]), paletteAt(points[i + 1]), t)
}

// How light a colour is (0 dark … 1 light): decides whether the interface's ink is dark or light.
export function lightness(hex: string): number {
  return hexToLab(hex)[0]
}

// ── legibility ──────────────────────────────────────────────────────────────────────────
// The interface's ink is light or dark, whichever has the better WCAG contrast on the colour
// it sits over. The background is a top-to-bottom gradient, so the hint at the top, the field
// in the middle and the ring at the bottom can each need a different ink.

const channel = (c: number) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

export const INK_LIGHT = 'rgb(255, 255, 255)'
export const INK_DARK = 'rgb(24, 28, 40)'
const L_LIGHT = luminance('#ffffff')
const L_DARK = luminance('#181c28')

export function inkFor(hex: string): { ink: string; contrast: string } {
  const l = luminance(hex)
  const withLight = (L_LIGHT + 0.05) / (l + 0.05)
  const withDark = (l + 0.05) / (L_DARK + 0.05)
  return withLight >= withDark ? { ink: INK_LIGHT, contrast: INK_DARK } : { ink: INK_DARK, contrast: INK_LIGHT }
}
