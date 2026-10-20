// The field's state, in one place: the stops, the sound menu's choices, and the drift that is sounding
// or was just heard. Refs and computeds only — what changes them is in the ops files (stopOps,
// soundOps, driftOps, projectOps, exportOps), each of which takes this object. There is no store
// library: `createJourney()` is called once, in FieldApp.

import { computed, ref, shallowRef } from 'vue'
import { modeName } from '../engine/drift'
import { stateAt, type Bars, type Layout, type Variation } from '../engine/compose'
import { TEMPO_FEEL, clampBpm, defaultBpm, type Density, type Grid } from '../engine/pulse'
import { NOTE_NAMES } from '../engine/score'
import {
  VOICES,
  currentBars,
  currentCustomBpm,
  currentDensity,
  currentGrid,
  currentRoot,
  currentTempoFeel,
  currentVariation,
  currentVoiceId,
  type TempoFeelName,
} from '../engine/voices'
import type { DriftRecord, Plan, Readout } from './buildDrift'
import type { Point } from './moodPlane'

// The most stops a journey can have. More is possible for the engine; this keeps the screen readable.
export const MAX_POINTS = 6

// what a stop carries besides where it sits: its key, grid, density, variation and bars, if it has its own
export const settingsOf = (q: Point) => ({
  ...(q.key === undefined ? {} : { key: q.key }),
  ...(q.grid === undefined ? {} : { grid: q.grid }),
  ...(q.density === undefined ? {} : { density: q.density }),
  ...(q.variation === undefined ? {} : { variation: q.variation }),
  ...(q.bars === undefined ? {} : { bars: q.bars }),
})

export function createJourney() {
  // ── what is announced ─────────────────────────────────────────────────────────────────
  const announcement = ref('')
  const say = (text: string) => (announcement.value = text)

  // ── the stops ─────────────────────────────────────────────────────────────────────────
  // `points` is the journey, in order (the interface offers one or two; nothing below
  // assumes two). `position` is the fractional index along it, driven by the audio clock.
  const points = ref<Point[]>([])
  const preview = ref<Point | null>(null)
  const minutes = ref(10) // length of the whole drift; Infinity never ends

  // ── the sound menu: remembered between visits, applied to the next drift ─────────────────
  const voiceId = ref(currentVoiceId())
  // The tempo is fixed for the whole journey. By default it comes from the stops' mean arousal,
  // scaled by slow / medium / fast; or the listener types an exact BPM. The pulse plays to it; the
  // other sounds have no beat, but their exported files are written at it, so files of every sound
  // line up in a DAW.
  const tempoFeel = ref<TempoFeelName>(currentTempoFeel())
  const customBpm = ref<number | null>(currentCustomBpm())
  const effectiveBpm = computed(
    () =>
      customBpm.value ??
      clampBpm(
        defaultBpm(
          points.value.length ? points.value.map((p) => ({ arousal: p.a })) : [{ arousal: 0.4 }],
          TEMPO_FEEL[tempoFeel.value]
        )
      )
  )
  // The pulse's grid (steps per beat) and density (how many of the weak steps sound), fixed for the journey.
  const gridChoice = ref<Grid>(currentGrid())
  const densityChoice = ref<Density>(currentDensity())
  // How much the music changes (every sound): the first stop's is the sound menu's, each later stop
  // may set its own. It paces the harmony's moves and, for the pulse, its notes and phrases.
  const variationChoice = ref<Variation>(currentVariation())
  // Clusters on bars (pad, choir, orchestra; the pulse: its pattern): the whole cluster changes every n bars at the
  // journey's tempo, or 0 for free time. The first stop's is the sound menu's; each later stop may set its own.
  const barsChoice = ref<Bars>(currentBars())
  // The key: a root the listener chose (kept between visits), or auto — a new one each drift.
  const rootChoice = ref<number | null>(currentRoot())
  const isPulse = computed(() => VOICES[voiceId.value]?.style === 'pulse')

  // ── the drift ─────────────────────────────────────────────────────────────────────────
  const drifting = ref(false)
  const position = ref(0)
  const elapsed = ref(0)
  const totalSeconds = ref(Infinity)
  const plan = ref<Plan>({ waypoints: [], walk: 0 })
  const seed = ref(0)
  const audioActive = ref(false)
  const session = ref(0)
  const driftBpm = ref<number | undefined>(undefined) // the tempo this drift was started with (all sounds)
  const driftGrid = ref<Grid | undefined>(undefined) // what this drift was started with
  const driftDensity = ref<Density | undefined>(undefined)
  const driftVoice = ref('') // the sound this drift was played on
  const layout = shallowRef<Layout | null>(null) // reactive, so what is sounding follows it
  // What this journey is, kept on screen for a composer to note: key, modes, tempo, seed.
  const info = ref<Readout | null>(null)
  // what was begun, so it can be taken away exactly as it sounded (same plan, seed, voice, tempo)
  const lastDrift = shallowRef<DriftRecord | null>(null)
  const exporting = ref('') // what is being made right now (shown on the export word)

  // a seed from an opened project, used by the next Begin only (any edit to the journey drops it)
  const seedOverride = ref<number | null>(null)
  // "keep seed" (the seed in the readout): the last drift's seed and key are used by every Begin, so the same journey
  // can be heard (and exported) on another sound or tempo, with the same chords on bars. For this visit
  // only; an opened project brings its own seed and clears it.
  const kept = ref<{ seed: number; key: number } | null>(null)

  function reset() {
    seedOverride.value = null
    position.value = 0
    elapsed.value = 0
    info.value = null
  }

  // ── what is derived ───────────────────────────────────────────────────────────────────
  const barsOn = computed(() => !!layout.value?.bars.some((b) => b > 0)) // chords (or patterns) on bars: there are bar lines to cut on

  // The first stop's key is the journey's (also set in the sound menu); a later stop's is its own,
  // or none, which keeps the key of the stop before.
  const stopKeys = computed<(number | null)[]>(() => [rootChoice.value, ...points.value.slice(1).map((p) => p.key ?? null)])
  // As with the key: the first stop's grid, density, variation and bars are the sound menu's; a later stop's are
  // its own, or none, which keeps the stop before's. The grid changes once, midway along the walk to the stop;
  // the density eases along it.
  const stopGrids = computed<(Grid | null)[]>(() => [gridChoice.value, ...points.value.slice(1).map((p) => p.grid ?? null)])
  const stopDensities = computed<(Density | null)[]>(() => [densityChoice.value, ...points.value.slice(1).map((p) => p.density ?? null)])
  const stopVariations = computed<(Variation | null)[]>(() => [variationChoice.value, ...points.value.slice(1).map((p) => p.variation ?? null)])
  const stopBars = computed<(Bars | null)[]>(() => [barsChoice.value, ...points.value.slice(1).map((p) => p.bars ?? null)])

  // The mode and key sounding now: the start, moved by every step made so far.
  const nowState = computed(() => (layout.value ? stateAt(layout.value, elapsed.value) : null))
  // Which label to mark: among the stages in this mode and key, the one nearest the travelling
  // point. While passing through a mode or key that is not a stop (a long walk), nothing is marked.
  const activeStage = computed(() => {
    const now = nowState.value
    if (!info.value || !now || (!drifting.value && elapsed.value === 0)) return -1 // nothing is sounding
    let best = -1
    let gap = Infinity
    info.value.stages.forEach((st, i) => {
      if (st.rung !== now.rung || st.key !== now.tonic) return
      const d = position.value < st.from ? st.from - position.value : position.value > st.to ? position.value - st.to : 0
      if (d < gap) {
        gap = d
        best = i
      }
    })
    return best
  })
  // between two stops a long walk passes through modes and keys that have no label: say which
  const passing = computed(() => {
    const now = nowState.value
    if (!drifting.value || !info.value || !now || activeStage.value >= 0) return ' '
    return `passing ${info.value.uniform ? '' : NOTE_NAMES[now.tonic] + ' '}${modeName(now.rung)}`
  })
  const progress = computed(() =>
    drifting.value && Number.isFinite(totalSeconds.value) ? Math.min(1, Math.max(0, elapsed.value / totalSeconds.value)) : null
  )

  return {
    announcement,
    say,
    points,
    preview,
    minutes,
    voiceId,
    tempoFeel,
    customBpm,
    effectiveBpm,
    gridChoice,
    densityChoice,
    variationChoice,
    barsChoice,
    rootChoice,
    isPulse,
    drifting,
    position,
    elapsed,
    totalSeconds,
    plan,
    seed,
    audioActive,
    session,
    driftBpm,
    driftGrid,
    driftDensity,
    driftVoice,
    layout,
    info,
    exporting,
    kept,
    lastDrift,
    seedOverride,
    reset,
    barsOn,
    stopKeys,
    stopGrids,
    stopDensities,
    stopVariations,
    stopBars,
    nowState,
    activeStage,
    passing,
    progress,
  }
}

export type Journey = ReturnType<typeof createJourney>
