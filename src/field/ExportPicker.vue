<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

  // "export": a quiet word under "sound" that opens a short list of ways to take the journey
  // away — a MIDI file for a DAW, and (soon) the audio itself. Enabled once a drift has begun,
  // because that is when its key, tempo and seed exist.

  defineProps<{
    enabled: boolean
    busy: string // '' when idle, else what is being made ("rendering…")
    wavReady: boolean // the audio can only be rendered once nothing is playing
  }>()
  const emit = defineEmits<{ (e: 'midi'): void; (e: 'wav'): void }>()

  const open = ref(false)
  const root = ref<HTMLElement | null>(null)
  const toggle = ref<HTMLElement | null>(null)
  const items = ref<HTMLElement[]>([])

  async function show() {
    open.value = true
    await nextTick()
    items.value[0]?.focus()
  }
  function hide(returnFocus = true) {
    open.value = false
    if (returnFocus) toggle.value?.focus()
  }
  function choose(kind: 'midi' | 'wav') {
    if (kind === 'midi') emit('midi')
    else emit('wav')
    hide()
  }
  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hide()
    }
  }
  function outside(ev: PointerEvent) {
    if (open.value && root.value && !root.value.contains(ev.target as Node)) hide(false)
  }
  onMounted(() => document.addEventListener('pointerdown', outside))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="export">
    <button
      ref="toggle"
      class="toggle"
      type="button"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="export-list"
      :disabled="!enabled"
      @click="open ? hide(false) : show()">
      {{ busy || 'export' }}
    </button>

    <div v-show="open" id="export-list" class="list" @keydown="onKey">
      <button
        :ref="(el) => el && (items[0] = el as HTMLElement)"
        class="option"
        type="button"
        :disabled="busy !== ''"
        @click="choose('midi')">
        <span class="name">MIDI</span>
        <span class="note">for a DAW</span>
      </button>
      <button
        :ref="(el) => el && (items[1] = el as HTMLElement)"
        class="option"
        type="button"
        :disabled="busy !== '' || !wavReady"
        @click="choose('wav')">
        <span class="name">WAV</span>
        <span class="note">{{ wavReady ? 'audio' : 'when stopped' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
  .export {
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

  .option {
    min-height: 44px;
    padding: 0 12px;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 14px;
    border-radius: 10px;
    font-size: 0.85rem;
    letter-spacing: 0.06em;
  }
  .option:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ink) 12%, transparent);
  }
  .option:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }
  .name {
    text-align: left;
  }
  /* dim by size, not by transparency: faded text fails contrast */
  .note {
    font-size: 0.68rem;
  }
</style>
