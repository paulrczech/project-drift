// A drift as a standard MIDI file: one track per instrument (an orchestra gets a track per
// section, with General MIDI programs), the mode named at each change as a marker, and the key,
// tempo and seed in the first marker so the journey can be rebuilt.

import type { Score } from '../engine/score'

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
