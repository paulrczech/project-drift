<script setup lang="ts">
  import { computed, nextTick, ref } from 'vue'

  // The ring: five stops around a centre button. Choosing one sets how long the whole
  // drift lasts (∞ never ends). The centre begins the drift; once it is under way the
  // stops fall away, the centre becomes "end", and the ring fills as time passes.

  const LENGTHS = [1, 5, 10, 20, Infinity]

  const props = defineProps<{
    modelValue: number // minutes; Infinity for no end
    drifting: boolean
    canBegin: boolean
    progress: number | null // 0..1 while a finite drift runs, else null
  }>()

  const emit = defineEmits<{
    (e: 'update:modelValue', minutes: number): void
    (e: 'begin'): void
    (e: 'stop'): void
  }>()

  const R = 66 // radius of the ring, px
  const SIZE = 176
  const C = SIZE / 2
  const place = (i: number) => {
    const angle = (-90 + i * (360 / LENGTHS.length)) * (Math.PI / 180)
    return { left: `${C + R * Math.cos(angle)}px`, top: `${C + R * Math.sin(angle)}px` }
  }

  const name = (m: number) => (m === Infinity ? 'no end' : m === 1 ? '1 minute' : `${m} minutes`)
  const caption = computed(() => (props.modelValue === Infinity ? 'no end' : `${props.modelValue} min`))
  const chipRefs = ref<HTMLElement[]>([])

  async function onKey(ev: KeyboardEvent, i: number) {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    ev.preventDefault()
    const next = (i + step + LENGTHS.length) % LENGTHS.length
    emit('update:modelValue', LENGTHS[next])
    await nextTick()
    chipRefs.value[next]?.focus()
  }

  const circumference = 2 * Math.PI * R
  const dash = computed(() => `${(props.progress ?? 0) * circumference} ${circumference}`)
</script>

<template>
  <div class="ring" :style="{ width: `${SIZE}px`, height: `${SIZE}px` }">
    <svg class="track" :viewBox="`0 0 ${SIZE} ${SIZE}`" aria-hidden="true">
      <circle :cx="C" :cy="C" :r="R" class="base" />
      <circle
        v-if="drifting && progress !== null"
        :cx="C"
        :cy="C"
        :r="R"
        class="fill"
        :stroke-dasharray="dash" />
    </svg>

    <div
      class="stops"
      :class="{ gone: drifting }"
      role="radiogroup"
      aria-label="How long the drift lasts">
      <button
        v-for="(m, i) in LENGTHS"
        :key="m"
        :ref="(el) => el && (chipRefs[i] = el as HTMLElement)"
        class="stop"
        :class="{ on: m === modelValue }"
        :style="place(i)"
        role="radio"
        :aria-checked="m === modelValue"
        :aria-label="name(m)"
        :tabindex="m === modelValue && !drifting ? 0 : -1"
        :disabled="drifting"
        type="button"
        @click="emit('update:modelValue', m)"
        @keydown="onKey($event, i)">
        <span>{{ m === Infinity ? '∞' : m }}</span>
      </button>
    </div>

    <button
      class="centre"
      :disabled="!drifting && !canBegin"
      :aria-label="drifting ? 'End drift' : 'Begin drift'"
      type="button"
      @click="drifting ? emit('stop') : emit('begin')">
      <span :class="drifting ? 'glyph-stop' : 'glyph-play'"></span>
    </button>

    <p class="caption" aria-hidden="true">{{ drifting ? '' : caption }}</p>
  </div>
</template>

<style scoped>
  .ring {
    position: fixed;
    left: 50%;
    bottom: calc(14px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: 3;
  }

  .track {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    transform: rotate(-90deg);
  }
  .track circle {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  .track .base {
    stroke-opacity: 0.28;
  }
  .track .fill {
    stroke-opacity: 0.9;
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dasharray 0.4s linear;
  }

  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:disabled {
    cursor: default;
  }

  .stops {
    position: absolute;
    inset: 0;
    transition: opacity 1.2s ease;
  }
  .stops.gone {
    opacity: 0;
    pointer-events: none;
  }

  .stop {
    position: absolute;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    display: grid;
    place-items: center;
  }
  .stop span {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--ink) 55%, transparent);
    color: var(--ink);
    font-size: 0.78rem;
    transition: background-color 0.25s ease, border-color 0.25s ease;
  }
  .stop:hover span {
    border-color: var(--ink);
  }
  .stop.on span {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--ink-contrast);
  }
  .stop:focus-visible span {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  .centre {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 60px;
    height: 60px;
    margin: -30px 0 0 -30px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    display: grid;
    place-items: center;
    transition: opacity 0.3s ease, transform 0.2s ease;
  }
  .centre:hover:not(:disabled) {
    transform: scale(1.06);
  }
  .centre:disabled {
    opacity: 0.35;
  }
  .centre:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 5px;
  }
  .glyph-play {
    width: 0;
    height: 0;
    margin-left: 4px;
    border-left: 16px solid var(--ink);
    border-top: 10px solid transparent;
    border-bottom: 10px solid transparent;
  }
  .glyph-stop {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: var(--ink);
  }

  .caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -4px;
    margin: 0;
    text-align: center;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    color: var(--ink);
    opacity: 0.75;
  }

  @media (prefers-reduced-motion: reduce) {
    .stops,
    .stop span,
    .centre,
    .track .fill {
      transition: none;
    }
  }
</style>
