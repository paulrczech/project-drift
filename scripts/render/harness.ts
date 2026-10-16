import * as Tone from 'tone'
import { composeJourney, composeTimeline, layoutTimeline, arousalAt, ATTACK, RELEASE, type JourneyPlan, type TimelinePlan, type NoteEvent } from '../../src/engine/compose'

const URLS: Record<string, string> = { E2: 'E2.mp3', 'G#2': 'Gs2.mp3', C3: 'C3.mp3', E3: 'E3.mp3', 'G#3': 'Gs3.mp3', C4: 'C4.mp3', E4: 'E4.mp3', 'G#4': 'Gs4.mp3', C5: 'C5.mp3', E5: 'E5.mp3', 'G#5': 'Gs5.mp3', C6: 'C6.mp3' }

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

async function render(events: NoteEvent[], seconds: number, wet: number, wetAt?: (t: number) => number) {
  const buffers = new Tone.ToneAudioBuffers({ urls: URLS, baseUrl: '/public/samples/retro-pad/' })
  await Tone.loaded()
  const buf = await Tone.Offline(async () => {
    const reverb = new Tone.Reverb({ decay: 8, wet: wetAt ? wetAt(0) : wet }).toDestination()
    await reverb.ready
    // same curve as the live player: calmer music sits in a wetter room
    if (wetAt) for (let t = 1; t <= seconds; t++) reverb.wet.linearRampToValueAtTime(wetAt(t), t)
    const sampler = new Tone.Sampler({ urls: Object.fromEntries(Object.keys(URLS).map(k => [k, buffers.get(k)])), attack: ATTACK, release: RELEASE }).connect(reverb)
    for (const e of events) sampler.triggerAttackRelease(Tone.Frequency(e.note, 'midi').toNote(), e.hold, e.time, 0.8)
  }, seconds + RELEASE + 6, 2)
  const L = buf.getChannelData(0); let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]))
  const gain = peak > 0 ? 0.7 / peak : 1 // normalise to -3 dB for listening
  return { wav: wav16(buf, gain), peak, gain }
}

;(window as any).renderJourney = async (plan: JourneyPlan & { seed?: number }, wet = 0.35) => {
  if (plan.seed != null) { let a = plan.seed; plan.rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  const c = composeJourney(plan)
  const lay = layoutTimeline([{ rung: plan.from, hold: plan.holdA }, { rung: plan.to, hold: plan.holdB }], plan.shiftSeconds)
  return { ...(await render(c.events, c.duration, wet, (t) => 0.45 - 0.2 * arousalAt(lay, t))), marks: c.marks, events: c.events.length }
}
;(window as any).renderTimeline = async (plan: TimelinePlan & { seed?: number }, wet = 0.35) => {
  if (plan.seed != null) { let a = plan.seed; plan.rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  const c = composeTimeline(plan)
  const lay = layoutTimeline(plan.waypoints, plan.walk)
  return { ...(await render(c.events, c.duration, wet, (t) => 0.45 - 0.2 * arousalAt(lay, t))), marks: c.marks, events: c.events.length }
}
;(window as any).renderNote = async (note: number, wet = 0) => render([{ time: 0, note, hold: 5 }], 5, wet)
