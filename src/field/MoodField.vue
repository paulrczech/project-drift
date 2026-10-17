<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
  import {
    EMOTIONS,
    describe,
    neighbour,
    snap,
    type Emotion,
    type Point,
  } from './moodPlane'

  // The mood field: valence runs left → right, arousal bottom → top. The 21 words are
  // dots on it. Mouse, touch and pen all go through pointer events; the keyboard moves
  // between dots with the arrow keys (the field is a single tab stop) and chooses with
  // Enter or Space. The first thing chosen is where you are; the second, where you would
  // like to be.

  const props = defineProps<{
    points: Point[] // chosen so far (0–2)
    travel: number | null // fractional position along `points` while drifting, else null
    drifting: boolean
  }>()

  const emit = defineEmits<{
    (e: 'choose', point: Point): void
    (e: 'remove', index: number): void
    (e: 'clear'): void
    (e: 'preview', point: Point | null): void
  }>()

  const plane = ref<HTMLElement | null>(null)
  const dotRefs = new Map<string, HTMLElement>()

  // ── where things sit ────────────────────────────────────────────────────────────────
  const pos = (p: Point) => ({ left: `${p.v * 100}%`, top: `${(1 - p.a) * 100}%` })

  function toPlane(e: PointerEvent): Point {
    const r = plane.value!.getBoundingClientRect()
    return {
      v: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      a: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    }
  }

  const labelFor = describe
  const isChosen = (e: Emotion) => props.points.some((p) => p.v === e.v && p.a === e.a)

  // ── how visible the dots are ────────────────────────────────────────────────────────
  // They start fully present, fade as you settle in, and come back whenever you touch,
  // hover or focus the field.
  const active = ref(false)
  let quiet = 0
  function wake() {
    active.value = true
    clearTimeout(quiet)
    quiet = window.setTimeout(() => (active.value = false), 4000)
  }
  onBeforeUnmount(() => clearTimeout(quiet))

  const dotOpacity = computed(() => {
    if (active.value) return 0.9
    if (props.drifting) return 0.1
    return props.points.length ? 0.3 : 0.8
  })

  // ── pointer: tap, click or drag anywhere ────────────────────────────────────────────
  const dragging = ref<Point | null>(null)
  const hovered = ref<Emotion | null>(null)

  function down(e: PointerEvent) {
    if (props.drifting || (e.target as HTMLElement).closest('button')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragging.value = toPlane(e)
    emit('preview', dragging.value)
    wake()
  }
  function move(e: PointerEvent) {
    if (dragging.value) {
      dragging.value = toPlane(e)
      emit('preview', dragging.value)
      wake()
    }
  }
  function up(e: PointerEvent) {
    if (!dragging.value) return
    const at = toPlane(e)
    dragging.value = null
    emit('preview', null)
    emit('choose', snap(at))
  }
  function cancel() {
    dragging.value = null
    emit('preview', null)
  }

  // ── dots: hover, focus, click, keys ─────────────────────────────────────────────────
  const focusLabel = ref('neutral') // the one dot in the tab order
  const focused = ref<Emotion | null>(null)

  function previewDot(e: Emotion | null) {
    if (!dragging.value) emit('preview', e ? { v: e.v, a: e.a } : null)
  }
  function enter(e: Emotion, ev: PointerEvent) {
    if (ev.pointerType !== 'mouse') return
    hovered.value = e
    previewDot(e)
    wake()
  }
  function leave() {
    hovered.value = null
    if (!focused.value) previewDot(null)
  }
  function onFocus(e: Emotion, ev: FocusEvent) {
    focused.value = e
    focusLabel.value = e.label
    // Only the keyboard previews on focus: a tap leaves its dot focused, and that must
    // not keep repainting the screen in that word's colours.
    if ((ev.target as HTMLElement).matches(':focus-visible')) {
      previewDot(e)
      wake()
    }
  }
  function onBlur() {
    focused.value = null
    if (!hovered.value) previewDot(null)
  }
  // Choosing the word that is the last stop takes it away again (it is a toggle button);
  // choosing a word that is an earlier stop adds it again, so a journey can return home.
  function choose(e: Emotion) {
    if (props.drifting) return
    const last = props.points[props.points.length - 1]
    if (last && last.v === e.v && last.a === e.a) emit('remove', props.points.length - 1)
    else emit('choose', { v: e.v, a: e.a })
  }

  // Put the keyboard back in the field (after "clear", say): on the dot that is in the tab order.
  function focus() {
    dotRefs.get(focusLabel.value)?.focus()
  }
  defineExpose({ focus })

  const KEYS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  }
  async function key(ev: KeyboardEvent, from: Emotion) {
    if (ev.key === 'Escape') {
      emit('clear')
      return
    }
    const dir = KEYS[ev.key]
    if (!dir) return
    ev.preventDefault()
    const next = neighbour(from, dir)
    if (!next) return
    focusLabel.value = next.label
    await nextTick()
    dotRefs.get(next.label)?.focus()
  }

  // ── the journey ─────────────────────────────────────────────────────────────────────
  const traveller = computed<Point | null>(() => {
    if (props.travel === null || props.points.length < 2) return null
    const i = Math.min(props.points.length - 2, Math.max(0, Math.floor(props.travel)))
    const t = Math.min(1, Math.max(0, props.travel - i))
    const a = props.points[i]
    const b = props.points[i + 1]
    return { v: a.v + (b.v - a.v) * t, a: a.a + (b.a - a.a) * t }
  })
  // "where you are", then each stop, the last being where you would like to be
  const markerName = (i: number) =>
    i === 0
      ? 'where you are'
      : i === props.points.length - 1
        ? `stop ${i + 1}, where you would like to be`
        : `stop ${i + 1}`
</script>

<template>
  <div
    class="field"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="cancel">
    <div ref="plane" class="plane" role="group" aria-label="Mood field">
      <svg
        v-if="points.length >= 2"
        class="path"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true">
        <polyline :points="points.map((p) => `${p.v * 100},${(1 - p.a) * 100}`).join(' ')" />
      </svg>

      <button
        v-for="e in EMOTIONS"
        :key="e.label"
        :ref="(el) => el && dotRefs.set(e.label, el as HTMLElement)"
        class="dot"
        :class="{ chosen: isChosen(e), show: hovered === e || focused === e }"
        :style="{ ...pos(e), '--dots': dotOpacity }"
        :tabindex="e.label === focusLabel ? 0 : -1"
        :aria-label="e.label"
        :aria-pressed="isChosen(e)"
        :disabled="drifting"
        type="button"
        @click="choose(e)"
        @pointerenter="enter(e, $event)"
        @pointerleave="leave"
        @focus="onFocus(e, $event)"
        @blur="onBlur"
        @keydown="key($event, e)">
        <span class="core"></span>
        <span class="word">{{ e.label }}</span>
      </button>

      <button
        v-for="(p, i) in points"
        :key="`marker-${i}`"
        class="marker"
        :class="{ destination: points.length > 1 && i === points.length - 1 }"
        :style="pos(p)"
        :aria-label="`${markerName(i)}: ${labelFor(p)}. Press to remove.`"
        :disabled="drifting"
        tabindex="-1"
        type="button"
        @click="emit('remove', i)">
        <span class="ring"><span class="num">{{ i + 1 }}</span></span>
        <span class="word">{{ labelFor(p) }}</span>
      </button>

      <div v-if="traveller" class="traveller" :style="pos(traveller)" aria-hidden="true"></div>

      <div v-if="dragging" class="ghost" :style="pos(dragging)" aria-hidden="true">
        <span class="ring"></span>
        <span class="word">{{ labelFor(dragging) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .field {
    position: fixed;
    inset: 0;
    touch-action: none; /* a finger here chooses a mood, it does not scroll the page */
    user-select: none;
    -webkit-user-select: none;
    cursor: crosshair;
  }

  /* The plane leaves room underneath for the ring. */
  .plane {
    position: absolute;
    left: 8%;
    right: 8%;
    top: 7%;
    bottom: 30%;
  }

  button {
    all: unset;
    position: absolute;
    box-sizing: border-box;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px; /* centre the 44px hit area on the point */
    display: grid;
    place-items: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:disabled {
    cursor: default;
  }

  .core {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--ink);
    opacity: var(--dots);
    transition: opacity 6s ease-in-out, transform 0.3s ease;
  }
  .dot:hover .core,
  .dot:focus-visible .core,
  .dot.show .core {
    transition-duration: 0.25s, 0.3s;
    opacity: 1;
    transform: scale(1.5);
  }
  .dot:focus-visible::after {
    content: '';
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    border: 2px solid var(--ink);
  }
  .dot.chosen .core {
    opacity: 0;
  }

  .word {
    position: absolute;
    left: 50%;
    bottom: calc(100% - 6px);
    transform: translateX(-50%);
    white-space: nowrap;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    color: var(--ink);
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
  }
  .dot:hover .word,
  .dot:focus-visible .word,
  .dot.show .word,
  .marker .word,
  .ghost .word {
    opacity: 0.9;
  }

  .marker .ring,
  .ghost .ring {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid var(--ink);
    position: relative;
  }
  .marker .ring {
    display: grid;
    place-items: center;
  }
  .num {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--ink);
    line-height: 1;
  }
  .marker.destination .ring {
    border-style: dashed;
  }
  .marker:focus-visible .ring {
    outline: 2px solid var(--ink);
    outline-offset: 4px;
  }

  .ghost {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .ghost .ring {
    position: absolute;
    left: -12px;
    top: -12px;
    opacity: 0.8;
  }
  .ghost .word {
    bottom: 34px; /* above the finger, not under it */
  }

  .path {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .path polyline {
    fill: none;
    stroke: var(--ink);
    stroke-opacity: 0.45;
    stroke-width: 1.5;
    stroke-dasharray: 2 7;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .traveller {
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: var(--ink);
    pointer-events: none;
    transition: left 0.3s linear, top 0.3s linear;
  }

  @media (prefers-reduced-motion: reduce) {
    .core {
      transition: none;
    }
    .traveller {
      transition: none;
    }
  }
</style>
