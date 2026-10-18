<script setup lang="ts">
  import { NOTE_NAMES } from '../engine/score'

  // A key chooser: a native select (a phone shows its own picker). `neutral` is what no choice
  // means: "auto" for the journey's first key (a new one each drift), "same" for a later stop
  // (the key of the stop before).

  defineProps<{
    modelValue: number | null
    neutral: string
    label: string // the accessible name
    id?: string
    disabled?: boolean
  }>()
  const emit = defineEmits<{ (e: 'update:modelValue', key: number | null): void }>()

  function change(ev: Event) {
    const v = (ev.target as HTMLSelectElement).value
    emit('update:modelValue', v === 'neutral' ? null : Number(v))
  }
</script>

<template>
  <select :id="id" class="key" :aria-label="label" :disabled="disabled" :value="modelValue === null ? 'neutral' : String(modelValue)" @change="change">
    <option value="neutral">{{ neutral }}</option>
    <option v-for="(n, i) in NOTE_NAMES" :key="n" :value="String(i)">{{ n }}</option>
  </select>
</template>

<style scoped>
  .key {
    appearance: none;
    -webkit-appearance: none;
    box-sizing: border-box;
    height: 44px;
    min-width: 92px;
    margin: 0;
    padding: 0 12px;
    font: inherit;
    font-size: 0.85rem;
    letter-spacing: 0.04em;
    background: transparent;
    color: var(--ink);
    border: 1.5px solid color-mix(in srgb, var(--ink) 40%, transparent);
    border-radius: 10px;
    cursor: pointer;
  }
  .key:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .key:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  /* the open list is drawn by the OS on a plain background */
  .key option {
    color: #111;
    background: #fff;
  }
</style>
