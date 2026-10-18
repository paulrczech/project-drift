import * as Tone from 'tone'
import { composeJourney, composeTimeline, layoutTimeline, arousalAt, type JourneyPlan, type TimelinePlan, type NoteEvent } from '../../src/engine/compose'
import { VOICES, routeNote, type Voice } from '../../src/engine/voices'
import { performerFor } from '../../src/engine/performer'
import { TEMPO_FEEL, defaultBpm, type TempoFeel } from '../../src/engine/pulse'
import { renderDriftWav } from '../../src/engine/render'

// what a voice asks of the composer
const params = (v: Voice) => ({ register: v.register, span: v.span, ceiling: v.ceiling, attack: v.attack, link: v.link, links: v.links, overlap: v.overlap, maxHold: v.maxHold })

function wav16(buf: Tone.ToneAudioBuffer, gain: number): string {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
  const n = L.length, out = new DataView(new ArrayBuffer(44 + n * 4))
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true)
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true)
  for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * gain)) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * gain)) * 32767, true) }
  let bin = ''; const u = new Uint8Array(out.buffer); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function render(events: NoteEvent[], seconds: number, wet: number, voice0: Voice, wetAt?: (t: number) => number, only?: string[], arousalOf?: (t: number) => number, bpm?: number) {
  const voice = only ? { ...voice0, layers: voice0.layers.filter(l => only.includes(l.id)) } : voice0
  const buffers = new Map(voice.layers.map(l => [l.id, new Tone.ToneAudioBuffers({ urls: l.urls, baseUrl: '/public' + l.baseUrl })]))
  await Tone.loaded()
  const buf = await Tone.Offline(async () => {
    const reverb = new Tone.Reverb({ decay: 8, wet: wetAt ? wetAt(0) : wet }).toDestination()
    await reverb.ready
    // same curve as the live player: calmer music sits in a wetter room
    if (wetAt) for (let t = 1; t <= seconds; t++) reverb.wet.linearRampToValueAtTime(wetAt(t), t)
    // the chain, from the end back: reverb <- echo <- low-pass <- samplers (as in the live player)
    let tail: any = reverb
    if (voice.echo && bpm) {
      // fixed tempo, so a fixed delay (as in the live player)
      tail = new Tone.FeedbackDelay({ delayTime: (voice.echo.beats * 60) / bpm, feedback: voice.echo.feedback, wet: voice.echo.wet }).connect(tail)
    }
    const filter = voice.lowpass ? new Tone.Filter(voice.lowpass, 'lowpass').connect(tail) : undefined
    const samplers = new Map(voice.layers.map(l => [l.id, new Tone.Sampler({
      urls: Object.fromEntries(Object.keys(l.urls).map(k => [k, buffers.get(l.id)!.get(k)])), attack: voice.attack, release: voice.release, curve: voice.curve ?? 'exponential',
    }).connect(filter ?? tail)]))
    // route through the FULL voice (the loudness normalisation depends on every layer), then
    // let only the chosen layers' samplers sound
    for (const e of events) for (const r of routeNote(voice0, e.note, arousalOf ? arousalOf(e.time) : 0.5)) if ((r.layer.chain ?? 0) === e.chain && samplers.has(r.layer.id))
      samplers.get(r.layer.id)!.triggerAttackRelease(Tone.Frequency(r.note, 'midi').toNote(), e.hold, e.time, 0.8 * (e.velocity ?? 1) * r.velocity)
  }, seconds + voice.release + 6, 2)
  const L = buf.getChannelData(0); let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]))
  // RMS over the body of the render (not the fade-in/out), to compare voices' loudness
  const a = Math.floor(L.length * 0.15), b = Math.floor(L.length * 0.75); let sq = 0; for (let i = a; i < b; i++) sq += L[i] * L[i]
  const rms = Math.sqrt(sq / Math.max(1, b - a))
  // a fixed gain from the voice's live level (not per-file normalising), so voices stay comparable
  const gain = peak > 0 ? Math.min(voice.level * 2, 0.95 / peak) : 1
  return { wav: wav16(buf, gain), peak, gain, rms }
}

;(window as any).renderJourney = async (plan: JourneyPlan & { seed?: number }, wet = 0.35) => {
  if (plan.seed != null) { let a = plan.seed; plan.rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  const voice = VOICES[(plan as any).voice ?? 'pad']
  const c = composeJourney({ ...plan, ...params(voice) } as any)
  const lay = layoutTimeline([{ rung: plan.from, hold: plan.holdA }, { rung: plan.to, hold: plan.holdB }], plan.shiftSeconds)
  return { ...(await render(c.events, c.duration, wet, voice, (t) => 0.45 - 0.2 * arousalAt(lay, t))), marks: c.marks, events: c.events.length }
}
;(window as any).renderTimeline = async (plan: TimelinePlan & { seed?: number }, wet = 0.35) => {
  if (plan.seed != null) { let a = plan.seed; plan.rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  let voice = { ...VOICES[(plan as any).voice ?? 'pad'], ...((plan as any).override ?? {}) } as Voice
  // syncChains: every layer re-strikes in unison (for measuring what desynchronising buys)
  if ((plan as any).override?.syncChains) voice = { ...voice, layers: voice.layers.map(l => ({ ...l, chain: 0 })), links: [voice.link] }
  const feel: TempoFeel = (plan as any).tempoFeel ?? 'medium'
  const lay = layoutTimeline(plan.waypoints, plan.walk)
  const bpm: number | undefined = voice.style === 'pulse' ? (plan as any).bpm ?? Math.round(defaultBpm(plan.waypoints, TEMPO_FEEL[feel])) : undefined
  const performer = performerFor(voice, plan, plan.rng ?? Math.random, { feel, bpm })
  const events = performer.pull(lay.duration)
  return { ...(await render(events, lay.duration, wet, voice, (t) => 0.45 - 0.2 * arousalAt(lay, t), (plan as any).only, (t) => arousalAt(lay, t), bpm)), marks: [], events: events.length, bpm }
}
;(window as any).renderNote = async (note: number, wet = 0, voiceId = 'pad') => render([{ time: 0, note, hold: 5 }], 5, wet, VOICES[voiceId])

// the app's own WAV export (src/engine/render.ts): level as the live player's, fades included
;(window as any).renderExport = async (plan: TimelinePlan & { seed: number; voice: string; bpm?: number }) => {
  const voice = VOICES[plan.voice]
  const t = performance.now()
  const bytes = await renderDriftWav(voice, { waypoints: plan.waypoints, walk: plan.walk, tonic: plan.tonic }, plan.seed, { bpm: plan.bpm }, undefined, '/public', (plan as any).cut)
  console.log('renderExport seconds', ((performance.now() - t) / 1000).toFixed(1))
  const pcm = new Int16Array(bytes.buffer, 44, (bytes.length - 44) / 2)
  let peak = 0, sq = 0; for (let i = 0; i < pcm.length; i += 2) { peak = Math.max(peak, Math.abs(pcm[i]) / 32768); sq += (pcm[i] / 32768) ** 2 }
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { wav: btoa(bin), peak, rms: Math.sqrt(sq / (pcm.length / 2)), gain: 1, marks: [], events: 0 }
}
