// A drift's life: Begin, the audio clock's progress, stopping or arriving, and keeping its seed.

import { watch } from 'vue'
import { NOTE_NAMES } from '../engine/score'
import { buildDrift } from './buildDrift'
import type { Journey } from './journey'

export function useDriftOps(j: Journey, view: { stopPlayer: () => void }) {
  const { points, drifting, say, reset, info, kept, lastDrift } = j
  let audioTeardown: number | undefined

  function begin() {
    if (!points.value.length || drifting.value) return
    clearTimeout(audioTeardown)
    const forcedSeed = j.seedOverride.value
    reset()
    const d = buildDrift({
      points: points.value,
      minutes: j.minutes.value,
      voiceId: j.voiceId.value,
      pulse: j.isPulse.value,
      bpm: j.effectiveBpm.value,
      grid: j.gridChoice.value,
      density: j.densityChoice.value,
      variation: j.variationChoice.value,
      bars: j.barsChoice.value,
      rootChoice: j.rootChoice.value,
      kept: kept.value,
      seedOverride: forcedSeed,
      random: Math.random,
    })
    j.plan.value = d.plan
    j.seed.value = d.seed
    j.driftBpm.value = d.bpm
    j.totalSeconds.value = d.layout.duration
    j.driftVoice.value = d.voiceId
    j.driftGrid.value = d.grid
    j.driftDensity.value = d.density
    j.layout.value = d.layout
    info.value = d.readout
    lastDrift.value = d.record
    j.session.value++
    j.audioActive.value = true
    drifting.value = true
    j.preview.value = null
    say(d.announcement)
  }

  function onProgress(newPosition: number, _text: number, seconds: number) {
    j.position.value = newPosition
    j.elapsed.value = seconds
  }

  function finish(announce: string) {
    drifting.value = false
    // unmount after the audio has finished fading, or it is cut mid-fade
    audioTeardown = window.setTimeout(() => (j.audioActive.value = false), 3100)
    say(announce)
  }

  function stop() {
    view.stopPlayer()
    // the colours return to the start, but what was drifted stays on screen (and can be exported)
    const shown = info.value
    reset()
    info.value = shown
    finish('The drift has ended.')
  }

  function onEnded() {
    finish('The drift has ended. You have arrived.')
  }

  // "keep seed" (the seed in the readout): press to keep, press again to let go
  function keepSeed() {
    if (kept.value) {
      kept.value = null
      say('Seed released: each Begin draws a new one.')
    } else if (lastDrift.value) {
      kept.value = { seed: lastDrift.value.seed, key: lastDrift.value.plan.tonic ?? 0 }
      say(`Seed ${lastDrift.value.seed} kept, in ${NOTE_NAMES[kept.value.key]}. Begin again, on any sound, to hear it again.`)
    }
  }

  // say which mode the drift has come into
  watch(j.activeStage, (i, before) => {
    if (drifting.value && i >= 0 && i !== before && info.value) say(`Now in ${info.value.stages[i].label}.`)
  })

  return { begin, onProgress, stop, onEnded, keepSeed }
}

export type DriftOps = ReturnType<typeof useDriftOps>
