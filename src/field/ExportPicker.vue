<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { LISTED_VOICES } from '../engine/voices'
  import type { ExportFormat, ExportRequest, ExportScope } from './exportMidi'

  // "file": a quiet word under "sound" that opens the ways to take a journey away. Two choices and a
  // button: what to make (MIDI, clips for a DAW's clip view, or the audio as WAV) and how much of it
  // (this drift, several seeds of it, or the same drift on several sounds); then save. Below, the
  // project file (to reopen the journey exactly) and opening one. The saves need a journey that has
  // begun, because that is when its key, tempo and seed exist; the audio also waits until nothing is
  // playing. The choices are remembered between visits.

  const props = defineProps<{
    hasJourney: boolean
    playing: boolean // sound is playing (or still fading out)
    busy: string // '' when idle, else what is being made ("rendering 30%")
    barsOn: boolean // the drift has chords (or patterns) on bars, so there are bar lines to cut on
    driftVoice: string // the sound the last drift was played on
  }>()
  const emit = defineEmits<{
    (e: 'export', request: ExportRequest): void
    (e: 'save'): void
    (e: 'open', text: string): void
  }>()

  const FORMATS: { id: ExportFormat; label: string; name: string }[] = [
    { id: 'mid', label: 'MIDI', name: 'MIDI' },
    { id: 'clips', label: 'clips', name: 'clips' },
    { id: 'wav', label: 'WAV', name: 'WAV' },
  ]
  const SCOPES: { id: ExportScope; label: string }[] = [
    { id: 'this', label: 'this drift' },
    { id: 'seeds', label: 'seeds' },
    { id: 'sounds', label: 'sounds' },
  ]
  const COUNTS = [2, 3, 4, 6, 8]
  const MAX_WAV = 4 // each WAV is large

  // ── what was chosen, kept between visits ────────────────────────────────────────────
  const KEY = 'drift.export'
  const ids = LISTED_VOICES.map((v) => v.id)
  function saved(): Partial<ExportRequest> {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
    } catch {
      return {}
    }
  }
  const was = saved()
  const format = ref<ExportFormat>(FORMATS.some((f) => f.id === was.format) ? (was.format as ExportFormat) : 'mid')
  const scope = ref<ExportScope>(SCOPES.some((s) => s.id === was.scope) ? (was.scope as ExportScope) : 'this')
  const count = ref(COUNTS.includes(was.count as number) ? (was.count as number) : 4)
  const sounds = ref<string[]>(Array.isArray(was.sounds) && was.sounds.some((s) => ids.includes(s)) ? was.sounds.filter((s) => ids.includes(s)) : [...ids])
  watch([format, scope, count, sounds], () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ format: format.value, scope: scope.value, count: count.value, sounds: sounds.value }))
    } catch {
      /* private window or blocked storage: the choices just are not kept */
    }
  }, { deep: true })

  const idle = computed(() => props.busy === '')
  const wavNow = computed(() => format.value === 'wav')
  // clips need bar lines to cut on: chords on bars, or the pulse (which has phrases of its own)
  const pulseIn = computed(() => (scope.value === 'sounds' ? sounds.value.includes('pulse') : props.driftVoice === 'pulse'))
  const canClips = computed(() => props.barsOn || pulseIn.value)
  const counts = computed(() => COUNTS.filter((n) => !wavNow.value || n <= MAX_WAV))
  // a choice that has become impossible gives way to the nearest one
  watch([canClips, wavNow, () => props.playing], () => {
    if (format.value === 'clips' && !canClips.value) format.value = 'mid'
  })
  watch(format, () => {
    if (!counts.value.includes(count.value)) count.value = MAX_WAV
  })

  const canSave = computed(() => props.hasJourney && idle.value && !(wavNow.value && props.playing) && (scope.value !== 'sounds' || sounds.value.length > 0))
  const noun = computed(() => FORMATS.find((f) => f.id === format.value)!.name)
  const saveLabel = computed(() => {
    if (scope.value === 'this') return `save ${noun.value}`
    const n = scope.value === 'seeds' ? count.value : sounds.value.length
    const of = scope.value === 'seeds' ? `${n} seeds` : `${n} sound${n > 1 ? 's' : ''}`
    return format.value === 'clips' ? `save clips, ${of}` : n > 1 ? `save ${n} ${noun.value} files` : `save ${noun.value}`
  })
  const note = computed(() => {
    if (wavNow.value && props.playing) return 'the audio is made when the sound has stopped'
    if (format.value === 'clips' && scope.value === 'sounds' && !props.barsOn) return 'only the pulse has clips in free time'
    if (scope.value === 'sounds' && !props.barsOn) return 'in free time the modes line up, the chords do not'
    return ''
  })

  function toggleSound(id: string) {
    const on = sounds.value.includes(id)
    if (on && sounds.value.length === 1) return // at least one
    sounds.value = on ? sounds.value.filter((s) => s !== id) : ids.filter((s) => s === id || sounds.value.includes(s))
  }

  // ── the menu ────────────────────────────────────────────────────────────────────────
  const open = ref(false)
  const wrap = ref<HTMLElement | null>(null)
  const toggle = ref<HTMLElement | null>(null)
  const picker = ref<HTMLInputElement | null>(null)
  const formatRefs = ref<HTMLElement[]>([])
  const scopeRefs = ref<HTMLElement[]>([])
  const countRefs = ref<HTMLElement[]>([])

  async function show() {
    open.value = true
    await nextTick()
    formatRefs.value[FORMATS.findIndex((f) => f.id === format.value)]?.focus() // on the current choice
  }
  function hide(returnFocus = true) {
    open.value = false
    if (returnFocus) toggle.value?.focus()
  }

  // a row of chips: arrows move and choose, as in any radio group
  const formatEnabled = (id: ExportFormat) => id !== 'clips' || canClips.value
  async function chipKey<T extends string | number>(ev: KeyboardEvent, i: number, list: readonly T[], enabled: (v: T) => boolean, pick: (v: T) => void, refs: HTMLElement[]) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hide()
      return
    }
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    ev.preventDefault()
    let next = i
    for (let k = 0; k < list.length; k++) {
      next = (next + step + list.length) % list.length
      if (enabled(list[next])) break
    }
    pick(list[next])
    await nextTick()
    refs[next]?.focus()
  }
  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hide()
    }
  }

  function save() {
    emit('export', { format: format.value, scope: scope.value, count: count.value, sounds: [...sounds.value] })
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
  function outside(ev: PointerEvent) {
    if (open.value && wrap.value && !wrap.value.contains(ev.target as Node)) hide(false)
  }
  onMounted(() => document.addEventListener('pointerdown', outside))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
  const labelOf = (id: string) => LISTED_VOICES.find((v) => v.id === id)?.label ?? id
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
      <div class="row" role="radiogroup" aria-label="Make">
        <span class="label" aria-hidden="true">as</span>
        <button
          v-for="(f, i) in FORMATS"
          :key="f.id"
          :ref="(el) => el && (formatRefs[i] = el as HTMLElement)"
          class="chip"
          :class="{ on: f.id === format }"
          role="radio"
          :aria-checked="f.id === format"
          :tabindex="f.id === format ? 0 : -1"
          :disabled="!formatEnabled(f.id)"
          type="button"
          @click="format = f.id"
          @keydown="chipKey($event, i, FORMATS.map((x) => x.id), formatEnabled, (v) => (format = v), formatRefs)">
          {{ f.label }}
        </button>
        <span v-if="!canClips" class="why">clips need chords on bars</span>
      </div>

      <div class="row" role="radiogroup" aria-label="How much">
        <span class="label" aria-hidden="true">of</span>
        <button
          v-for="(s, i) in SCOPES"
          :key="s.id"
          :ref="(el) => el && (scopeRefs[i] = el as HTMLElement)"
          class="chip"
          :class="{ on: s.id === scope }"
          role="radio"
          :aria-checked="s.id === scope"
          :tabindex="s.id === scope ? 0 : -1"
          type="button"
          @click="scope = s.id"
          @keydown="chipKey($event, i, SCOPES.map((x) => x.id), () => true, (v) => (scope = v), scopeRefs)">
          {{ s.label }}
        </button>
      </div>

      <div v-if="scope === 'seeds'" class="row" role="radiogroup" aria-label="Number of seeds">
        <span class="label" aria-hidden="true">seeds</span>
        <button
          v-for="(n, i) in counts"
          :key="n"
          :ref="(el) => el && (countRefs[i] = el as HTMLElement)"
          class="chip"
          :class="{ on: n === count }"
          role="radio"
          :aria-checked="n === count"
          :tabindex="n === count ? 0 : -1"
          type="button"
          @click="count = n"
          @keydown="chipKey($event, i, counts, () => true, (v) => (count = v), countRefs)">
          {{ n }}
        </button>
      </div>

      <div v-if="scope === 'sounds'" class="row" role="group" aria-label="Sounds to make">
        <span class="label" aria-hidden="true">sounds</span>
        <button
          v-for="id in ids"
          :key="id"
          class="chip"
          :class="{ on: sounds.includes(id) }"
          :aria-pressed="sounds.includes(id)"
          type="button"
          @click="toggleSound(id)">
          {{ labelOf(id) }}
        </button>
      </div>

      <p v-if="note" class="note">{{ note }}</p>

      <button class="save" type="button" :disabled="!canSave" @click="save">{{ saveLabel }}</button>

      <hr />
      <div class="row project">
        <span class="label" aria-hidden="true">project</span>
        <button class="chip" type="button" :disabled="!hasJourney || !idle" aria-label="Save project, to reopen" @click="emit('save'), hide()">save</button>
        <button class="chip" type="button" :disabled="!idle || playing" aria-label="Open project" @click="chooseFile">open</button>
        <span v-if="playing" class="why">open when stopped</span>
      </div>
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
    gap: 2px;
    width: 340px;
    max-width: calc(100vw - 24px);
    box-sizing: border-box;
    padding: 12px 10px 8px;
    border-radius: 14px;
    /* always the dark theme, whatever colours lie behind it */
    --ink: #f2f2f7;
    --ink-contrast: #15171f;
    background: rgba(21, 23, 31, 0.94);
    color: var(--ink);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  /* on a phone the panel spans the screen (right-aligned to the word "file" it would run off the edge) */
  @media (max-width: 480px) {
    .list {
      position: fixed;
      left: 12px;
      right: 12px;
      width: auto;
      bottom: calc(86px + env(safe-area-inset-bottom, 0px));
    }
  }
  hr {
    width: 100%;
    margin: 8px 0 2px;
    border: 0;
    border-top: 1px solid color-mix(in srgb, var(--ink) 25%, transparent);
  }

  .row {
    display: flex;
    flex-wrap: wrap; /* only on a very narrow screen; otherwise one row */
    align-items: center;
    gap: 4px;
    padding: 0 2px;
  }
  .label {
    flex: none;
    width: 3.4rem;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-align: left;
  }
  .chip {
    min-height: 44px;
    padding: 0 10px;
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
  .chip:focus-visible,
  .save:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  /* dim by size, not by transparency: faded text fails contrast */
  .note,
  .why {
    font-size: 0.68rem;
    letter-spacing: 0.04em;
  }
  .note {
    margin: 4px 6px 0;
  }
  .why {
    margin-left: 4px;
  }
  .save {
    min-height: 44px;
    margin-top: 8px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    font-size: 0.85rem;
    letter-spacing: 0.06em;
    background: var(--ink);
    color: var(--ink-contrast);
  }
  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
</style>
