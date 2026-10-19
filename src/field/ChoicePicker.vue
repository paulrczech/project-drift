<script setup lang="ts">
  // A small chooser for a stop's grid or density: a native select, like the key's. `neutral` is
  // what no choice means for a later stop ("same": as the stop before); the first stop has none.

  defineProps<{
    modelValue: string | null
    options: { value: string; label: string }[]
    neutral?: string
    label: string // the accessible name
    disabled?: boolean
  }>()
  const emit = defineEmits<{ (e: 'update:modelValue', value: string | null): void }>()

  function change(ev: Event) {
    const v = (ev.target as HTMLSelectElement).value
    emit('update:modelValue', v === 'neutral' ? null : v)
  }
</script>

<template>
  <select class="choice" :aria-label="label" :disabled="disabled" :value="modelValue ?? 'neutral'" @change="change">
    <option v-if="neutral" value="neutral">{{ neutral }}</option>
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>

<style scoped>
  .choice {
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
  .choice:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .choice:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  /* the open list is drawn by the OS on a plain background */
  .choice option {
    color: #111;
    background: #fff;
  }
</style>
