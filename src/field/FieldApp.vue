<script setup lang="ts">
  import { computed, defineAsyncComponent, ref, watch } from 'vue'
  import FieldBackground from './FieldBackground.vue'
  import MoodField from './MoodField.vue'
  import JourneyRing from './JourneyRing.vue'
  import WordsFallback from './WordsFallback.vue'
  import SoundPicker from './SoundPicker.vue'
  import ExportPicker from './ExportPicker.vue'
  import { NOTE_NAMES, scoreFor } from '../engine/score'
  import { clipFiles, download, exportName, midiBytes, type ExportRequest } from './exportMidi'
  import { zipStored, type ZipFile } from './zip'
  import { renderDriftWav } from '../engine/render'
  import { LENGTHS } from './lengths'
  import { parseProject, toProject } from './project'
  import { buildDrift, ordinal } from './buildDrift'
  import { createJourney, MAX_POINTS, settingsOf } from './journey'
  import { useSoundOps } from './soundOps'
  import { loadPlayer, warmUp } from './warmUp'
  import { describe, paletteAt, palettePath, inkFor, type Point } from './moodPlane'
  import { BARS_NAME, DEFAULT_BARS, DEFAULT_VARIATION, type Bars, type Variation } from '../engine/compose'
  import { GRID_LABEL, GRID_NAME, type Density, type Grid } from '../engine/pulse'
  import { VOICES, preloadVoice } from '../engine/voices'

  const GenerativePlayer = defineAsyncComponent(loadPlayer)

  const j = createJourney()
  const {
    announcement, say, points, preview, minutes, voiceId, tempoFeel, customBpm, effectiveBpm, gridChoice, densityChoice,
    variationChoice, barsChoice, rootChoice, isPulse, drifting, position, elapsed, totalSeconds, plan, seed, audioActive,
    session, driftBpm, driftGrid, driftDensity, driftVoice, layout, info, exporting, kept, lastDrift, seedOverride, reset,
    barsOn, stopKeys, stopGrids, stopDensities, stopVariations, stopBars, activeStage, passing, progress,
  } = j
  const sound = useSoundOps(j)
  const { chooseVoice, chooseTempo, chooseBpm, chooseGrid, chooseDensity, chooseVariation, chooseBars, chooseRoot } = sound
  const wordFor = describe
  let audioTeardown: number | undefined
  const playerRef = ref<{ stopDrift: () => void } | null>(null)
  const fieldRef = ref<{ focus: () => void } | null>(null)

  // ── choosing ────────────────────────────────────────────────────────────────────────
  function keepSeed() {
    if (kept.value) {
      kept.value = null
      say('Seed released: each Begin draws a new one.')
    } else if (lastDrift.value) {
      kept.value = { seed: lastDrift.value.seed, key: lastDrift.value.plan.tonic ?? 0 }
      say(`Seed ${lastDrift.value.seed} kept, in ${NOTE_NAMES[kept.value.key]}. Begin again, on any sound, to hear it again.`)
    }
  }
  function choose(p: Point) {
    if (drifting.value) return
    const last = points.value[points.value.length - 1]
    if (last && last.v === p.v && last.a === p.a) return // the same place again: nothing to add
    reset()
    warmUp()
    const n = points.value.length
    if (n === 0) {
      points.value = [p]
      say(`Where you are: ${wordFor(p)}. Choose where you would like to be, or begin.`)
    } else if (n >= MAX_POINTS) {
      points.value = [...points.value.slice(0, -1), p]
      say(`The most stops is ${MAX_POINTS}. Replaced the last with ${wordFor(p)}.`)
    } else {
      points.value = [...points.value, p]
      say(
        `${n === 1 ? 'Where you would like to be' : ordinal(n + 1)}: ${wordFor(p)}. ` +
          (n + 1 < MAX_POINTS ? 'Add another stop, or begin.' : 'That is the most stops. Begin when you are ready.')
      )
    }
  }

  function remove(i: number) {
    if (drifting.value) return
    reset()
    const gone = points.value[i]
    points.value = points.value.filter((_, k) => k !== i)
    say(`Removed ${wordFor(gone)}.`)
  }

  // Start a new journey without taking the old stops away one at a time.
  function clear() {
    if (drifting.value || !points.value.length) return
    reset()
    points.value = []
    say('Cleared. Touch where you are.')
    fieldRef.value?.focus() // the button is about to go quiet; keep the keyboard somewhere useful
  }

  // the word lists: set a stop, add the next, or take one away
  function setFromWords(index: number, p: Point | null) {
    if (drifting.value) return
    reset()
    if (p) warmUp()
    if (!p) {
      points.value = points.value.filter((_, k) => k !== index)
      say('Removed a stop.')
      return
    }
    if (index < points.value.length)
      points.value = points.value.map((q, k) => (k === index ? { ...p, ...settingsOf(q) } : q))
    else if (index === points.value.length && index < MAX_POINTS) points.value = [...points.value, p]
    say(`${index === 0 ? 'Where you are' : ordinal(index + 1)}: ${wordFor(p)}.`)
  }

  // ── a drift ─────────────────────────────────────────────────────────────────────────
  function begin() {
    if (!points.value.length || drifting.value) return
    clearTimeout(audioTeardown)
    const forcedSeed = seedOverride.value
    reset()
    const d = buildDrift({
      points: points.value,
      minutes: minutes.value,
      voiceId: voiceId.value,
      pulse: VOICES[voiceId.value]?.style === 'pulse',
      bpm: effectiveBpm.value,
      grid: gridChoice.value,
      density: densityChoice.value,
      variation: variationChoice.value,
      bars: barsChoice.value,
      rootChoice: rootChoice.value,
      kept: kept.value,
      seedOverride: forcedSeed,
      random: Math.random,
    })
    plan.value = d.plan
    seed.value = d.seed
    driftBpm.value = d.bpm
    totalSeconds.value = d.layout.duration
    driftVoice.value = d.voiceId
    driftGrid.value = d.grid
    driftDensity.value = d.density
    layout.value = d.layout
    info.value = d.readout
    lastDrift.value = d.record
    session.value++
    audioActive.value = true
    drifting.value = true
    preview.value = null
    say(d.announcement)
  }

  function onProgress(newPosition: number, _text: number, seconds: number) {
    position.value = newPosition
    elapsed.value = seconds
  }

  function saveProject() {
    if (!lastDrift.value) return
    const d = lastDrift.value
    const project = toProject({
      points: d.points,
      words: d.words,
      minutes: d.minutes,
      root: d.plan.tonic ?? 0,
      voice: d.voiceId,
      bpm: d.bpm,
      grid: d.grid,
      density: d.density,
      variation: d.plan.waypoints[0]?.variation ?? DEFAULT_VARIATION,
      bars: d.plan.waypoints[0]?.bars ?? DEFAULT_BARS,
      seed: d.seed,
      modes: d.modes,
    })
    const name = exportName(d.head, d.modes, d.bpm, 'drift.json')
    download(new TextEncoder().encode(JSON.stringify(project, null, 2) + '\n'), name, 'application/json')
    say(`Project saved: ${d.key} ${d.modes.join(' to ')}.`)
  }

  // Opening a project sets up the journey as it was (its seed is used by the next Begin). The
  // sound, tempo and key are the project's for this visit only: they do not replace the listener's
  // remembered choices.
  function openProject(text: string) {
    if (drifting.value || audioActive.value) return
    const r = parseProject(text, { lengths: LENGTHS, maxStops: MAX_POINTS })
    if (!r.ok) {
      say(r.reason)
      return
    }
    const p = r.project
    reset()
    points.value = p.stops.map((s) => ({ v: s.v, a: s.a, ...settingsOf(s) }))
    minutes.value = p.minutes
    rootChoice.value = p.root
    if (VOICES[p.voice]) {
      voiceId.value = p.voice
      preloadVoice(VOICES[p.voice])
    }
    customBpm.value = p.bpm === null ? null : p.bpm
    if (p.grid) gridChoice.value = p.grid
    if (p.density) densityChoice.value = p.density
    variationChoice.value = p.variation
    barsChoice.value = p.bars
    warmUp()
    seedOverride.value = p.seed
    kept.value = null
    say(`Project opened: ${p.stops.length === 1 ? '1 stop' : `${p.stops.length} stops`}, ${NOTE_NAMES[p.root]}. Press begin.`)
  }

  // Taking the journey away (file menu): what to make (MIDI; clips for a DAW's clip view; the audio as
  // WAV) and how much of it — this drift, several seeds of it (the same stops, key, tempo and sound, the
  // seeds running on from this drift's own, so the first is what was just heard), or this drift on several
  // sounds (this seed and tempo; on bars they play the same chords). One file when it is one MIDI or WAV,
  // else a zip. The audio is rendered offline, faster than real time; it cannot run beside a live drift
  // (the offline context takes over Tone's clock), so it waits until the sound has stopped.
  async function exportAs(req: ExportRequest) {
    if (!lastDrift.value || exporting.value) return
    const wav = req.format === 'wav'
    if (wav && audioActive.value) return
    const d = lastDrift.value
    const units =
      req.scope === 'seeds'
        ? Array.from({ length: req.count }, (_, k) => ({ voiceId: d.voiceId, seed: (d.seed + k) % 2 ** 31 }))
        : req.scope === 'sounds'
          ? req.sounds.filter((id) => VOICES[id]).map((id) => ({ voiceId: id, seed: d.seed }))
          : [{ voiceId: d.voiceId, seed: d.seed }]
    if (!units.length) return
    const many = units.length > 1
    const ext = req.format === 'clips' ? 'zip' : req.format === 'mid' ? 'mid' : 'wav'
    exporting.value = wav ? 'loading…' : 'saving…'
    say(wav ? 'Rendering the audio. This can take a little while.' : many ? `Making ${units.length} files.` : 'Making the file.')
    try {
      const files: ZipFile[] = []
      let without = 0 // sounds that had nothing to cut into clips
      for (const [k, u] of units.entries()) {
        const voice = VOICES[u.voiceId]
        const pulse = voice.style === 'pulse'
        // the pulse's grid and density are the drift's, or (when it was another sound) the sound menu's
        const tempo = { bpm: d.bpm, grid: d.grid ?? gridChoice.value, density: d.density ?? densityChoice.value }
        const info = {
          voice: voice.label,
          seed: u.seed,
          stops: d.stops,
          minutes: d.minutes,
          feel: pulse ? `${GRID_LABEL[tempo.grid]} ${tempo.density}` : undefined,
        }
        const of = `${k + 1}/${units.length}`
        const tag = req.scope === 'seeds' ? `${u.voiceId}-seed${u.seed}` : req.scope === 'sounds' ? u.voiceId : undefined
        if (wav) {
          const bytes = await renderDriftWav(voice, d.plan, u.seed, tempo, (p) => {
            exporting.value = p.stage === 'loading' ? 'loading…' : many ? `rendering ${of} ${Math.round(p.done * 100)}%` : `rendering ${Math.round(p.done * 100)}%`
          })
          files.push({ name: exportName(d.head, d.modes, d.bpm, 'wav', tag), data: bytes })
          continue
        }
        if (many) exporting.value = `saving ${of}`
        await new Promise((r) => setTimeout(r)) // let the label show
        const score = scoreFor(voice, d.plan, u.seed, tempo)
        if (req.format === 'mid') {
          files.push({ name: exportName(d.head, d.modes, d.bpm, 'mid', tag), data: await midiBytes(score, info) })
        } else {
          const clips = await clipFiles(score, info, d.words)
          if (!clips.length) without++
          files.push(...clips.map((f) => (many ? { ...f, name: `${tag}/${f.name}` } : f)))
        }
      }
      if (!files.length) {
        say('There was nothing to cut into clips: free time has no bar lines. Put chords on bars, or use the pulse.')
        return
      }
      const what = `${d.head ? d.head + ' ' : ''}${d.modes.join(' to ')}`
      if (files.length === 1 && req.format !== 'clips') {
        download(files[0].data, files[0].name, wav ? 'audio/wav' : 'audio/midi')
        say(`${wav ? 'Audio' : 'MIDI'} file saved: ${what}.`)
      } else {
        const zipTag =
          req.scope === 'seeds' ? `${d.voiceId}-${req.count}-seeds` : req.scope === 'sounds' ? `${units.length}-sounds` : `${d.voiceId}-clips`
        download(zipStored(files), exportName(d.head, d.modes, d.bpm, 'zip', req.format === 'clips' && req.scope !== 'this' ? `${zipTag}-clips` : zipTag), 'application/zip')
        say(`${ext === 'zip' && req.scope === 'this' ? `${files.length - 1} clips` : `${units.length} ${units.length > 1 ? 'files' : 'file'}`} saved: ${what}.` + (without ? ` ${without} had nothing to cut.` : ''))
      }
    } catch {
      say('Sorry, that could not be made.')
    } finally {
      exporting.value = ''
    }
  }

  watch(activeStage, (i, before) => {
    if (drifting.value && i >= 0 && i !== before && info.value) say(`Now in ${info.value.stages[i].label}.`)
  })

  // ── a stop's key ────────────────────────────────────────────────────────────────────
  function setStopKey(i: number, key: number | null) {
    if (drifting.value || i >= points.value.length) return
    if (i === 0) {
      chooseRoot(key)
      return
    }
    reset()
    points.value = points.value.map((p, k) => {
      if (k !== i) return p
      const { key: _gone, ...rest } = p
      return key === null ? rest : { ...rest, key }
    })
    say(`Stop ${i + 1}: ${key === null ? 'the same key as before' : NOTE_NAMES[key]}.`)
  }

  // ── a stop's grid and density (the pulse) ─────────────────────────────────────────────
  // As with the key: the first stop's are the sound menu's; a later stop's are its own, or none,
  // which keeps the stop before's. The grid changes once, midway along the walk to the stop;
  // the density eases along it.
  function setStopFeel(i: number, field: 'grid' | 'density' | 'variation' | 'bars', value: Grid | Density | Variation | Bars | null) {
    if (drifting.value || i >= points.value.length) return
    if (i === 0) {
      if (value === null) return
      if (field === 'grid') chooseGrid(value as Grid)
      else if (field === 'density') chooseDensity(value as Density)
      else if (field === 'bars') chooseBars(value as Bars)
      else chooseVariation(value as Variation)
      return
    }
    reset()
    points.value = points.value.map((p, k) => {
      if (k !== i) return p
      const { [field]: _gone, ...rest } = p
      return value === null ? rest : { ...rest, [field]: value }
    })
    const what = field === 'grid' ? 'Grid' : field === 'density' ? 'Notes' : field === 'bars' ? (isPulse.value ? 'Pattern' : 'Chords') : 'Variation'
    const shown =
      value === null ? 'the same as before' : field === 'grid' ? GRID_NAME[value as Grid] : field === 'bars' ? (value ? BARS_NAME[value as Bars] : 'free time') : value
    say(`Stop ${i + 1}: ${what} ${shown}.`)
  }
  const setStopGrid = (i: number, g: Grid | null) => setStopFeel(i, 'grid', g)
  const setStopDensity = (i: number, d: Density | null) => setStopFeel(i, 'density', d)
  const setStopVariation = (i: number, v: Variation | null) => setStopFeel(i, 'variation', v)
  const setStopBars = (i: number, b: Bars | null) => setStopFeel(i, 'bars', b)

  function finish(announce: string) {
    drifting.value = false
    // unmount after the audio has finished fading, or it is cut mid-fade
    audioTeardown = window.setTimeout(() => (audioActive.value = false), 3100)
    say(announce)
  }

  function stop() {
    playerRef.value?.stopDrift()
    // the colours return to the start, but what was drifted stays on screen (and can be exported)
    const kept = info.value
    reset()
    info.value = kept
    finish('The drift has ended.')
  }

  function onEnded() {
    finish('The drift has ended. You have arrived.')
  }

  // ── what the screen looks like ──────────────────────────────────────────────────────
  const IDLE = ['#5c6d7a', '#8e9ab8', '#e8d7f1']
  const palette = computed(() => {
    if (preview.value) return paletteAt(preview.value)
    if (points.value.length) return palettePath(points.value, position.value)
    return IDLE
  })

  // The background runs top to bottom through the palette's three colours, so each part of the
  // interface takes the ink that reads best over the colour behind it: the hint at the top, the
  // field in the middle, the ring at the bottom.
  const topInk = computed(() => inkFor(palette.value[0]))
  const midInk = computed(() => inkFor(palette.value[1]))
  const bottomInk = computed(() => inkFor(palette.value[2]))
  const vars = (i: { ink: string; contrast: string }) => ({ '--ink': i.ink, '--ink-contrast': i.contrast })

  const hint = computed(() => {
    if (info.value) return ''
    if (drifting.value) return ''
    if (!points.value.length) return 'touch where you are'
    if (points.value.length === 1) return 'now where you would like to be, or begin'
    if (points.value.length < MAX_POINTS) return 'add another stop, or begin'
    return ''
  })
</script>

<template>
  <main class="field-app" :style="vars(midInk)">
    <FieldBackground :palette="palette" />

    <div :style="vars(topInk)">
      <WordsFallback
        :points="points"
        :keys="stopKeys"
        :grids="stopGrids"
        :densities="stopDensities"
        :variations="stopVariations"
        :bars="stopBars"
        :pulse="isPulse"
        :drifting="drifting"
        :max="MAX_POINTS"
        @set="setFromWords"
        @key="setStopKey"
        @grid="setStopGrid"
        @density="setStopDensity"
        @variation="setStopVariation"
        @bars="setStopBars" />
    </div>

    <MoodField
      ref="fieldRef"
      :points="points"
      :travel="drifting ? position : null"
      :drifting="drifting"
      :keys="stopKeys"
      :grids="stopGrids"
      :densities="stopDensities"
      :variations="stopVariations"
      :bars="stopBars"
      :pulse="isPulse"
      @choose="choose"
      @remove="remove"
      @key="setStopKey"
      @grid="setStopGrid"
      @density="setStopDensity"
      @variation="setStopVariation"
      @bars="setStopBars"
      @clear="clear"
      @preview="preview = $event" />

    <div class="hint" :class="{ journey: !!info }" :style="vars(topInk)">
      <p class="line" aria-hidden="true">
        {{ hint }}
        <template v-if="info">
          <template v-if="info.uniform">{{ info.key }} ·</template>
          <template v-for="(st, i) in info.stages" :key="i">
            <span class="mode" :class="{ on: i === activeStage }">{{ st.label }}</span>
            <template v-if="i < info.stages.length - 1"> → </template>
          </template>
          <template v-if="info.bars"> · {{ info.bars }} bars</template>
          <template v-if="info.bpm"> · {{ info.bpm }} BPM</template>
          <template v-if="info.eased"> · {{ isPulse ? 'pattern' : 'chords' }} eased to fit</template>
        </template>
      </p>
      <template v-if="info">
        <!-- the seed is also the way to keep it: press to reuse it (and the key) for the next Begin, on any sound -->
        <button class="seed keep" type="button" :aria-pressed="!!kept" title="Keep this seed, and its key, for the next Begin" @click="keepSeed">
          {{ info.seed }}{{ kept ? ' · kept' : '' }}
        </button>
        <span class="seed passing" aria-hidden="true">{{ passing }}</span>
      </template>
    </div>

    <div :style="vars(bottomInk)">
      <button
        class="side left"
        type="button"
        :disabled="drifting || !points.length"
        @click="clear">
        clear
      </button>
      <JourneyRing
        v-model="minutes"
        :drifting="drifting"
        :can-begin="points.length > 0"
        :progress="progress"
        @begin="begin"
        @stop="stop" />
      <SoundPicker
        class="side right"
        :model-value="voiceId"
        :tempo="tempoFeel"
        :bpm="effectiveBpm"
        :custom-bpm="customBpm !== null"
        :grid="gridChoice"
        :density="densityChoice"
        :variation="variationChoice"
        :bars="barsChoice"
        :root="rootChoice"
        :disabled="drifting"
        @update:model-value="chooseVoice"
        @update:tempo="chooseTempo"
        @update:bpm="chooseBpm"
        @update:grid="chooseGrid"
        @update:density="chooseDensity"
        @update:variation="chooseVariation"
        @update:bars="chooseBars"
        @update:root="chooseRoot" />
      <ExportPicker
        class="side right low"
        :has-journey="!!info"
        :playing="audioActive"
        :busy="exporting"
        :bars-on="barsOn"
        :drift-voice="driftVoice"
        @export="exportAs"
        @save="saveProject"
        @open="openProject" />
    </div>

    <GenerativePlayer
      v-if="audioActive"
      :key="session"
      ref="playerRef"
      :plan="plan"
      :seed="seed"
      :bpm="driftBpm"
      :grid="driftGrid"
      :density="driftDensity"
      @progress="onProgress"
      @ended="onEnded" />

    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
  </main>
</template>

<style>
  /* Colours the interface can change smoothly as the field's colours change. */
  @property --ink {
    syntax: '<color>';
    inherits: true;
    initial-value: rgb(255, 255, 255);
  }
  @property --ink-contrast {
    syntax: '<color>';
    inherits: true;
    initial-value: rgb(24, 28, 40);
  }

  .field-app {
    transition: --ink 0.8s ease, --ink-contrast 0.8s ease;
    font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
    color: var(--ink);
  }

  .field-app .hint {
    position: fixed;
    left: 0;
    right: 0;
    top: calc(22px + env(safe-area-inset-top, 0px));
    margin: 0;
    text-align: center;
    font-size: 0.85rem;
    letter-spacing: 0.14em;
    color: var(--ink);
    opacity: 0.8;
    pointer-events: none;
    z-index: 1;
  }

  /* the journey readout is long: on a narrow screen it drops below the "words" button */
  .field-app .hint.journey {
    padding: 0 12px;
    box-sizing: border-box;
    text-wrap: balance;
  }
  /* the prompts beside the "words" button must not run under it on a phone */
  @media (max-width: 640px) {
    .field-app .hint:not(.journey) {
      left: 80px;
      right: 12px;
      font-size: 0.78rem;
      letter-spacing: 0.08em;
    }
    .field-app .hint.journey {
      top: calc(70px + env(safe-area-inset-top, 0px));
    }
  }

  /* the two controls either side of the ring, level with its centre */
  .field-app .side {
    position: fixed;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
    z-index: 4;
  }
  .field-app .side.left {
    all: unset;
    box-sizing: border-box;
    position: fixed;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
    right: calc(50% + 100px);
    z-index: 4;
    min-height: 44px;
    min-width: 44px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    color: var(--ink);
    opacity: 0.75;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .field-app .side.left:hover:not(:disabled) {
    opacity: 1;
  }
  .field-app .side.left:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .field-app .side.left:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -4px;
    border-radius: 6px;
    opacity: 1;
  }
  .field-app .side.right {
    left: calc(50% + 100px);
  }
  /* export sits under sound */
  .field-app .side.low {
    bottom: calc(36px + env(safe-area-inset-bottom, 0px));
  }

  /* the mode sounding now is ringed; the others keep their full contrast, only unmarked */
  .field-app .hint .mode {
    display: inline-block;
    padding: 1px 9px;
    margin: 0 2px;
    border-radius: 999px;
    border: 1.5px solid transparent;
    transition: border-color 1.5s ease, background-color 1.5s ease;
  }
  .field-app .hint .mode.on {
    border-color: var(--ink);
    background: color-mix(in srgb, var(--ink) 14%, transparent);
  }

  .field-app .hint .seed.passing {
    margin-top: 0;
  }
  .field-app .hint .line {
    margin: 0;
  }
  .field-app .hint .seed {
    display: block;
    margin-top: 2px;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
  }
  /* the seed is a button, with a 44px target that overlaps the lines above and below it (the readout
     takes no more room); only the seed itself takes the pointer */
  .field-app .hint .seed.keep {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    margin: -15px auto -15px;
    padding: 0 14px;
    width: fit-content;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    color: var(--ink);
    pointer-events: auto;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .field-app .hint .seed.keep:hover,
  .field-app .hint .seed.keep[aria-pressed='true'] {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .field-app .hint .seed.keep:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -4px;
    border-radius: 8px;
  }

  .field-app .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .field-app {
      transition: none;
    }
  }
</style>
