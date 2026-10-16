// The 21 words, each placed on a valence (unpleasant 0 → pleasant 1) and arousal
// (still 0 → energised 1) plane. Valence picks the mode; arousal will shape tempo,
// density and register. The words stay as the input for now — a 2D pad can replace
// them later without touching the engine. First-draft placements: tune by ear.

export interface Mood {
  valence: number
  arousal: number
}

export const MOODS: Record<string, Mood> = {
  joyful: { valence: 0.95, arousal: 0.75 },
  happy: { valence: 0.85, arousal: 0.6 },
  cheerful: { valence: 0.85, arousal: 0.65 },
  playful: { valence: 0.8, arousal: 0.8 },
  grateful: { valence: 0.8, arousal: 0.35 },
  content: { valence: 0.75, arousal: 0.3 },
  hopeful: { valence: 0.7, arousal: 0.45 },
  serene: { valence: 0.7, arousal: 0.1 },
  peaceful: { valence: 0.65, arousal: 0.15 },
  relaxed: { valence: 0.65, arousal: 0.15 },
  neutral: { valence: 0.5, arousal: 0.3 },
  reflective: { valence: 0.45, arousal: 0.25 },
  nostalgic: { valence: 0.4, arousal: 0.3 },
  bittersweet: { valence: 0.35, arousal: 0.35 },
  wistful: { valence: 0.35, arousal: 0.3 },
  longing: { valence: 0.3, arousal: 0.4 },
  uneasy: { valence: 0.25, arousal: 0.55 },
  melancholy: { valence: 0.2, arousal: 0.2 },
  anxious: { valence: 0.15, arousal: 0.8 },
  sad: { valence: 0.1, arousal: 0.2 },
  depressed: { valence: 0.05, arousal: 0.1 },
}

// Lydian (0) … Phrygian (5). Locrian (6) is left out of the mapping: its tonic
// chord is diminished, which reads as tense, not low.
export const MAPPED_RUNGS = 5

export function rungFor(valence: number): number {
  return Math.round((1 - valence) * MAPPED_RUNGS)
}
