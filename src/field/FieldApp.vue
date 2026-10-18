<script setup lang="ts">
  import { computed, defineAsyncComponent, ref, watch } from 'vue'
  import FieldBackground from './FieldBackground.vue'
  import MoodField from './MoodField.vue'
  import JourneyRing from './JourneyRing.vue'
  import WordsFallback from './WordsFallback.vue'
  import SoundPicker from './SoundPicker.vue'
  import ExportPicker from './ExportPicker.vue'
  import { scoreFor } from '../engine/score'
  import { download, exportName, midiBytes } from './exportMidi'
  import {
    describe,
    paletteAt,
    palettePath,
    inkFor,
    type Point,
  } from './moodPlane'
  import { rungFor } from '../engine/moods'
  import { layoutTimeline, type Layout, type TimelinePlan } from '../engine/compose'
  import { TEMPO_FEEL, clampBpm, defaultBpm } from '../engine/pulse'
  import { LADDER } from '../engine/drift'

  import {
    VOICES,
    currentCustomBpm,
    currentTempoFeel,
    currentVoiceId,
    preloadVoice,
    rememberCustomBpm,
    rememberTempoFeel,
    rememberVoice,
    voiceFromLocation,
    type TempoFeelName,
  } from '../engine/voices'

  // Tone.js is large and only needed once a drift starts, so the player loads on demand —
  // and, with the samples, is fetched ahead of time as soon as someone chooses a first stop.
  const loadPlayer = () => import('../components/GenerativePlayer.vue')
  const GenerativePlayer = defineAsyncComponent(loadPlayer)
  function warmUp() {
    loadPlayer()
    preloadVoice(voiceFromLocation())
  }

  // The sound: remembered between visits, applied to the next drift.
  const voiceId = ref(currentVoiceId())
  function chooseVoice(id: string) {
    voiceId.value = id
    rememberVoice(id)
    preloadVoice(VOICES[id])
    say(`Sound: ${VOICES[id].label}.`)
  }

  // The pulse's tempo is fixed for the whole journey. By default it comes from the stops' mean
  // arousal, scaled by slow / medium / fast; or the listener types an exact BPM.
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
  function chooseTempo(feel: TempoFeelName) {
    tempoFeel.value = feel
    customBpm.value = null
    rememberTempoFeel(feel)
    say(`Tempo: ${feel}, ${effectiveBpm.value} BPM.`)
  }
  function chooseBpm(bpm: number) {
    customBpm.value = clampBpm(bpm)
    rememberCustomBpm(customBpm.value)
    say(`Tempo: ${customBpm.value} BPM.`)
  }
  const driftBpm = ref<number | undefined>(undefined) // the tempo this drift was started with

  // What this journey is, kept on screen for a composer to note: key, modes, tempo, seed.
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  // `stages` are the modes in journey order (consecutive repeats merged); `from`/`to` are the
  // waypoints each covers, so the one that is sounding can be marked as the drift moves.
  interface Stage {
    mode: string
    rung: number
    from: number
    to: number
  }
  const info = ref<{ key: string; stages: Stage[]; bpm?: number; seed: string } | null>(null)
  let layout: Layout | null = null
  // what was begun, so it can be taken away exactly as it sounded (same plan, seed, voice, tempo)
  let lastDrift: { voiceId: string; plan: TimelinePlan; seed: number; bpm?: number; stops: string; minutes: number } | null = null
  const exporting = ref(false)

  // ── state ───────────────────────────────────────────────────────────────────────────
  // `points` is the journey, in order (the interface offers one or two; nothing below
  // assumes two). `position` is the fractional index along it, driven by the audio clock.
  const points = ref<Point[]>([])
  const preview = ref<Point | null>(null)
  // The most stops a journey can have. More is possible for the engine; this keeps the screen readable.
  const MAX_POINTS = 6
  const minutes = ref(10) // length of the whole drift; Infinity never ends
  const drifting = ref(false)
  const position = ref(0)
  const elapsed = ref(0)
  const totalSeconds = ref(Infinity)

  const plan = ref<Omit<TimelinePlan, 'rng'>>({ waypoints: [], walk: 0 })
  const seed = ref(0)
  const audioActive = ref(false)
  const session = ref(0)
  let audioTeardown: number | undefined
  const playerRef = ref<{ stopDrift: () => void } | null>(null)
  const fieldRef = ref<{ focus: () => void } | null>(null)

  const announcement = ref('')
  const say = (text: string) => (announcement.value = text)

  const wordFor = describe
  const lengthName = (m: number) =>
    m === Infinity ? 'with no end' : m === 1 ? 'for 1 minute' : `for ${m} minutes`

  // ── choosing ────────────────────────────────────────────────────────────────────────
  function reset() {
    position.value = 0
    elapsed.value = 0
    info.value = null
  }

  const ordinal = (n: number) => `stop ${n}`

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
    fieldRef.value?.focus() // the button is about to go quiet; keep the keyboard somewhere useful
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
    if (index < points.value.length) points.value = points.value.map((q, k) => (k === index ? p : q))
    else if (index === points.value.length && index < MAX_POINTS) points.value = [...points.value, p]
    say(`${index === 0 ? 'Where you are' : ordinal(index + 1)}: ${wordFor(p)}.`)
  }

  // ── a drift ─────────────────────────────────────────────────────────────────────────
  // Length is for the whole drift: 15% settled where you are, 30% arriving where you are going
  // (ending in the fade), and the middle 55% travelling — split between the legs, with a brief
  // settle (a third of a leg) at each stop in between so every mood is heard. ∞ travels over
  // ten minutes, then stays.
  function planFor(pts: Point[], m: number) {
    const endless = m === Infinity
    const total = (endless ? 10 : m) * 60
    const moods = pts.map((p) => ({ rung: rungFor(p.v), arousal: p.a }))
    const n = moods.length
    if (n === 1) return { waypoints: [{ ...moods[0], hold: endless ? Infinity : total }], walk: 0 }
    const leg = (total * 0.55) / (n - 1 + 0.3 * (n - 2))
    return {
      waypoints: moods.map((mood, i) => ({
        ...mood,
        hold: i === 0 ? total * 0.15 : i === n - 1 ? (endless ? Infinity : total * 0.3) : leg * 0.3,
      })),
      walk: leg,
    }
  }

  function begin() {
    if (!points.value.length || drifting.value) return
    clearTimeout(audioTeardown)
    reset()
    plan.value = {
      ...planFor(points.value, minutes.value),
      tonic: Math.floor(Math.random() * 12), // a fresh key each time, never shown
    }
    totalSeconds.value = layoutTimeline(plan.value.waypoints, plan.value.walk).duration
    seed.value = Math.floor(Math.random() * 2 ** 31)
    const pulse = VOICES[voiceId.value]?.style === 'pulse'
    driftBpm.value = pulse ? effectiveBpm.value : undefined
    const stages: Stage[] = []
    plan.value.waypoints.forEach((w, i) => {
      const last = stages[stages.length - 1]
      if (last && last.rung === w.rung) last.to = i
      else stages.push({ mode: LADDER[w.rung], rung: w.rung, from: i, to: i })
    })
    layout = layoutTimeline(plan.value.waypoints, plan.value.walk)
    info.value = { key: NOTE_NAMES[plan.value.tonic ?? 0], stages, bpm: driftBpm.value, seed: `seed ${seed.value}` }
    lastDrift = {
      voiceId: voiceId.value,
      plan: plan.value,
      seed: seed.value,
      bpm: driftBpm.value,
      stops: points.value.map(wordFor).join(' > '),
      minutes: minutes.value,
    }
    session.value++
    audioActive.value = true
    drifting.value = true
    preview.value = null
    const words = points.value.map(wordFor)
    const route =
      words.length === 1
        ? `in ${words[0]}`
        : `from ${words[0]}${words.length > 2 ? ` through ${words.slice(1, -1).join(', ')}` : ''} to ${words[words.length - 1]}`
    say(
      `Drifting ${route} ${lengthName(minutes.value)}, in ${NOTE_NAMES[plan.value.tonic ?? 0]}${driftBpm.value ? `, ${driftBpm.value} beats per minute` : ''}.`
    )
  }

  function onProgress(newPosition: number, _text: number, seconds: number) {
    position.value = newPosition
    elapsed.value = seconds
  }

  async function exportMidi() {
    if (!lastDrift || exporting.value) return
    exporting.value = true
    try {
      const d = lastDrift
      const score = scoreFor(VOICES[d.voiceId], d.plan, d.seed, { bpm: d.bpm })
      const bytes = await midiBytes(score, { voice: VOICES[d.voiceId].label, seed: d.seed, stops: d.stops, minutes: d.minutes })
      download(bytes, exportName(score, 'mid'), 'audio/midi')
      say(`MIDI file saved: ${score.key} ${score.modes.join(' to ')}.`)
    } catch {
      say('Sorry, the MIDI file could not be made.')
    } finally {
      exporting.value = false
    }
  }

  // The mode sounding now: the first waypoint's, moved by every ladder step made so far.
  const rungNow = computed(() => {
    if (!layout || !plan.value) return -1
    return plan.value.waypoints[0].rung + layout.flips.reduce((r, f) => (f.time <= elapsed.value ? r + f.dir : r), 0)
  })
  // Which label to mark: among the stages in this mode, the one nearest the travelling point.
  // While passing through a mode that is not a stop (a long walk), nothing is marked.
  const activeStage = computed(() => {
    if (!info.value) return -1
    let best = -1
    let gap = Infinity
    info.value.stages.forEach((st, i) => {
      if (st.rung !== rungNow.value) return
      const d = position.value < st.from ? st.from - position.value : position.value > st.to ? position.value - st.to : 0
      if (d < gap) {
        gap = d
        best = i
      }
    })
    return best
  })
  // between two stops a long walk passes through modes that have no label: say which
  const passing = computed(() =>
    drifting.value && info.value && activeStage.value < 0 && rungNow.value >= 0 ? `passing ${LADDER[rungNow.value]}` : '\u00a0'
  )
  watch(activeStage, (i, before) => {
    if (drifting.value && i >= 0 && i !== before && info.value) say(`Now in ${info.value.stages[i].mode}.`)
  })

  function finish(announce: string) {
    drifting.value = false
    // unmount after the audio has finished fading, or it is cut mid-fade
    audioTeardown = window.setTimeout(() => (audioActive.value = false), 3100)
    say(announce)
  }

  function stop() {
    playerRef.value?.stopDrift()
    reset()
    finish('The drift has ended.')
  }

  function onEnded() {
    finish('The drift has ended. You have arrived.')
  }

  const progress = computed(() =>
    drifting.value && Number.isFinite(totalSeconds.value)
      ? Math.min(1, Math.max(0, elapsed.value / totalSeconds.value))
      : null
  )

  // ── what the screen looks like ──────────────────────────────────────────────────────
  const IDLE = ['#5c6d7a', '#8e9ab8', '#e8d7f1']
  const palette = computed(() => {
    if (preview.value) return paletteAt(preview.value)
    if (points.value.length) return palettePath(points.value, position.value)
    return IDLE
  })

  // The background runs top to bottom through the palette's three colours, so each part of the
  // interface takes the ink that reads best over the colour behind it: the hint at the top, the
  // field in the middle, the ring at the bottom.
  const topInk = computed(() => inkFor(palette.value[0]))
  const midInk = computed(() => inkFor(palette.value[1]))
  const bottomInk = computed(() => inkFor(palette.value[2]))
  const vars = (i: { ink: string; contrast: string }) => ({ '--ink': i.ink, '--ink-contrast': i.contrast })

  const hint = computed(() => {
    if (info.value) return ''
    if (drifting.value) return ''
    if (!points.value.length) return 'touch where you are'
    if (points.value.length === 1) return 'now where you would like to be, or begin'
    if (points.value.length < MAX_POINTS) return 'add another stop, or begin'
    return ''
  })
</script>

<template>
  <main class="field-app" :style="vars(midInk)">
    <FieldBackground :palette="palette" />

    <div :style="vars(topInk)">
      <WordsFallback :points="points" :drifting="drifting" :max="MAX_POINTS" @set="setFromWords" />
    </div>

    <MoodField
      ref="fieldRef"
      :points="points"
      :travel="drifting ? position : null"
      :drifting="drifting"
      @choose="choose"
      @remove="remove"
      @clear="clear"
      @preview="preview = $event" />

    <p class="hint" :class="{ journey: !!info }" :style="vars(topInk)" aria-hidden="true">
      {{ hint }}
      <template v-if="info">
        {{ info.key }} ·
        <template v-for="(st, i) in info.stages" :key="i">
          <span class="mode" :class="{ on: i === activeStage }">{{ st.mode }}</span>
          <template v-if="i < info.stages.length - 1"> → </template>
        </template>
        <template v-if="info.bpm"> · {{ info.bpm }} BPM</template>
        <span class="seed">{{ info.seed }}</span>
        <span class="seed passing">{{ passing }}</span>
      </template>
    </p>

    <div :style="vars(bottomInk)">
      <button
        class="side left"
        type="button"
        :disabled="drifting || !points.length"
        @click="clear">
        clear
      </button>
      <JourneyRing
        v-model="minutes"
        :drifting="drifting"
        :can-begin="points.length > 0"
        :progress="progress"
        @begin="begin"
        @stop="stop" />
      <SoundPicker
        class="side right"
        :model-value="voiceId"
        :tempo="tempoFeel"
        :bpm="effectiveBpm"
        :custom-bpm="customBpm !== null"
        :disabled="drifting"
        @update:model-value="chooseVoice"
        @update:tempo="chooseTempo"
        @update:bpm="chooseBpm" />
      <ExportPicker class="side right low" :enabled="!!info" :busy="exporting" @midi="exportMidi" />
    </div>

    <GenerativePlayer
      v-if="audioActive"
      :key="session"
      ref="playerRef"
      :plan="plan"
      :seed="seed"
      :bpm="driftBpm"
      @progress="onProgress"
      @ended="onEnded" />

    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
  </main>
</template>

<style>
  /* Colours the interface can change smoothly as the field's colours change. */
  @property --ink {
    syntax: '<color>';
    inherits: true;
    initial-value: rgb(255, 255, 255);
  }
  @property --ink-contrast {
    syntax: '<color>';
    inherits: true;
    initial-value: rgb(24, 28, 40);
  }

  .field-app {
    transition: --ink 0.8s ease, --ink-contrast 0.8s ease;
    font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
    color: var(--ink);
  }

  .field-app .hint {
    position: fixed;
    left: 0;
    right: 0;
    top: calc(22px + env(safe-area-inset-top, 0px));
    margin: 0;
    text-align: center;
    font-size: 0.85rem;
    letter-spacing: 0.14em;
    color: var(--ink);
    opacity: 0.8;
    pointer-events: none;
    z-index: 1;
  }

  /* the journey readout is long: on a narrow screen it drops below the "words" button */
  .field-app .hint.journey {
    padding: 0 12px;
    box-sizing: border-box;
    text-wrap: balance;
  }
  @media (max-width: 640px) {
    .field-app .hint.journey {
      top: calc(70px + env(safe-area-inset-top, 0px));
    }
  }

  /* the two controls either side of the ring, level with its centre */
  .field-app .side {
    position: fixed;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
    z-index: 4;
  }
  .field-app .side.left {
    all: unset;
    box-sizing: border-box;
    position: fixed;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
    right: calc(50% + 100px);
    z-index: 4;
    min-height: 44px;
    min-width: 44px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    color: var(--ink);
    opacity: 0.75;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .field-app .side.left:hover:not(:disabled) {
    opacity: 1;
  }
  .field-app .side.left:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .field-app .side.left:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -4px;
    border-radius: 6px;
    opacity: 1;
  }
  .field-app .side.right {
    left: calc(50% + 100px);
  }
  /* export sits under sound */
  .field-app .side.low {
    bottom: calc(36px + env(safe-area-inset-bottom, 0px));
  }

  /* the mode sounding now is ringed; the others keep their full contrast, only unmarked */
  .field-app .hint .mode {
    display: inline-block;
    padding: 1px 9px;
    margin: 0 2px;
    border-radius: 999px;
    border: 1.5px solid transparent;
    transition: border-color 1.5s ease, background-color 1.5s ease;
  }
  .field-app .hint .mode.on {
    border-color: var(--ink);
    background: color-mix(in srgb, var(--ink) 14%, transparent);
  }

  .field-app .hint .seed.passing {
    margin-top: 0;
  }
  .field-app .hint .seed {
    display: block;
    margin-top: 2px;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }

  .field-app .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .field-app {
      transition: none;
    }
  }
</style>
