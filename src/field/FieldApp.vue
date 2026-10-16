<script setup lang="ts">
  import { computed, defineAsyncComponent, ref } from 'vue'
  import FieldBackground from './FieldBackground.vue'
  import MoodField from './MoodField.vue'
  import JourneyRing from './JourneyRing.vue'
  import WordsFallback from './WordsFallback.vue'
  import {
    describe,
    paletteAt,
    palettePath,
    lightness,
    type Point,
  } from './moodPlane'
  import { rungFor } from '../engine/moods'
  import { layoutTimeline, type TimelinePlan } from '../engine/compose'

  // Tone.js is large and only needed once a drift starts, so the player loads on demand.
  const GenerativePlayer = defineAsyncComponent(
    () => import('../components/GenerativePlayer.vue')
  )

  // ── state ───────────────────────────────────────────────────────────────────────────
  // `points` is the journey, in order (the interface offers one or two; nothing below
  // assumes two). `position` is the fractional index along it, driven by the audio clock.
  const points = ref<Point[]>([])
  const preview = ref<Point | null>(null)
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

  const announcement = ref('')
  const say = (text: string) => (announcement.value = text)

  const wordFor = describe
  const lengthName = (m: number) =>
    m === Infinity ? 'with no end' : m === 1 ? 'for 1 minute' : `for ${m} minutes`

  // ── choosing ────────────────────────────────────────────────────────────────────────
  function reset() {
    position.value = 0
    elapsed.value = 0
  }

  function choose(p: Point) {
    if (drifting.value) return
    reset()
    if (points.value.length === 0) {
      points.value = [p]
      say(`Where you are: ${wordFor(p)}. Choose where you would like to be, or begin.`)
    } else {
      points.value = [points.value[0], p]
      say(`Where you would like to be: ${wordFor(p)}. Begin when you are ready.`)
    }
  }

  function remove(i: number) {
    if (drifting.value) return
    reset()
    const gone = points.value[i]
    points.value = points.value.filter((_, k) => k !== i)
    say(`Removed ${wordFor(gone)}.`)
  }

  function clear() {
    if (drifting.value) return
    reset()
    points.value = []
    say('Cleared.')
  }

  // the word lists: set one end of the journey, or take it away
  function setFromWords(index: 0 | 1, p: Point | null) {
    if (drifting.value) return
    reset()
    if (index === 0) {
      points.value = p ? [p, ...points.value.slice(1)] : []
    } else {
      points.value = p ? [points.value[0], p] : points.value.slice(0, 1)
    }
    say(p ? `${index === 0 ? 'Where you are' : 'Where you would like to be'}: ${wordFor(p)}.` : 'Cleared.')
  }

  // ── a drift ─────────────────────────────────────────────────────────────────────────
  // Length is for the whole drift: a fifth or so settled where you are, over half of it
  // travelling, the rest arriving and fading out. ∞ travels over ten minutes, then stays.
  function planFor(pts: Point[], m: number) {
    const endless = m === Infinity
    const total = (endless ? 10 : m) * 60
    const moods = pts.map((p) => ({ rung: rungFor(p.v), arousal: p.a }))
    if (moods.length === 1)
      return { waypoints: [{ ...moods[0], hold: endless ? Infinity : total }], walk: 0 }
    return {
      waypoints: moods.map((mood, i) => ({
        ...mood,
        hold: i === 0 ? total * 0.15 : endless ? Infinity : total * 0.3,
      })),
      walk: (total * 0.55) / (moods.length - 1),
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
    session.value++
    audioActive.value = true
    drifting.value = true
    preview.value = null
    const words = points.value.map(wordFor)
    say(
      `Drifting ${words.length > 1 ? `from ${words[0]} to ${words[1]}` : `in ${words[0]}`} ${lengthName(minutes.value)}.`
    )
  }

  function onProgress(newPosition: number, _text: number, seconds: number) {
    position.value = newPosition
    elapsed.value = seconds
  }

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

  // Ink is dark on light colours and light on dark ones, so the interface stays legible
  // wherever on the field you are.
  const light = computed(
    () => palette.value.reduce((sum, hex) => sum + lightness(hex), 0) / palette.value.length > 0.7
  )
  const ink = computed(() => (light.value ? 'rgb(24, 28, 40)' : 'rgb(255, 255, 255)'))
  const inkContrast = computed(() => (light.value ? 'rgb(255, 255, 255)' : 'rgb(24, 28, 40)'))

  const hint = computed(() => {
    if (drifting.value) return ''
    if (!points.value.length) return 'touch where you are'
    if (points.value.length === 1) return 'now where you would like to be, or begin'
    return ''
  })
</script>

<template>
  <main class="field-app" :style="{ '--ink': ink, '--ink-contrast': inkContrast }">
    <FieldBackground :palette="palette" />

    <WordsFallback :points="points" :drifting="drifting" @set="setFromWords" />

    <MoodField
      :points="points"
      :travel="drifting ? position : null"
      :drifting="drifting"
      @choose="choose"
      @remove="remove"
      @clear="clear"
      @preview="preview = $event" />

    <p class="hint" aria-hidden="true">{{ hint }}</p>

    <JourneyRing
      v-model="minutes"
      :drifting="drifting"
      :can-begin="points.length > 0"
      :progress="progress"
      @begin="begin"
      @stop="stop" />

    <GenerativePlayer
      v-if="audioActive"
      :key="session"
      ref="playerRef"
      :plan="plan"
      :seed="seed"
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
