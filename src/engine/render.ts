// A drift as audio: the live player's chain (samplers → low-pass → echo → reverb → master) built
// in an offline context and rendered faster than real time, from the same plan, seed and tempo,
// and written straight into a 16-bit stereo WAV. Lazily imports Tone, so it costs nothing until
// someone exports.
//
// SEGMENTS. The browser visits every scheduled note on every block, so rendering a long journey
// in one piece slows down more than linearly (a 3-minute orchestra took 90 s, ten minutes would
// not finish). It is rendered in segments instead: each starts PRE seconds early, so the reverb
// and every note still sounding are already in place, and only its own stretch is kept. The
// chain is linear and time-invariant and a note (hold + release) plus the reverb's tail ends well
// inside PRE, so the pieces join sample-exactly (checked against a single render).
//
// Not for use while a drift is playing: Tone.Offline swaps the global context while it renders,
// and the live player reads `Tone.now()` from that.

import { ENDLESS_TAIL } from './score'
import { arousalAt, type TimelinePlan } from './compose'
import { mulberry } from './rng'
import { performerFor, type Tempo } from './performer'
import { routeNote, type Voice } from './voices'

const VELOCITY = 0.8 // as the player
const FADE = 3 // seconds in (as the player)
const END_FADE = 45 // seconds out at the end of a finite drift, at most a quarter of it
const SAMPLE_RATE = 44100
export const SEGMENT = 90 // seconds kept from each render
export const PRE = 24 // seconds rendered before each segment, then discarded

export type RenderProgress = { stage: 'loading' } | { stage: 'rendering'; done: number } // done: 0–1

export async function renderDriftWav(
  voice: Voice,
  plan: Omit<TimelinePlan, 'rng'>,
  seed: number,
  tempo: Tempo = {},
  progress: (p: RenderProgress) => void = () => {},
  assets = '', // a prefix for the sample URLs (the offline harness serves /public from a folder)
  cut: { segment?: number; pre?: number } = {} // for tests
): Promise<Uint8Array> {
  const SEG = cut.segment ?? SEGMENT
  const LEAD = cut.pre ?? PRE
  const waypoints = plan.waypoints.map((w) => ({ ...w, hold: Number.isFinite(w.hold) ? w.hold : ENDLESS_TAIL }))
  const performer = performerFor(voice, { ...plan, waypoints }, mulberry(seed), tempo)
  const layout = performer.layout
  const events = performer.pull(Infinity)
  const seconds = layout.duration
  const total = Math.ceil((seconds + 1) * SAMPLE_RATE) // frames

  progress({ stage: 'loading' })
  const Tone = await import('tone')
  const buffers = new Map(voice.layers.map((l) => [l.id, new Tone.ToneAudioBuffers({ urls: l.urls, baseUrl: assets + l.baseUrl })]))
  await Tone.loaded()

  const wav = new Uint8Array(44 + total * 4)
  const view = new DataView(wav.buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + total * 4, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, total * 4, true)

  let room: unknown = null // the reverb's impulse response, made once
  let peak = 0
  for (let from = 0; from < total; from += SEG * SAMPLE_RATE) {
    progress({ stage: 'rendering', done: from / total })
    const start = from / SAMPLE_RATE // seconds into the drift where this segment's kept stretch begins
    const end = Math.min(seconds + 1, start + SEG)
    const origin = Math.max(0, start - LEAD) // where this render begins
    const out = await Tone.Offline(
      async () => {
        const at = (t: number) => t - origin // the render's own clock
        const master = new Tone.Gain(0).toDestination()
        const fadeOut = Math.min(END_FADE, seconds * 0.25)
        // the player's master envelope, in this render's time (a ramp starts at its own anchor)
        const points: [number, number][] = [[0, 0], [FADE, voice.level], [seconds - fadeOut, voice.level], [seconds, 0], [seconds + 1, 0]]
        const gainAt = (t: number) => {
          for (let i = 1; i < points.length; i++)
            if (t <= points[i][0]) {
              const [t0, v0] = points[i - 1], [t1, v1] = points[i]
              return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
            }
          return 0
        }
        master.gain.setValueAtTime(gainAt(origin), 0)
        for (const [t, v] of points) if (t > origin) master.gain.linearRampToValueAtTime(v, at(t))

        // One room for the whole file. Tone builds a reverb's impulse response from random noise, so
        // each segment would get a different room and the tail would change at the joins: the first
        // is made from a seeded generator (the same file every time) and the rest reuse it.
        const realRandom = Math.random
        if (!room) Math.random = mulberry(seed ^ 0x9e3779b9)
        const reverb = new Tone.Reverb({ decay: 8, wet: 0.45 - 0.2 * arousalAt(layout, origin) }).connect(master)
        try {
          await reverb.ready
        } finally {
          Math.random = realRandom
        }
        const convolver = (reverb as unknown as { _convolver?: { buffer: unknown } })._convolver
        if (convolver) {
          if (room) convolver.buffer = room
          else room = convolver.buffer
        }
        // calmer music sits in a wetter room, livelier music in a drier one (as the player)
        for (let t = Math.floor(origin) + 1; t <= end; t++) reverb.wet.linearRampToValueAtTime(0.45 - 0.2 * arousalAt(layout, t), at(t))
        let tail: InstanceType<typeof Tone.Reverb> | InstanceType<typeof Tone.FeedbackDelay> = reverb
        if (voice.echo && tempo.bpm) {
          tail = new Tone.FeedbackDelay({
            delayTime: (voice.echo.beats * 60) / tempo.bpm,
            feedback: voice.echo.feedback,
            wet: voice.echo.wet,
          }).connect(tail)
        }
        const filter = voice.lowpass ? new Tone.Filter(voice.lowpass, 'lowpass').connect(tail) : undefined
        const samplers = new Map(
          voice.layers.map((l) => [
            l.id,
            new Tone.Sampler({
              urls: Object.fromEntries(Object.keys(l.urls).map((k) => [k, buffers.get(l.id)!.get(k)])),
              attack: voice.attack,
              release: voice.release,
              curve: voice.curve ?? 'exponential',
            }).connect(filter ?? tail),
          ])
        )
        for (const e of events) {
          if (e.time < origin || e.time >= end) continue // earlier notes have died away before `origin + PRE`
          for (const r of routeNote(voice, e.note, arousalAt(layout, e.time))) {
            if ((r.layer.chain ?? 0) !== e.chain) continue
            samplers
              .get(r.layer.id)!
              .triggerAttackRelease(Tone.Frequency(r.note, 'midi').toNote(), e.hold, at(e.time), VELOCITY * (e.velocity ?? 1) * r.velocity)
          }
        }
      },
      end - origin,
      2,
      SAMPLE_RATE
    )
    const buf = out.get() as AudioBuffer
    const L = buf.getChannelData(0)
    const R = buf.getChannelData(1)
    const skip = Math.round((start - origin) * SAMPLE_RATE)
    const frames = Math.min(Math.round((end - start) * SAMPLE_RATE), total - from)
    for (let i = 0; i < frames; i++) {
      const l = L[skip + i], r = R[skip + i]
      peak = Math.max(peak, Math.abs(l), Math.abs(r))
      view.setInt16(44 + (from + i) * 4, Math.max(-1, Math.min(1, l)) * 0x7fff, true)
      view.setInt16(46 + (from + i) * 4, Math.max(-1, Math.min(1, r)) * 0x7fff, true)
    }
  }

  // kept exactly as it sounds (the live player's level) unless it would clip
  if (peak > 0.98) {
    const g = 0.98 / peak
    for (let i = 0; i < total * 2; i++) view.setInt16(44 + i * 2, Math.round(view.getInt16(44 + i * 2, true) * g), true)
  }
  progress({ stage: 'rendering', done: 1 })
  return wav
}
