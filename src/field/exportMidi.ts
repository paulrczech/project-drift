// A drift as a standard MIDI file: one track per instrument (an orchestra gets a track per
// section, with General MIDI programs), the mode named at each change as a marker, and the key,
// tempo and seed in the first marker so the journey can be rebuilt.

import { clipsOf, type Score } from '../engine/score'
import type { ZipFile } from './zip'

// What the file menu asks for: what to make, and how much of it (this drift; several seeds of it; the
// same drift on several sounds).
export type ExportFormat = 'mid' | 'clips' | 'wav'
export type ExportScope = 'this' | 'seeds' | 'sounds'
export interface ExportRequest {
  format: ExportFormat
  scope: ExportScope
  count: number // seeds
  sounds: string[] // voice ids
}

export interface Provenance {
  voice: string
  seed: number
  stops: string // e.g. "sad > nostalgic > joyful" (MIDI text is ASCII)
  minutes: number // Infinity for an endless drift
  feel?: string // the pulse's grid and density, e.g. "1/8T full"
}

export async function midiBytes(score: Score, info: Provenance): Promise<Uint8Array> {
  const { Midi } = await import('@tonejs/midi')
  const midi = new Midi()
  midi.header.name = `Drift - ${score.uniformKey ? score.key + ' ' : ''}${score.modes.join(' > ')}`
  midi.header.setTempo(score.bpm)
  // @tonejs/midi has no setTimeSignature(): the array is edited directly, then header.update()
  // (as in Eddy's exporter). 4/4, so bars fall where a DAW expects them.
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
  midi.header.update()

  const ticks = (s: number) => Math.round(midi.header.secondsToTicks(s))
  const first = `Drift | ${score.key} | ${info.stops} | ${score.bpm} BPM${info.feel ? ' ' + info.feel : ''} | ${info.voice} | seed ${info.seed}`
  score.markers.forEach((m, i) =>
    midi.header.meta.push({ ticks: ticks(m.time), type: 'marker', text: i === 0 ? `${first} | ${m.text}` : m.text })
  )

  for (const t of score.tracks) {
    const track = midi.addTrack()
    track.name = t.name
    track.instrument.number = t.program
    for (const n of t.notes) track.addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity })
  }
  return midi.toArray()
}

// e.g. drift-A-phrygian-to-lydian-72bpm.mid, or drift-D-dorian-to-Ab-major-to-C-lydian.mid when the
// journey changes key (`head` is the key a file name begins with, empty then; the BPM where there
// is one; `tag` tells the files of a set of variations apart, e.g. "pad-seed5000")
export const exportName = (head: string, modes: string[], bpm: number | undefined, ext: string, tag?: string) =>
  ['drift', head, modes.join('-to-')]
    .filter(Boolean)
    .join('-')
    .replace(/\s+/g, '-')
    .replace('#', 'sharp') + `${bpm ? `-${bpm}bpm` : ''}${tag ? `-${tag}` : ''}.${ext}`

export function download(bytes: Uint8Array | Blob, filename: string, mime: string) {
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes.buffer as ArrayBuffer], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// A drift as clips for a DAW's clip view: one .mid per distinct clip (a cluster of the sustained
// voices, a four-bar phrase of the pulse), named in the order they first play with the stop's word
// and the mode, plus arrangement.txt listing what plays on which bar. Empty when the score has
// nowhere to cut.
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace('#', 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export async function clipFiles(score: Score, info: Provenance, words: string[]): Promise<ZipFile[]> {
  const { clips, slots } = clipsOf(score)
  if (!clips.length) return []
  const text = new TextEncoder()
  const barSeconds = 240 / score.bpm
  const pad = (n: number) => String(n).padStart(2, '0')
  const names = new Map<number, string>()
  const files: ZipFile[] = []
  for (const s of slots) {
    if (names.has(s.clip)) continue
    const c = clips[s.clip]
    const name = `${pad(names.size + 1)}-${[slug(words[c.stop] ?? `stop-${c.stop + 1}`), slug(c.mode), `${c.bars}bars`].filter(Boolean).join('-')}.mid`
    names.set(s.clip, name)
    const label = `${words[c.stop] ?? `stop ${c.stop + 1}`}: ${c.mode}, ${c.bars} bar${c.bars > 1 ? 's' : ''}`
    const length = c.bars * barSeconds
    const clip: Score = {
      ...score,
      bpm: c.bpm,
      tracks: c.tracks,
      // a marker on the last tick holds the clip to its whole bars when the notes stop short
      markers: [{ time: 0, text: label }, { time: Math.max(0, length - 0.001), text: 'end' }],
      duration: length,
      modes: [c.mode],
      cuts: [],
    }
    files.push({ name, data: await midiBytes(clip, info) })
  }
  const lines = [
    `Drift clips: ${score.key}, ${score.bpm} BPM, ${info.voice}, seed ${info.seed}`,
    `${clips.length} clip${clips.length > 1 ? 's' : ''}, ${slots.length} place${slots.length > 1 ? 's' : ''} in the journey. Bars count from 1.`,
    '',
  ]
  let stop = -1
  for (const s of slots) {
    if (s.stop !== stop) {
      stop = s.stop
      lines.push(`${stop ? '\n' : ''}stop ${stop + 1}: ${words[stop] ?? ''}`)
    }
    lines.push(`  bar ${String(s.bar).padStart(3)}  ${names.get(s.clip)}`)
  }
  files.push({ name: 'arrangement.txt', data: text.encode(lines.join('\n') + '\n') })
  return files
}
