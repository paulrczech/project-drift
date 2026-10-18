<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

  // "file": a quiet word under "sound" that opens the ways to take a journey away (MIDI for a DAW,
  // the audio, a project file that can be opened again) and to open a project. The saves need a
  // journey that has begun, because that is when its key, tempo and seed exist; the audio also
  // waits until nothing is playing.

  const props = defineProps<{
    hasJourney: boolean
    playing: boolean // sound is playing (or still fading out)
    busy: string // '' when idle, else what is being made ("rendering 30%")
  }>()
  const emit = defineEmits<{
    (e: 'midi'): void
    (e: 'wav'): void
    (e: 'save'): void
    (e: 'open', text: string): void
  }>()

  const open = ref(false)
  const wrap = ref<HTMLElement | null>(null)
  const toggle = ref<HTMLElement | null>(null)
  const items = ref<HTMLButtonElement[]>([])
  const picker = ref<HTMLInputElement | null>(null)

  const idle = computed(() => props.busy === '')
  const canSave = computed(() => props.hasJourney && idle.value)
  const canAudio = computed(() => props.hasJourney && idle.value && !props.playing)
  const canOpen = computed(() => idle.value && !props.playing)

  async function show() {
    open.value = true
    await nextTick()
    items.value.find((b) => b && !b.disabled)?.focus()
  }
  function hide(returnFocus = true) {
    open.value = false
    if (returnFocus) toggle.value?.focus()
  }
  function choose(kind: 'midi' | 'wav' | 'save') {
    if (kind === 'midi') emit('midi')
    else if (kind === 'wav') emit('wav')
    else emit('save')
    hide()
  }
  function chooseFile() {
    picker.value?.click() // the system file chooser; its result arrives in onFile
  }
  async function onFile(ev: Event) {
    const input = ev.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // so the same file can be opened twice
    if (!file) return
    emit('open', await file.text())
    hide()
  }
  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hide()
      return
    }
    const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    ev.preventDefault()
    const live = items.value.filter((b) => b && !b.disabled)
    const at = live.indexOf(document.activeElement as HTMLButtonElement)
    live[(at + step + live.length) % live.length]?.focus()
  }
  function outside(ev: PointerEvent) {
    if (open.value && wrap.value && !wrap.value.contains(ev.target as Node)) hide(false)
  }
  onMounted(() => document.addEventListener('pointerdown', outside))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="wrap" class="export">
    <button
      ref="toggle"
      class="toggle"
      type="button"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="export-list"
      :disabled="!idle && !open"
      @click="open ? hide(false) : show()">
      {{ busy || 'file' }}
    </button>

    <div v-show="open" id="export-list" class="list" @keydown="onKey">
      <button :ref="(el) => el && (items[0] = el as HTMLButtonElement)" class="option" type="button" :disabled="!canSave" @click="choose('midi')">
        <span class="name">MIDI</span>
        <span class="note">for a DAW</span>
      </button>
      <button :ref="(el) => el && (items[1] = el as HTMLButtonElement)" class="option" type="button" :disabled="!canAudio" @click="choose('wav')">
        <span class="name">WAV</span>
        <span class="note">{{ !hasJourney || !playing ? 'audio' : 'when stopped' }}</span>
      </button>
      <button :ref="(el) => el && (items[2] = el as HTMLButtonElement)" class="option" type="button" :disabled="!canSave" @click="choose('save')">
        <span class="name">project</span>
        <span class="note">to reopen</span>
      </button>
      <hr />
      <button :ref="(el) => el && (items[3] = el as HTMLButtonElement)" class="option" type="button" :disabled="!canOpen" @click="chooseFile">
        <span class="name">open project</span>
        <span class="note">{{ playing ? 'when stopped' : '' }}</span>
      </button>
      <input ref="picker" class="file" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" @change="onFile" />
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
    min-width: 200px;
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
  hr {
    width: 100%;
    margin: 4px 0;
    border: 0;
    border-top: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
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
  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
</style>
