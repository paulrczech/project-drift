// Editing the stops: touching the field, the word lists, a stop's bubble. Nothing changes while a drift
// is sounding, and any edit drops what an opened project left for the next Begin (`reset`).

import { BARS_NAME, type Bars, type Variation } from '../engine/compose'
import { GRID_NAME, type Density, type Grid } from '../engine/pulse'
import { NOTE_NAMES } from '../engine/score'
import { ordinal } from './buildDrift'
import { MAX_POINTS, settingsOf, type Journey } from './journey'
import { describe, type Point } from './moodPlane'
import type { SoundOps } from './soundOps'
import { warmUp } from './warmUp'

export function useStopOps(j: Journey, sound: SoundOps, view: { focusField: () => void }) {
  const { points, drifting, say, reset } = j
  const wordFor = describe

  function choose(p: Point) {
    if (drifting.value) return
    const last = points.value[points.value.length - 1]
    if (last && last.v === p.v && last.a === p.a) return // the same place again: nothing to add
    reset()
    warmUp()
    const n = points.value.length
    if (n === 0) {
      points.value = [p]
      say(`Where you are: ${wordFor(p)}. Choose where you would like to be, or begin.`)
    } else if (n >= MAX_POINTS) {
      points.value = [...points.value.slice(0, -1), p]
      say(`The most stops is ${MAX_POINTS}. Replaced the last with ${wordFor(p)}.`)
    } else {
      points.value = [...points.value, p]
      say(
        `${n === 1 ? 'Where you would like to be' : ordinal(n + 1)}: ${wordFor(p)}. ` +
          (n + 1 < MAX_POINTS ? 'Add another stop, or begin.' : 'That is the most stops. Begin when you are ready.')
      )
    }
  }

  function remove(i: number) {
    if (drifting.value) return
    reset()
    const gone = points.value[i]
    points.value = points.value.filter((_, k) => k !== i)
    say(`Removed ${wordFor(gone)}.`)
  }

  // Start a new journey without taking the old stops away one at a time.
  function clear() {
    if (drifting.value || !points.value.length) return
    reset()
    points.value = []
    say('Cleared. Touch where you are.')
    view.focusField() // the button is about to go quiet; keep the keyboard somewhere useful
  }

  // the word lists: set a stop, add the next, or take one away
  function setFromWords(index: number, p: Point | null) {
    if (drifting.value) return
    reset()
    if (p) warmUp()
    if (!p) {
      points.value = points.value.filter((_, k) => k !== index)
      say('Removed a stop.')
      return
    }
    if (index < points.value.length)
      points.value = points.value.map((q, k) => (k === index ? { ...p, ...settingsOf(q) } : q))
    else if (index === points.value.length && index < MAX_POINTS) points.value = [...points.value, p]
    say(`${index === 0 ? 'Where you are' : ordinal(index + 1)}: ${wordFor(p)}.`)
  }

  // ── a stop's key ────────────────────────────────────────────────────────────────────
  // The first stop's key is the journey's (also set in the sound menu); a later stop's is its own,
  // or none, which keeps the key of the stop before.
  function setStopKey(i: number, key: number | null) {
    if (drifting.value || i >= points.value.length) return
    if (i === 0) {
      sound.chooseRoot(key)
      return
    }
    reset()
    points.value = points.value.map((p, k) => {
      if (k !== i) return p
      const { key: _gone, ...rest } = p
      return key === null ? rest : { ...rest, key }
    })
    say(`Stop ${i + 1}: ${key === null ? 'the same key as before' : NOTE_NAMES[key]}.`)
  }

  // ── a stop's grid, density, variation and bars ───────────────────────────────────────
  // As with the key: the first stop's are the sound menu's; a later stop's are its own, or none,
  // which keeps the stop before's. The grid changes once, midway along the walk to the stop;
  // the density eases along it.
  function setStopFeel(i: number, field: 'grid' | 'density' | 'variation' | 'bars', value: Grid | Density | Variation | Bars | null) {
    if (drifting.value || i >= points.value.length) return
    if (i === 0) {
      if (value === null) return
      if (field === 'grid') sound.chooseGrid(value as Grid)
      else if (field === 'density') sound.chooseDensity(value as Density)
      else if (field === 'bars') sound.chooseBars(value as Bars)
      else sound.chooseVariation(value as Variation)
      return
    }
    reset()
    points.value = points.value.map((p, k) => {
      if (k !== i) return p
      const { [field]: _gone, ...rest } = p
      return value === null ? rest : { ...rest, [field]: value }
    })
    const what = field === 'grid' ? 'Grid' : field === 'density' ? 'Notes' : field === 'bars' ? (j.isPulse.value ? 'Pattern' : 'Chords') : 'Variation'
    const shown =
      value === null ? 'the same as before' : field === 'grid' ? GRID_NAME[value as Grid] : field === 'bars' ? (value ? BARS_NAME[value as Bars] : 'free time') : value
    say(`Stop ${i + 1}: ${what} ${shown}.`)
  }
  const setStopGrid = (i: number, g: Grid | null) => setStopFeel(i, 'grid', g)
  const setStopDensity = (i: number, d: Density | null) => setStopFeel(i, 'density', d)
  const setStopVariation = (i: number, v: Variation | null) => setStopFeel(i, 'variation', v)
  const setStopBars = (i: number, b: Bars | null) => setStopFeel(i, 'bars', b)

  return { choose, remove, clear, setFromWords, setStopKey, setStopGrid, setStopDensity, setStopVariation, setStopBars }
}

export type StopOps = ReturnType<typeof useStopOps>
