// Taking the journey away (file menu): what to make (MIDI; clips for a DAW's clip view; the audio as
// WAV) and how much of it — this drift, several seeds of it (the same stops, key, tempo and sound, the
// seeds running on from this drift's own, so the first is what was just heard), or this drift on several
// sounds (this seed and tempo; on bars they play the same chords). One file when it is one MIDI or WAV,
// else a zip. The audio is rendered offline, faster than real time; it cannot run beside a live drift
// (the offline context takes over Tone's clock), so it waits until the sound has stopped.

import { renderDriftWav } from '../engine/render'
import { GRID_LABEL } from '../engine/pulse'
import { scoreFor } from '../engine/score'
import { VOICES } from '../engine/voices'
import type { DriftRecord } from './buildDrift'
import { clipFiles, download, exportName, midiBytes, type ExportRequest } from './exportMidi'
import type { Journey } from './journey'
import { zipStored, type ZipFile } from './zip'

export interface ExportUnit {
  voiceId: string
  seed: number
}

// what a request asks for: this drift, N seeds of it on its sound, or its seed on each chosen sound
export function exportUnits(req: ExportRequest, d: DriftRecord, known: (voiceId: string) => boolean): ExportUnit[] {
  return req.scope === 'seeds'
    ? Array.from({ length: req.count }, (_, k) => ({ voiceId: d.voiceId, seed: (d.seed + k) % 2 ** 31 }))
    : req.scope === 'sounds'
      ? req.sounds.filter(known).map((id) => ({ voiceId: id, seed: d.seed }))
      : [{ voiceId: d.voiceId, seed: d.seed }]
}

// tells the files of a set apart: in a file name (and a clips folder)
export const unitTag = (req: ExportRequest, u: ExportUnit) =>
  req.scope === 'seeds' ? `${u.voiceId}-seed${u.seed}` : req.scope === 'sounds' ? u.voiceId : undefined

// the name's tag for a zip of several files
export const zipTagFor = (req: ExportRequest, d: DriftRecord, units: ExportUnit[]) => {
  const zipTag = req.scope === 'seeds' ? `${d.voiceId}-${req.count}-seeds` : req.scope === 'sounds' ? `${units.length}-sounds` : `${d.voiceId}-clips`
  return req.format === 'clips' && req.scope !== 'this' ? `${zipTag}-clips` : zipTag
}

export function useExportOps(j: Journey) {
  const { say, exporting, lastDrift, audioActive } = j

  async function exportAs(req: ExportRequest) {
    if (!lastDrift.value || exporting.value) return
    const wav = req.format === 'wav'
    if (wav && audioActive.value) return
    const d = lastDrift.value
    const units = exportUnits(req, d, (id) => !!VOICES[id])
    if (!units.length) return
    const many = units.length > 1
    const ext = req.format === 'clips' ? 'zip' : req.format === 'mid' ? 'mid' : 'wav'
    exporting.value = wav ? 'loading…' : 'saving…'
    say(wav ? 'Rendering the audio. This can take a little while.' : many ? `Making ${units.length} files.` : 'Making the file.')
    try {
      const files: ZipFile[] = []
      let without = 0 // sounds that had nothing to cut into clips
      for (const [k, u] of units.entries()) {
        const voice = VOICES[u.voiceId]
        const pulse = voice.style === 'pulse'
        // the pulse's grid and density are the drift's, or (when it was another sound) the sound menu's
        const tempo = { bpm: d.bpm, grid: d.grid ?? j.gridChoice.value, density: d.density ?? j.densityChoice.value }
        const info = {
          voice: voice.label,
          seed: u.seed,
          stops: d.stops,
          minutes: d.minutes,
          feel: pulse ? `${GRID_LABEL[tempo.grid]} ${tempo.density}` : undefined,
        }
        const of = `${k + 1}/${units.length}`
        const tag = unitTag(req, u)
        if (wav) {
          const bytes = await renderDriftWav(voice, d.plan, u.seed, tempo, (p) => {
            exporting.value = p.stage === 'loading' ? 'loading…' : many ? `rendering ${of} ${Math.round(p.done * 100)}%` : `rendering ${Math.round(p.done * 100)}%`
          })
          files.push({ name: exportName(d.head, d.modes, d.bpm, 'wav', tag), data: bytes })
          continue
        }
        if (many) exporting.value = `saving ${of}`
        await new Promise((r) => setTimeout(r)) // let the label show
        const score = scoreFor(voice, d.plan, u.seed, tempo)
        if (req.format === 'mid') {
          files.push({ name: exportName(d.head, d.modes, d.bpm, 'mid', tag), data: await midiBytes(score, info) })
        } else {
          const clips = await clipFiles(score, info, d.words)
          if (!clips.length) without++
          files.push(...clips.map((f) => (many ? { ...f, name: `${tag}/${f.name}` } : f)))
        }
      }
      if (!files.length) {
        say('There was nothing to cut into clips: free time has no bar lines. Put chords on bars, or use the pulse.')
        return
      }
      const what = `${d.head ? d.head + ' ' : ''}${d.modes.join(' to ')}`
      if (files.length === 1 && req.format !== 'clips') {
        download(files[0].data, files[0].name, wav ? 'audio/wav' : 'audio/midi')
        say(`${wav ? 'Audio' : 'MIDI'} file saved: ${what}.`)
      } else {
        download(zipStored(files), exportName(d.head, d.modes, d.bpm, 'zip', zipTagFor(req, d, units)), 'application/zip')
        say(`${ext === 'zip' && req.scope === 'this' ? `${files.length - 1} clips` : `${units.length} ${units.length > 1 ? 'files' : 'file'}`} saved: ${what}.` + (without ? ` ${without} had nothing to cut.` : ''))
      }
    } catch {
      say('Sorry, that could not be made.')
    } finally {
      exporting.value = ''
    }
  }

  return { exportAs }
}
