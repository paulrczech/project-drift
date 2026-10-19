<script setup lang="ts">
  import { ref } from 'vue'
  import { EMOTIONS, type Point } from './moodPlane'
  import KeyPicker from './KeyPicker.vue'
  import ChoicePicker from './ChoicePicker.vue'
  import { DENSITIES, GRIDS, GRID_LABEL, type Density, type Grid } from '../engine/pulse'

  // The fallback: the 21 words as plain dropdowns, one per stop of the journey, plus one more
  // to add the next stop. Anything the field can do by touch, pointer or arrow key, this can do
  // with a screen reader, a switch or a keyboard that prefers lists.

  const props = defineProps<{
    points: Point[]
    keys: (number | null)[] // each stop's key (the first: auto; later: null = the same as before)
    grids: (Grid | null)[] // each stop's pulse grid (the first: the sound menu's; later: null = the same as before)
    densities: (Density | null)[]
    pulse: boolean // the sound is the pulse, so grid and density apply
    drifting: boolean
    max: number
  }>()

  const emit = defineEmits<{
    (e: 'set', index: number, point: Point | null): void
    (e: 'key', index: number, key: number | null): void
    (e: 'grid', index: number, grid: Grid | null): void
    (e: 'density', index: number, density: Density | null): void
  }>()

  const open = ref(false)
  const sorted = [...EMOTIONS].sort((a, b) => a.label.localeCompare(b.label))

  // a free-placed point has no word of its own
  const labelOf = (p: Point | undefined) =>
    p ? EMOTIONS.find((e) => e.v === p.v && e.a === p.a)?.label ?? '' : ''

  // one dropdown per stop, and an empty one to add the next while there is room
  const slots = () => {
    const n = props.points.length
    return Array.from({ length: Math.min(props.max, Math.max(1, n + 1)) }, (_, i) => i)
  }
  const caption = (i: number) =>
    i === 0 ? 'where you are' : i < props.points.length ? `then (stop ${i + 1})` : 'then (optional)'

  function pick(index: number, ev: Event) {
    const label = (ev.target as HTMLSelectElement).value
    const e = EMOTIONS.find((x) => x.label === label)
    emit('set', index, e ? { v: e.v, a: e.a } : null)
  }
</script>

<template>
  <div class="words">
    <button
      class="toggle"
      type="button"
      :aria-expanded="open"
      aria-controls="words-panel"
      @click="open = !open">
      words
    </button>

    <div v-show="open" id="words-panel" class="panel">
      <div v-for="i in slots()" :key="i" class="stop" :class="{ feel: pulse && points[i] }">
        <label>
          <span>{{ caption(i) }}</span>
          <select
            :value="labelOf(points[i])"
            :disabled="drifting || (i > 0 && !points[i - 1])"
            @change="pick(i, $event)">
            <option value="">
              {{ points[i] && !labelOf(points[i]) ? 'a place on the field' : i === 0 ? 'choose…' : i < points.length ? 'remove this stop' : 'stay here' }}
            </option>
            <option v-for="e in sorted" :key="e.label" :value="e.label">{{ e.label }}</option>
          </select>
        </label>
        <KeyPicker
          v-if="points[i]"
          class="stop-key"
          :model-value="keys[i] ?? null"
          :neutral="i === 0 ? 'auto' : 'same'"
          :label="`Key for ${i === 0 ? 'where you are' : 'stop ' + (i + 1)}`"
          :disabled="drifting"
          @update:model-value="emit('key', i, $event)" />
        <template v-if="pulse && points[i]">
          <ChoicePicker
            class="stop-key"
            :model-value="grids[i] === null || grids[i] === undefined ? null : String(grids[i])"
            :options="GRIDS.map((g) => ({ value: String(g), label: GRID_LABEL[g] }))"
            :neutral="i === 0 ? undefined : 'same'"
            :label="`Grid for ${i === 0 ? 'where you are' : 'stop ' + (i + 1)}`"
            :disabled="drifting"
            @update:model-value="emit('grid', i, $event === null ? null : (Number($event) as Grid))" />
          <ChoicePicker
            class="stop-key"
            :model-value="densities[i] ?? null"
            :options="DENSITIES.map((d) => ({ value: d, label: d }))"
            :neutral="i === 0 ? undefined : 'same'"
            :label="`Notes for ${i === 0 ? 'where you are' : 'stop ' + (i + 1)}`"
            :disabled="drifting"
            @update:model-value="emit('density', i, $event as Density | null)" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .words {
    position: fixed;
    left: calc(14px + env(safe-area-inset-left, 0px));
    top: calc(12px + env(safe-area-inset-top, 0px));
    z-index: 4;
    font-size: 0.8rem;
    color: var(--ink);
  }

  .toggle {
    all: unset;
    box-sizing: border-box;
    min-height: 44px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    letter-spacing: 0.1em;
    opacity: 0.75;
    -webkit-tap-highlight-color: transparent;
  }
  .toggle:hover {
    opacity: 1;
  }
  .toggle:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -4px;
    border-radius: 6px;
    opacity: 1;
  }

  .panel {
    display: grid;
    gap: 12px;
    padding: 14px;
    max-width: min(320px, calc(100vw - 28px));
    border-radius: 14px;
    /* always the dark theme, whatever colours lie behind it */
    --ink: #f2f2f7;
    --ink-contrast: #15171f;
    background: rgba(21, 23, 31, 0.94);
    color: var(--ink);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .stop {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
  }
  .stop label {
    flex: 1;
    min-width: 0;
  }
  .stop-key {
    flex: none;
    min-width: 84px;
  }
  /* with the pulse's grid and density there are four controls: the word on its own row, the rest beneath */
  .stop.feel label {
    flex-basis: 100%;
  }
  .stop.feel .stop-key {
    flex: 1 1 0;
    min-width: 0;
  }
  label {
    display: grid;
    gap: 4px;
  }
  label span {
    opacity: 0.85;
    letter-spacing: 0.05em;
  }
  select {
    min-height: 44px;
    padding: 0 10px;
    font: inherit;
    font-size: 0.9rem;
    color: var(--ink);
    background: color-mix(in srgb, var(--ink-contrast) 70%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 45%, transparent);
    border-radius: 10px;
  }
  /* the open list is drawn by the OS on a plain background */
  select option {
    color: #111;
    background: #fff;
  }
  select:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  select:disabled {
    opacity: 0.5;
  }
</style>
