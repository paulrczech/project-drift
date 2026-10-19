<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
  import { LISTED_VOICES, VOICES, type TempoFeelName } from '../engine/voices'
  import KeyPicker from './KeyPicker.vue'
  import { VARIATIONS, type Variation } from '../engine/compose'
  import { BPM_MAX, BPM_MIN, DENSITIES, GRIDS, GRID_LABEL, GRID_NAME, clampBpm, type Density, type Grid } from '../engine/pulse'

  // "sound": a quiet word beside the ring that opens a short list of voices. Choosing one
  // applies to the next drift (the stops are the same: this only changes what plays them).

  const props = defineProps<{
    modelValue: string // the chosen voice's id
    tempo: TempoFeelName // slow / medium / fast, for the pulse
    bpm: number // the tempo in effect (from the feel, or typed)
    customBpm: boolean // an exact BPM was typed, so no feel is chosen
    grid: Grid // the pulse's steps per beat
    density: Density // how many of the pulse's weak steps sound
    variation: Variation // how much the music changes (every sound)
    root: number | null // the key chosen (0 = C … 11 = B), or null for a new one each drift
    disabled: boolean
  }>()

  const emit = defineEmits<{
    (e: 'update:modelValue', id: string): void
    (e: 'update:tempo', feel: TempoFeelName): void
    (e: 'update:bpm', bpm: number): void
    (e: 'update:grid', grid: Grid): void
    (e: 'update:density', density: Density): void
    (e: 'update:variation', variation: Variation): void
    (e: 'update:root', root: number | null): void
  }>()

  const FEELS: TempoFeelName[] = ['slow', 'medium', 'fast']
  const isPulse = () => VOICES[props.modelValue]?.style === 'pulse'
  // the tempo chips are one tab stop: the chosen feel, or the first when an exact BPM is set
  const feelStop = (f: TempoFeelName) => (props.customBpm ? f === FEELS[0] : f === props.tempo)

  function typedBpm(ev: Event) {
    const input = ev.target as HTMLInputElement
    const n = Number(input.value)
    if (Number.isFinite(n) && n > 0) {
      emit('update:bpm', n)
      input.value = String(clampBpm(n)) // show what was kept, even if the stored value did not change
    } else input.value = String(props.bpm)
  }
  function bpmKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hide()
    }
  }
  const feelRefs = ref<HTMLElement[]>([])
  const gridRefs = ref<HTMLElement[]>([])
  const densityRefs = ref<HTMLElement[]>([])
  const variationRefs = ref<HTMLElement[]>([])
  // the quarter grid has only the beats, so there is no density to choose
  const noDensity = () => props.grid === 1

  const open = ref(false)
  const wrap = ref<HTMLElement | null>(null)
  const toggle = ref<HTMLElement | null>(null)
  const items = ref<HTMLElement[]>([])

  const size = (mb: number) => (mb >= 5 ? `${Math.round(mb)} MB` : '')

  async function show() {
    if (props.disabled) return
    open.value = true
    await nextTick()
    // focus lands on the current choice, so a keyboard user hears where they are
    const at = Math.max(0, LISTED_VOICES.findIndex((v) => v.id === props.modelValue))
    items.value[at]?.focus()
  }

  function hide(returnFocus = true) {
    open.value = false
    if (returnFocus) toggle.value?.focus()
  }

  // choosing leaves the menu open (the tempo and key sit below the voices); the close button,
  // Escape, or a tap outside closes it
  function choose(id: string) {
    emit('update:modelValue', id)
  }

  async function onKey(ev: KeyboardEvent, i: number) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hide()
      return
    }
    const step = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    ev.preventDefault()
    items.value[(i + step + LISTED_VOICES.length) % LISTED_VOICES.length]?.focus()
  }

  // a row of chips (tempo, grid, density): arrows move and choose, as in any radio group
  async function onChipKey<T>(ev: KeyboardEvent, i: number, list: readonly T[], pick: (v: T) => void, refs: HTMLElement[]) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hide()
      return
    }
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    ev.preventDefault()
    const next = (i + step + list.length) % list.length
    pick(list[next])
    await nextTick()
    refs[next]?.focus()
  }

  // a tap or click anywhere else closes it
  function outside(ev: PointerEvent) {
    if (open.value && wrap.value && !wrap.value.contains(ev.target as Node)) hide(false)
  }
  onMounted(() => document.addEventListener('pointerdown', outside))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="wrap" class="sound">
    <button
      ref="toggle"
      class="toggle"
      type="button"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="sound-list"
      :disabled="disabled"
      @click="open ? hide(false) : show()">
      sound
    </button>

    <div v-show="open" id="sound-list" class="list wide">
      <button class="close" type="button" aria-label="Close sound menu" @click="hide()">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" />
        </svg>
      </button>
      <div class="voices" role="radiogroup" aria-label="Sound">
      <button
        v-for="(v, i) in LISTED_VOICES"
        :key="v.id"
        :ref="(el) => el && (items[i] = el as HTMLElement)"
        class="option"
        :class="{ on: v.id === modelValue }"
        role="radio"
        :aria-checked="v.id === modelValue"
        :aria-label="size(v.megabytes) ? `${v.label}, ${size(v.megabytes)} download` : v.label"
        :tabindex="v.id === modelValue ? 0 : -1"
        type="button"
        @click="choose(v.id)"
        @keydown="onKey($event, i)">
        <span class="mark" aria-hidden="true"></span>
        <span class="name">{{ v.label }}</span>
        <span v-if="size(v.megabytes)" class="mb">{{ size(v.megabytes) }}</span>
      </button>
      </div>
      <div class="tempo" role="radiogroup" :aria-label="isPulse() ? 'Tempo' : 'Tempo of exported files'">
        <span class="tempo-label" aria-hidden="true">tempo</span>
        <button
          v-for="(f, i) in FEELS"
          :key="f"
          :ref="(el) => el && (feelRefs[i] = el as HTMLElement)"
          class="chip"
          :class="{ on: !customBpm && f === tempo }"
          role="radio"
          :aria-checked="!customBpm && f === tempo"
          :tabindex="feelStop(f) ? 0 : -1"
          type="button"
          @click="emit('update:tempo', f)"
          @keydown="onChipKey($event, i, FEELS, (v) => emit('update:tempo', v), feelRefs)">
          {{ f }}
        </button>
        <label class="bpm">
          <input
            type="number"
            inputmode="numeric"
            :min="BPM_MIN"
            :max="BPM_MAX"
            step="1"
            :value="bpm"
            :aria-label="isPulse() ? 'Beats per minute' : 'Beats per minute of exported files'"
            @change="typedBpm"
            @keydown="bpmKey" />
          <span aria-hidden="true">BPM</span>
        </label>
      </div>
      <div v-if="isPulse()" class="tempo row" role="radiogroup" aria-label="Grid">
        <span class="tempo-label" aria-hidden="true">grid</span>
        <button
          v-for="(g, i) in GRIDS"
          :key="g"
          :ref="(el) => el && (gridRefs[i] = el as HTMLElement)"
          class="chip"
          :class="{ on: g === grid }"
          role="radio"
          :aria-checked="g === grid"
          :aria-label="GRID_NAME[g]"
          :tabindex="g === grid ? 0 : -1"
          type="button"
          @click="emit('update:grid', g)"
          @keydown="onChipKey($event, i, GRIDS, (v) => emit('update:grid', v), gridRefs)">
          {{ GRID_LABEL[g] }}
        </button>
      </div>
      <div v-if="isPulse()" class="tempo row" role="radiogroup" aria-label="Notes">
        <span class="tempo-label" aria-hidden="true">notes</span>
        <button
          v-for="(d, i) in DENSITIES"
          :key="d"
          :ref="(el) => el && (densityRefs[i] = el as HTMLElement)"
          class="chip"
          :class="{ on: d === density }"
          role="radio"
          :aria-checked="d === density"
          :tabindex="d === density ? 0 : -1"
          :disabled="noDensity()"
          type="button"
          @click="emit('update:density', d)"
          @keydown="onChipKey($event, i, DENSITIES, (v) => emit('update:density', v), densityRefs)">
          {{ d }}
        </button>
      </div>
      <div class="tempo row" role="radiogroup" aria-label="Variation: how much the music changes">
        <span class="tempo-label" aria-hidden="true">change</span>
        <button
          v-for="(x, i) in VARIATIONS"
          :key="x"
          :ref="(el) => el && (variationRefs[i] = el as HTMLElement)"
          class="chip"
          :class="{ on: x === variation }"
          role="radio"
          :aria-checked="x === variation"
          :tabindex="x === variation ? 0 : -1"
          type="button"
          @click="emit('update:variation', x)"
          @keydown="onChipKey($event, i, VARIATIONS, (v) => emit('update:variation', v), variationRefs)">
          {{ x }}
        </button>
      </div>
      <div class="tempo keyrow">
        <label class="tempo-label" for="drift-key">key</label>
        <KeyPicker id="drift-key" :model-value="root" neutral="auto" label="Key" @update:model-value="emit('update:root', $event)" @keydown="bpmKey" />
      </div>
    </div>
  </div>
</template>

<style scoped>
  .sound {
    position: relative;
    color: var(--ink);
  }

  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:disabled {
    cursor: default;
    opacity: 0.35;
  }

  .toggle {
    min-height: 44px;
    min-width: 44px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    opacity: 0.75;
  }
  .toggle:hover:not(:disabled),
  .toggle[aria-expanded='true'] {
    opacity: 1;
  }
  .toggle:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -4px;
    border-radius: 6px;
    opacity: 1;
  }

  .list {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    display: grid;
    min-width: 168px;
    max-width: calc(100vw - 24px);
    padding: 6px;
    border-radius: 14px;
    /* always the dark theme, whatever colours lie behind it */
    --ink: #f2f2f7;
    --ink-contrast: #15171f;
    background: rgba(21, 23, 31, 0.94);
    color: var(--ink);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .list.wide {
    min-width: min(330px, calc(100vw - 24px));
  }

  .close {
    justify-self: end;
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    margin-bottom: -6px;
  }
  .close:hover {
    background: color-mix(in srgb, var(--ink) 12%, transparent);
  }
  .close:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }

  .voices {
    display: grid;
  }

  .option {
    min-height: 44px;
    padding: 0 12px;
    display: grid;
    grid-template-columns: 14px 1fr auto;
    align-items: center;
    gap: 10px;
    border-radius: 10px;
    font-size: 0.85rem;
    letter-spacing: 0.06em;
  }
  .option:hover {
    background: color-mix(in srgb, var(--ink) 12%, transparent);
  }
  .option:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }

  .name {
    text-align: left;
  }

  .tempo {
    display: flex;
    flex-wrap: wrap; /* only on a very narrow screen; otherwise one row */
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    padding: 16px 8px 6px;
    border-top: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
  }
  .tempo-label {
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    /* one width for every row's label, so the controls beside them line up */
    flex: none;
    width: 3.4rem;
    text-align: left;
  }
  .chip {
    min-height: 44px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    border-radius: 10px;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    border: 1.5px solid color-mix(in srgb, var(--ink) 40%, transparent);
  }
  .chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--ink-contrast);
  }
  .bpm {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: auto;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
  }
  .bpm input {
    all: unset;
    box-sizing: border-box;
    width: 48px;
    min-height: 44px;
    padding: 0 4px;
    text-align: center;
    font-size: 0.85rem;
    color: var(--ink);
    border: 1.5px solid color-mix(in srgb, var(--ink) 40%, transparent);
    border-radius: 10px;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .bpm input::-webkit-outer-spin-button,
  .bpm input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .bpm input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .row {
    margin-top: 0;
    padding-top: 0;
    border-top: 0;
  }
  .keyrow {
    margin-top: 12px;
    border-top: 0;
    padding: 0 8px 14px;
  }
  .chip:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  .mark {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--ink);
  }
  .option.on .mark {
    background: var(--ink);
  }
  /* dim by size, not by transparency: faded text fails contrast */
  .mb {
    font-size: 0.68rem;
  }
</style>
