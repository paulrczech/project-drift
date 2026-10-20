// The project file: saving the last drift so it reopens exactly, and opening one.

import { DEFAULT_BARS, DEFAULT_VARIATION } from '../engine/compose'
import { NOTE_NAMES } from '../engine/score'
import { VOICES, preloadVoice } from '../engine/voices'
import { download, exportName } from './exportMidi'
import { MAX_POINTS, settingsOf, type Journey } from './journey'
import { LENGTHS } from './lengths'
import { parseProject, toProject } from './project'
import { warmUp } from './warmUp'

export function useProjectOps(j: Journey) {
  const { say, points, lastDrift, reset } = j

  function saveProject() {
    if (!lastDrift.value) return
    const d = lastDrift.value
    const project = toProject({
      points: d.points,
      words: d.words,
      minutes: d.minutes,
      root: d.plan.tonic ?? 0,
      voice: d.voiceId,
      bpm: d.bpm,
      grid: d.grid,
      density: d.density,
      variation: d.plan.waypoints[0]?.variation ?? DEFAULT_VARIATION,
      bars: d.plan.waypoints[0]?.bars ?? DEFAULT_BARS,
      seed: d.seed,
      modes: d.modes,
      timeline: d.timeline,
    })
    const name = exportName(d.head, d.modes, d.bpm, 'drift.json')
    download(new TextEncoder().encode(JSON.stringify(project, null, 2) + '\n'), name, 'application/json')
    say(`Project saved: ${d.key} ${d.modes.join(' to ')}.`)
  }

  // Opening a project sets up the journey as it was (its seed is used by the next Begin). The
  // sound, tempo and key are the project's for this visit only: they do not replace the listener's
  // remembered choices.
  function openProject(text: string) {
    if (j.drifting.value || j.audioActive.value) return
    const r = parseProject(text, { lengths: LENGTHS, maxStops: MAX_POINTS })
    if (!r.ok) {
      say(r.reason)
      return
    }
    const p = r.project
    reset()
    points.value = p.stops.map((s) => ({ v: s.v, a: s.a, ...settingsOf(s) }))
    j.minutes.value = p.minutes
    j.rootChoice.value = p.root
    if (VOICES[p.voice]) {
      j.voiceId.value = p.voice
      preloadVoice(VOICES[p.voice])
    }
    j.customBpm.value = p.bpm === null ? null : p.bpm
    if (p.grid) j.gridChoice.value = p.grid
    if (p.density) j.densityChoice.value = p.density
    j.variationChoice.value = p.variation
    j.barsChoice.value = p.bars
    warmUp()
    j.seedOverride.value = p.seed
    j.kept.value = null
    say(`Project opened: ${p.stops.length === 1 ? '1 stop' : `${p.stops.length} stops`}, ${NOTE_NAMES[p.root]}. Press begin.${p.timeline ? ' Its sections are not shown yet; it plays as stops.' : ''}`)
  }

  return { saveProject, openProject }
}
