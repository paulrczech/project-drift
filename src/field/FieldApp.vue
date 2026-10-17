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
    inkFor,
    type Point,
  } from './moodPlane'
  import { rungFor } from '../engine/moods'
  import { layoutTimeline, type TimelinePlan } from '../engine/compose'

  import { preloadVoice, voiceFromLocation } from '../engine/voices'

  // Tone.js is large and only needed once a drift starts, so the player loads on demand —
  // and, with the samples, is fetched ahead of time as soon as someone chooses a first stop.
  const loadPlayer = () => import('../components/GenerativePlayer.vue')
  const GenerativePlayer = defineAsyncComponent(loadPlayer)
  function warmUp() {
    loadPlayer()
    preloadVoice(voiceFromLocation())
  }

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

  function clear() {
    if (drifting.value) return
    reset()
    points.value = []
    say('Cleared.')
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
    session.value++
    audioActive.value = true
    drifting.value = true
    preview.value = null
    const words = points.value.map(wordFor)
    const route =
      words.length === 1
        ? `in ${words[0]}`
        : `from ${words[0]}${words.length > 2 ? ` through ${words.slice(1, -1).join(', ')}` : ''} to ${words[words.length - 1]}`
    say(`Drifting ${route} ${lengthName(minutes.value)}.`)
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

  // The background runs top to bottom through the palette's three colours, so each part of the
  // interface takes the ink that reads best over the colour behind it: the hint at the top, the
  // field in the middle, the ring at the bottom.
  const topInk = computed(() => inkFor(palette.value[0]))
  const midInk = computed(() => inkFor(palette.value[1]))
  const bottomInk = computed(() => inkFor(palette.value[2]))
  const vars = (i: { ink: string; contrast: string }) => ({ '--ink': i.ink, '--ink-contrast': i.contrast })

  const hint = computed(() => {
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
      :points="points"
      :travel="drifting ? position : null"
      :drifting="drifting"
      @choose="choose"
      @remove="remove"
      @clear="clear"
      @preview="preview = $event" />

    <p class="hint" :style="vars(topInk)" aria-hidden="true">{{ hint }}</p>

    <div :style="vars(bottomInk)">
      <JourneyRing
        v-model="minutes"
        :drifting="drifting"
        :can-begin="points.length > 0"
        :progress="progress"
        @begin="begin"
        @stop="stop" />
    </div>

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
