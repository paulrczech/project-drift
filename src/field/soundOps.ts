// The sound menu's choices: each sets the journey's value, remembers it for the next visit, and says so.

import { BARS_NAME, type Bars, type Variation } from '../engine/compose'
import { GRID_NAME, clampBpm, type Density, type Grid } from '../engine/pulse'
import { NOTE_NAMES } from '../engine/score'
import {
  VOICES,
  preloadVoice,
  rememberBars,
  rememberCustomBpm,
  rememberDensity,
  rememberGrid,
  rememberRoot,
  rememberTempoFeel,
  rememberVariation,
  rememberVoice,
  type TempoFeelName,
} from '../engine/voices'
import type { Journey } from './journey'

export function useSoundOps(j: Journey) {
  const { say } = j

  function chooseVoice(id: string) {
    j.voiceId.value = id
    rememberVoice(id)
    preloadVoice(VOICES[id])
    say(`Sound: ${VOICES[id].label}.`)
  }
  function chooseTempo(feel: TempoFeelName) {
    j.tempoFeel.value = feel
    j.customBpm.value = null
    rememberTempoFeel(feel)
    say(`Tempo: ${feel}, ${j.effectiveBpm.value} BPM.`)
  }
  function chooseBpm(bpm: number) {
    j.customBpm.value = clampBpm(bpm)
    rememberCustomBpm(j.customBpm.value)
    say(`Tempo: ${j.customBpm.value} BPM.`)
  }
  function chooseGrid(grid: Grid) {
    j.gridChoice.value = grid
    rememberGrid(grid)
    say(`Grid: ${GRID_NAME[grid]}.`)
  }
  function chooseDensity(density: Density) {
    j.densityChoice.value = density
    rememberDensity(density)
    say(`Notes: ${density}.`)
  }
  function chooseVariation(variation: Variation) {
    j.variationChoice.value = variation
    rememberVariation(variation)
    say(`Variation: ${variation}.`)
  }
  function chooseBars(bars: Bars) {
    j.barsChoice.value = bars
    rememberBars(bars)
    say(j.isPulse.value ? (bars ? `Pattern: a new one ${BARS_NAME[bars]}.` : 'Pattern: free time.') : bars ? `Chords: a new cluster ${BARS_NAME[bars]}.` : 'Chords: free time.')
  }
  function chooseRoot(root: number | null) {
    j.rootChoice.value = root
    rememberRoot(root)
    say(root === null ? 'Key: a new one each time.' : `Key: ${NOTE_NAMES[root]}.`)
  }

  return { chooseVoice, chooseTempo, chooseBpm, chooseGrid, chooseDensity, chooseVariation, chooseBars, chooseRoot }
}

export type SoundOps = ReturnType<typeof useSoundOps>
