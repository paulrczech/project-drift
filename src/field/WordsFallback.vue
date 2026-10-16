<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { EMOTIONS, type Point } from './moodPlane'

  // The fallback: the 21 words as two plain dropdowns. Anything the field can do by
  // touch, pointer or arrow key, this can do with a screen reader, a switch or a
  // keyboard that prefers lists.

  const props = defineProps<{
    points: Point[]
    drifting: boolean
  }>()

  const emit = defineEmits<{
    (e: 'set', index: 0 | 1, point: Point | null): void
  }>()

  const open = ref(false)
  const sorted = [...EMOTIONS].sort((a, b) => a.label.localeCompare(b.label))

  // a free-placed point has no word of its own
  const labelOf = (p: Point | undefined) =>
    p ? EMOTIONS.find((e) => e.v === p.v && e.a === p.a)?.label ?? '' : ''
  const from = computed(() => labelOf(props.points[0]))
  const to = computed(() => labelOf(props.points[1]))

  function pick(index: 0 | 1, ev: Event) {
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
      <label>
        <span>where you are</span>
        <select :value="from" :disabled="drifting" @change="pick(0, $event)">
          <option value="">{{ points[0] && !from ? 'a place on the field' : 'choose…' }}</option>
          <option v-for="e in sorted" :key="e.label" :value="e.label">{{ e.label }}</option>
        </select>
      </label>
      <label>
        <span>where you would like to be (optional)</span>
        <select :value="to" :disabled="drifting || !points[0]" @change="pick(1, $event)">
          <option value="">{{ points[1] && !to ? 'a place on the field' : 'stay here' }}</option>
          <option v-for="e in sorted" :key="e.label" :value="e.label">{{ e.label }}</option>
        </select>
      </label>
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
    background: color-mix(in srgb, var(--ink-contrast) 90%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
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
