import { MELODIC_RUNG } from './drift'

// The 21 words, each placed on a valence (unpleasant 0 → pleasant 1) and arousal
// (still 0 → energised 1) plane. Valence picks the mode; arousal will shape tempo,
// density and register. The words stay as the input for now — a 2D pad can replace
// them later without touching the engine. First-draft placements: tune by ear. They are also
// the positions of the dots on the mood field, so they are spread to stay >= 0.06 apart.

export interface Mood {
  valence: number
  arousal: number
}

export const MOODS: Record<string, Mood> = {
  joyful: { valence: 0.95, arousal: 0.75 },
  happy: { valence: 0.83, arousal: 0.58 },
  cheerful: { valence: 0.88, arousal: 0.7 },
  playful: { valence: 0.8, arousal: 0.8 },
  grateful: { valence: 0.82, arousal: 0.38 },
  content: { valence: 0.74, arousal: 0.28 },
  hopeful: { valence: 0.7, arousal: 0.45 },
  serene: { valence: 0.7, arousal: 0.07 },
  peaceful: { valence: 0.66, arousal: 0.14 },
  relaxed: { valence: 0.6, arousal: 0.19 },
  neutral: { valence: 0.5, arousal: 0.3 },
  reflective: { valence: 0.46, arousal: 0.22 },
  nostalgic: { valence: 0.4, arousal: 0.3 },
  bittersweet: { valence: 0.36, arousal: 0.38 },
  wistful: { valence: 0.31, arousal: 0.27 },
  longing: { valence: 0.28, arousal: 0.45 },
  uneasy: { valence: 0.25, arousal: 0.55 },
  melancholy: { valence: 0.2, arousal: 0.2 },
  anxious: { valence: 0.15, arousal: 0.8 },
  sad: { valence: 0.1, arousal: 0.24 },
  depressed: { valence: 0.05, arousal: 0.1 },
}

// Lydian (0) … Phrygian (6). Locrian (7) is left out of the mapping: its tonic chord is
// diminished, which reads as tense, not low. Melodic minor (4) is the band around wistful and
// longing; every other word keeps the mode it always had (the ladder is the old five-rung
// rounding, with this band cut out of dorian's and natural minor's edges).
export const MELODIC_BAND = { above: 0.27, upTo: 0.33 } // valence

export function rungFor(valence: number): number {
  if (valence > MELODIC_BAND.above && valence <= MELODIC_BAND.upTo) return MELODIC_RUNG
  const old = Math.round((1 - valence) * 5)
  return old >= MELODIC_RUNG ? old + 1 : old
}
