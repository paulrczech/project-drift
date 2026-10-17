// The sounds a drift can be played on. A voice is one or more *layers* of samples, plus what
// the engine needs to know to suit it: how high its register sits, how wide a span it can
// take, how it is re-struck (a pad of 8s samples is re-struck every ~5.5s; an orchestral
// section of 6s samples every ~2.6s), how loud it is.
//
// Each layer answers for a range of notes. A note is sent to every layer whose range holds
// it, softer near the edges of the range, so the sections blend as the voices move.
//
// The pad is the default; the sound selector (and `?voice=pad|choir|choir-mixed|orchestra|pulse`) picks another.

export interface Layer {
  id: string
  baseUrl: string
  urls: Record<string, string> // note name → file
  min: number // lowest MIDI note this layer plays
  max: number // highest
  gain: number // this layer's share of the mix (0–1)
  transpose?: number // semitones: basses double an octave below, for weight
  fade?: number // semitones over which the layer fades in at each edge of its range
  chain?: number // which re-strike schedule (see Voice.links) this layer follows (default 0)
  // How forward this layer is as the mood moves, in dB at arousal 0.1 / 0.5 / 0.9 (straight
  // lines between and flat beyond). 0 at the middle keeps the balance the mix was set at.
  byArousal?: [number, number, number]
}

export interface Voice {
  id: string
  label: string // the name shown in the sound selector
  megabytes: number // download size, shown dimly for the heavy ones
  listed?: boolean // appears in the selector (the others stay available by URL)
  style?: 'pulse' // played as a steady ostinato (see pulse.ts) instead of free-time swells
  // A tempo-synced echo after the voice: the delay is `beats` of a beat long (0.75 = dotted
  // eighth), so it follows the pulse as the tempo moves with arousal.
  echo?: { beats: number; feedback: number; wet: number }
  layers: Layer[]
  register: number // semitones to lift the engine's register
  span: number // semitones between the lowest and highest note any voice may reach
  ceiling?: number // an absolute highest note, for a voice that must not be pitched above its samples
  lowpass?: number // Hz: soften the top of the sound
  level: number // master gain, so voices sit at a similar loudness
  attack: number // seconds a note takes to fade in
  release: number // seconds it takes to fade out
  link: number // seconds between re-strikes of a held note
  links?: number[] // or one interval per chain, so that layers re-strike out of step
  overlap?: number // seconds an old strike lasts after the next begins (default: attack)
  curve?: 'linear' | 'exponential' // how samplers fade in and out (default exponential)
  maxHold: number // the longest a single strike is held (shorter than the samples)
  credit: string
}

const SSO_CREDIT =
  'Sonatina Symphonic Orchestra (Mattias Westlund; github.com/peastman/sso), Creative Commons Sampling Plus 1.0'

const fileName = (note: string) => `${note.replace('#', 's')}.mp3`
const urlsFor = (notes: string[], dir = '') =>
  Object.fromEntries(notes.map((n) => [n, `${dir}${fileName(n)}`]))
const everyNote = (from: string, to: string) => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const num = (n: string) => (Number(n.slice(-1)) + 1) * 12 + names.indexOf(n.slice(0, -1))
  const out: string[] = []
  for (let m = num(from); m <= num(to); m++) out.push(`${names[m % 12]}${Math.floor(m / 12) - 1}`)
  return out
}

// One layer covering every note: a single sample set.
const single = (id: string, baseUrl: string, urls: Record<string, string>): Layer => ({
  id, baseUrl, urls, min: 0, max: 127, gain: 1, fade: 0,
})

// Eddy's retro pad: Paul's own Logic RetroSynth patch printed to audio. E2–C6, a note
// every major third; the sampler transposes between them. 8s samples.
const pad: Voice = {
  id: 'pad',
  label: 'pad',
  megabytes: 1.9,
  listed: true,
  layers: [
    single('retro-pad', '/samples/retro-pad/', {
      E2: 'E2.mp3', 'G#2': 'Gs2.mp3', C3: 'C3.mp3', E3: 'E3.mp3', 'G#3': 'Gs3.mp3', C4: 'C4.mp3',
      E4: 'E4.mp3', 'G#4': 'Gs4.mp3', C5: 'C5.mp3', E5: 'E5.mp3', 'G#5': 'Gs5.mp3', C6: 'C6.mp3',
    }),
  ],
  register: 0,
  span: 28,
  level: 0.5,
  attack: 2,
  release: 3,
  link: 5.5,
  maxHold: 7.5,
  credit: 'Retro pad — Paul Czech',
}

const FEMALE = everyNote('G4', 'C6')
const MALE = everyNote('G2', 'F#4')

// Sonatina Symphonic Orchestra, a sung "ah". Every sample is trimmed and level-matched by
// *perceived* loudness (A-weighted, with a 3 dB/octave taper above C5, because the ear is
// most sensitive exactly where a soprano's top lives), with a short fade at the end.
//
// Female only (G4–C6): the top is capped at G5 so nothing is ever pitched above its own
// samples (that is what made the high notes shrill), which leaves some notes pitched down
// from G4 — a few semitones on average, so it grows warmer and more alto-like below.
const choir: Voice = {
  id: 'choir',
  label: 'choir',
  megabytes: 3.1,
  layers: [single('choir-female', '/samples/choir-female/', urlsFor(FEMALE))],
  register: 12,
  span: 20,
  ceiling: 79,
  lowpass: 5000,
  level: 0.3, // measured against the pad: 4.4 dB hotter at equal gain
  attack: 2,
  release: 3,
  link: 5.5,
  maxHold: 7.5,
  credit: `Female chorus — ${SSO_CREDIT}`,
}

// Male voices below G4, female above: a bass-to-soprano spread with nothing pitch-shifted at
// all (G2–C6, a sample for every semitone), capped at G5.
const choirMixed: Voice = {
  id: 'choir-mixed',
  label: 'voices',
  megabytes: 7.2,
  listed: true,
  layers: [
    single('choir', '/samples/', {
      ...urlsFor(MALE, 'choir-male/'),
      ...urlsFor(FEMALE, 'choir-female/'),
    }),
  ],
  register: 8,
  span: 26,
  ceiling: 79,
  lowpass: 4500,
  level: 0.26, // measured against the pad: 5.8 dB hotter at equal gain
  attack: 2,
  release: 3,
  link: 5.5,
  maxHold: 7.5,
  credit: `Chorus — ${SSO_CREDIT}`,
}

// An orchestral pad from SSO's sustained sections (scripts/samples/orchestra.py builds the
// samples). Strings carry the body, horns (mezzo-piano) and clarinets add warmth, flutes air,
// and the female choir sits on top. The note ranges overlap and fade at their edges, so the
// blend shifts with register: weight and horns low, strings in the middle, air and voices high.
// The sections are only 3–6s long (looped to 6s), so notes are struck anew every ~2.6s.
const orchestra: Voice = {
  id: 'orchestra',
  label: 'orchestra',
  megabytes: 17.8,
  listed: true,
  layers: [
    // basses, an octave below the voices that sit low, for weight
    { id: 'basses', chain: 0, baseUrl: '/samples/orchestra/basses/', min: 40, max: 55, gain: 0.406, fade: 4, byArousal: [-2, 0, 1.5], transpose: -12,
      urls: urlsFor(['C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4']) },
    { id: 'celli', chain: 1, baseUrl: '/samples/orchestra/celli/', min: 40, max: 64, gain: 0.348, fade: 4, byArousal: [1.5, 0, -2],
      urls: urlsFor(['C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5']) },
    { id: 'violas', chain: 2, baseUrl: '/samples/orchestra/violas/', min: 48, max: 80, gain: 0.331, fade: 4, byArousal: [0.5, 0, -0.5],
      urls: urlsFor(['C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6']) },
    { id: 'violins', chain: 3, baseUrl: '/samples/orchestra/violins/', min: 60, max: 84, gain: 0.441, fade: 4, byArousal: [-2.5, 0, 3],
      urls: urlsFor(['G3', 'A#3', 'C#4', 'E4', 'G4', 'A#4', 'C#5', 'E5', 'G5', 'A#5', 'C#6', 'E6', 'G6', 'A#6']) },
    { id: 'horns', chain: 4, baseUrl: '/samples/orchestra/horns/', min: 44, max: 72, gain: 0.383, fade: 4, byArousal: [-3, 0, 3],
      urls: urlsFor(['E2', 'G2', 'A#2', 'C#3', 'E3', 'G3', 'A#3', 'C#4', 'E4', 'G4', 'A#4', 'C#5', 'E5']) },
    { id: 'clarinets', chain: 5, baseUrl: '/samples/orchestra/clarinets/', min: 48, max: 80, gain: 0.290, fade: 4, byArousal: [1.5, 0, -1.5],
      urls: urlsFor(['D3', 'F3', 'G#3', 'B3', 'D4', 'F4', 'G#4', 'B4', 'D5', 'F5', 'G#5', 'B5', 'D6']) },
    { id: 'flutes', chain: 6, baseUrl: '/samples/orchestra/flutes/', min: 58, max: 84, gain: 0.290, fade: 4, byArousal: [-4, 0, 4],
      urls: urlsFor(['C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5']) },
    // the choir spans the whole range: male voices (G2–F#4) in the low-mid, where a sung vowel
    // stands apart from the strings, and female voices above G4
    { id: 'choir', chain: 7, baseUrl: '/samples/', min: 46, max: 79, gain: 0.499, fade: 4, byArousal: [2.5, 0, -3.5],
      urls: { ...urlsFor(MALE, 'choir-male/'), ...urlsFor(FEMALE, 'choir-female/') } },
  ],
  register: 0,
  span: 28,
  ceiling: 81,
  lowpass: 6000,
  level: 0.293, // gains carry headroom for the arousal boosts (x0.58); matched to the pad by measurement
  // Re-striking: each layer follows its own schedule (a chain) at a slightly different
  // interval, so the eight layers' swells never line up into one audible pulse; a new strike
  // fades in over 2s while the old one fades out over 2s, with 1.2s of overlap, on linear
  // curves; measured (chord frozen): one layer's pulse at the re-strike rate 17% -> 5%, the
  // eight-layer mix 12% -> 3.3% and no longer at a single rhythm.
  attack: 2,
  release: 2,
  overlap: 1.2,
  curve: 'linear',
  link: 3.2,
  links: [2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0],
  maxHold: 6.4,
  credit: `Orchestral pad — ${SSO_CREDIT}`,
}

// Eddy's analog synth: Moog Minitaur "Simple Saw" by modularsamples — CC0 (public domain). One
// short note (1.9s, 11 ms attack) for every semitone, E2-C5. (Eddy's files above C5 are all
// copies of C5 — measured — so only E2-C5 are used; the sampler transposes the rare note above.)
// Played as an ostinato: it begins on one repeating note and the chord's notes join over the
// journey, with a dotted-eighth echo that follows the tempo and a soft low-pass for the saw.
const synth: Voice = {
  id: 'pulse',
  label: 'pulse',
  megabytes: 1.5,
  listed: true,
  style: 'pulse',
  layers: [single('analog-synth', '/samples/analog-synth/', urlsFor(everyNote('E2', 'C5')))],
  register: 10,
  span: 26,
  ceiling: 79,
  lowpass: 6000,
  level: 1.05, // a short plucked note is quiet by RMS: set by measurement, a little under the pad
  attack: 0.005,
  release: 0.35,
  link: 1, // (unused: the pulse re-strikes every step)
  maxHold: 1,
  echo: { beats: 0.75, feedback: 0.42, wet: 0.3 },
  credit: 'Analog synth — Moog Minitaur "Simple Saw" by modularsamples (freesound.org/people/modularsamples), CC0',
}

export const VOICES: Record<string, Voice> = { pad, choir, 'choir-mixed': choirMixed, orchestra, pulse: synth }

export const DEFAULT_VOICE = 'pad' // the lightest, so a first visit is instant
export const LISTED_VOICES = Object.values(VOICES).filter((v) => v.listed)

const STORAGE_KEY = 'drift.voice'

function storedVoiceId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // private windows and blocked storage: just use the default
  }
}

// `?voice=` wins (handy for trying one), then what the listener last chose, then the default.
export function currentVoiceId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('voice')
  for (const id of [fromUrl, storedVoiceId()]) if (id && VOICES[id]) return id
  return DEFAULT_VOICE
}

export function voiceFromLocation(): Voice {
  return VOICES[currentVoiceId()]
}

// Remember a choice. A `?voice=` in the address would still override it, so it is dropped.
export function rememberVoice(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* not remembered; the choice still applies to this visit */
  }
  const url = new URL(window.location.href)
  if (url.searchParams.has('voice')) {
    url.searchParams.delete('voice')
    window.history.replaceState(null, '', url)
  }
}

const TEMPO_KEY = 'drift.tempo'
export type TempoFeelName = 'slow' | 'medium' | 'fast'

export function currentTempoFeel(): TempoFeelName {
  try {
    const t = window.localStorage.getItem(TEMPO_KEY)
    if (t === 'slow' || t === 'medium' || t === 'fast') return t
  } catch {
    /* default */
  }
  return 'medium'
}

export function rememberTempoFeel(feel: TempoFeelName) {
  try {
    window.localStorage.setItem(TEMPO_KEY, feel)
  } catch {
    /* applies to this visit only */
  }
}

// Start fetching a voice's samples into the browser's cache before a drift begins, so Begin
// is not a silent wait. Called when someone first shows intent (chooses a stop) and when they
// pick a sound; each voice is fetched once.
const preloaded = new Set<string>()
export function preloadVoice(voice: Voice) {
  if (preloaded.has(voice.id)) return
  preloaded.add(voice.id)
  for (const layer of voice.layers)
    for (const file of Object.values(layer.urls))
      fetch(layer.baseUrl + file, { priority: 'low' } as RequestInit).catch(() => {})
}

// A layer's offset in dB at an arousal, from its three anchors.
export function presenceDb(layer: Layer, arousal: number): number {
  const p = layer.byArousal
  if (!p) return 0
  if (arousal <= 0.1) return p[0]
  if (arousal >= 0.9) return p[2]
  return arousal < 0.5 ? p[0] + ((p[1] - p[0]) * (arousal - 0.1)) / 0.4 : p[1] + ((p[2] - p[1]) * (arousal - 0.5)) / 0.4
}

// Moving sections forward and back must not make the whole louder or quieter: the layers'
// combined power is held to what it is at the middle.
function loudnessKeep(voice: Voice, arousal: number): number {
  if (!voice.layers.some((l) => l.byArousal)) return 1
  let base = 0
  let now = 0
  for (const l of voice.layers) {
    base += l.gain ** 2
    now += (l.gain * 10 ** (presenceDb(l, arousal) / 20)) ** 2
  }
  return Math.sqrt(base / now)
}

// Which layers sound a note, and how strongly. The sampler for a layer is asked for
// `note + transpose` at `velocity`; a layer that does not cover the note is left out. The
// arousal at that moment decides which sections are forward (calm: voices and strings;
// energetic: horns, violins and flutes).
export function routeNote(
  voice: Voice,
  note: number,
  arousal = 0.5
): { layer: Layer; note: number; velocity: number }[] {
  const out: { layer: Layer; note: number; velocity: number }[] = []
  const keep = loudnessKeep(voice, arousal)
  for (const layer of voice.layers) {
    if (note < layer.min || note > layer.max) continue
    const fade = layer.fade ?? 0
    const edge = fade > 0 ? Math.min(1, (note - layer.min + 1) / fade, (layer.max - note + 1) / fade) : 1
    const velocity = Math.min(1, layer.gain * edge * keep * 10 ** (presenceDb(layer, arousal) / 20))
    if (velocity > 0.02) out.push({ layer, note: note + (layer.transpose ?? 0), velocity })
  }
  return out
}
