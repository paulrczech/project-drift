<script setup lang="ts">
  import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
  import FieldBackground from './FieldBackground.vue'
  import MoodField from './MoodField.vue'
  import JourneyRing from './JourneyRing.vue'
  import WordsFallback from './WordsFallback.vue'
  import SoundPicker from './SoundPicker.vue'
  import ExportPicker from './ExportPicker.vue'
  import { NOTE_NAMES, scoreFor } from '../engine/score'
  import { clipFiles, download, exportName, midiBytes } from './exportMidi'
  import { zipStored, type ZipFile } from './zip'
  import { renderDriftWav } from '../engine/render'
  import { LENGTHS } from './lengths'
  import { parseProject, toProject } from './project'
  import {
    describe,
    paletteAt,
    palettePath,
    inkFor,
    type Point,
  } from './moodPlane'
  import { rungFor } from '../engine/moods'
  import { BARS_NAME, DEFAULT_BARS, DEFAULT_VARIATION, layoutTimeline, stateAt, type Bars, type Layout, type TimelinePlan, type Variation } from '../engine/compose'
  import { GRID_LABEL, GRID_NAME, TEMPO_FEEL, clampBpm, defaultBpm, type Density, type Grid } from '../engine/pulse'
  import { LADDER } from '../engine/drift'

  import {
    VOICES,
    currentCustomBpm,
    currentDensity,
    currentGrid,
    currentRoot,
    currentTempoFeel,
    currentBars,
    currentVariation,
    currentVoiceId,
    preloadVoice,
    rememberCustomBpm,
    rememberDensity,
    rememberGrid,
    rememberRoot,
    rememberTempoFeel,
    rememberBars,
    rememberVariation,
    rememberVoice,
    voiceFromLocation,
    type TempoFeelName,
  } from '../engine/voices'

  // Tone.js is large and only needed once a drift starts, so the player loads on demand —
  // and, with the samples, is fetched ahead of time as soon as someone chooses a first stop.
  const loadPlayer = () => import('../components/GenerativePlayer.vue')
  const GenerativePlayer = defineAsyncComponent(loadPlayer)
  function warmUp() {
    loadPlayer()
    preloadVoice(voiceFromLocation())
  }

  // The sound: remembered between visits, applied to the next drift.
  const voiceId = ref(currentVoiceId())
  function chooseVoice(id: string) {
    voiceId.value = id
    rememberVoice(id)
    preloadVoice(VOICES[id])
    say(`Sound: ${VOICES[id].label}.`)
  }

  // The tempo is fixed for the whole journey. By default it comes from the stops' mean arousal,
  // scaled by slow / medium / fast; or the listener types an exact BPM. The pulse plays to it; the
  // other sounds have no beat, but their exported files are written at it, so files of every sound
  // line up in a DAW.
  const tempoFeel = ref<TempoFeelName>(currentTempoFeel())
  const customBpm = ref<number | null>(currentCustomBpm())
  const effectiveBpm = computed(
    () =>
      customBpm.value ??
      clampBpm(
        defaultBpm(
          points.value.length ? points.value.map((p) => ({ arousal: p.a })) : [{ arousal: 0.4 }],
          TEMPO_FEEL[tempoFeel.value]
        )
      )
  )
  function chooseTempo(feel: TempoFeelName) {
    tempoFeel.value = feel
    customBpm.value = null
    rememberTempoFeel(feel)
    say(`Tempo: ${feel}, ${effectiveBpm.value} BPM.`)
  }
  function chooseBpm(bpm: number) {
    customBpm.value = clampBpm(bpm)
    rememberCustomBpm(customBpm.value)
    say(`Tempo: ${customBpm.value} BPM.`)
  }
  const driftBpm = ref<number | undefined>(undefined) // the tempo this drift was started with (all sounds)

  // The pulse's grid (steps per beat) and density (how many of the weak steps sound), fixed for the journey.
  const gridChoice = ref<Grid>(currentGrid())
  const densityChoice = ref<Density>(currentDensity())
  function chooseGrid(grid: Grid) {
    gridChoice.value = grid
    rememberGrid(grid)
    say(`Grid: ${GRID_NAME[grid]}.`)
  }
  function chooseDensity(density: Density) {
    densityChoice.value = density
    rememberDensity(density)
    say(`Notes: ${density}.`)
  }
  // How much the music changes (every sound): the first stop's is the sound menu's, each later stop
  // may set its own. It paces the harmony's moves and, for the pulse, its notes and phrases.
  const variationChoice = ref<Variation>(currentVariation())
  function chooseVariation(variation: Variation) {
    variationChoice.value = variation
    rememberVariation(variation)
    say(`Variation: ${variation}.`)
  }
  // Clusters on bars (pad, choir, orchestra; the pulse: its pattern): the whole cluster changes every n bars at the
  // journey's tempo, or 0 for free time. The first stop's is the sound menu's; each later stop may set its own.
  const barsChoice = ref<Bars>(currentBars())
  function chooseBars(bars: Bars) {
    barsChoice.value = bars
    rememberBars(bars)
    say(isPulse.value ? (bars ? `Pattern: a new one ${BARS_NAME[bars]}.` : 'Pattern: free time.') : bars ? `Chords: a new cluster ${BARS_NAME[bars]}.` : 'Chords: free time.')
  }
  const driftGrid = ref<Grid | undefined>(undefined) // what this drift was started with
  const driftDensity = ref<Density | undefined>(undefined)

  // The key: a root the listener chose (kept between visits), or auto — a new one each drift.
  const rootChoice = ref<number | null>(currentRoot())
  function chooseRoot(root: number | null) {
    rootChoice.value = root
    rememberRoot(root)
    say(root === null ? 'Key: a new one each time.' : `Key: ${NOTE_NAMES[root]}.`)
  }

  // What this journey is, kept on screen for a composer to note: key, modes, tempo, seed.
  // `stages` are the modes in journey order (consecutive repeats merged); `from`/`to` are the
  // waypoints each covers, so the one that is sounding can be marked as the drift moves.
  interface Stage {
    mode: string
    key: number // pitch class
    label: string // "dorian", or "Ab major" when the journey changes key
    rung: number
    from: number
    to: number
  }
  const info = ref<{ key: string; uniform: boolean; stages: Stage[]; bpm?: number; bars?: number; eased?: boolean; seed: string } | null>(null)
  const layout = shallowRef<Layout | null>(null) // reactive, so what is sounding follows it
  // what was begun, so it can be taken away exactly as it sounded (same plan, seed, voice, tempo)
  let lastDrift: {
    voiceId: string
    plan: TimelinePlan
    seed: number
    bpm?: number
    grid?: Grid
    density?: Density
    stops: string
    minutes: number
    key: string // the key it starts in
    head: string // the key as it begins a file name ('' when the journey changes key)
    modes: string[] // one label per stage
    points: Point[]
    words: string[]
  } | null = null
  const exporting = ref('') // what is being made right now (shown on the export word)

  // ── state ───────────────────────────────────────────────────────────────────────────
  // `points` is the journey, in order (the interface offers one or two; nothing below
  // assumes two). `position` is the fractional index along it, driven by the audio clock.
  const points = ref<Point[]>([])
  const preview = ref<Point | null>(null)
  // The most stops a journey can have. More is possible for the engine; this keeps the screen readable.
  const MAX_POINTS = 6
  const minutes = ref(10) // length of the whole drift; Infinity never ends
  const drifting = ref(false)
  const position = ref(0)
  const elapsed = ref(0)
  const totalSeconds = ref(Infinity)

  const plan = ref<Omit<TimelinePlan, 'rng'>>({ waypoints: [], walk: 0 })
  const seed = ref(0)
  const audioActive = ref(false)
  const session = ref(0)
  let audioTeardown: number | undefined
  const playerRef = ref<{ stopDrift: () => void } | null>(null)
  const fieldRef = ref<{ focus: () => void } | null>(null)

  const announcement = ref('')
  const say = (text: string) => (announcement.value = text)

  const wordFor = describe
  const lengthName = (m: number) =>
    m === Infinity ? 'with no end' : m === 1 ? 'for 1 minute' : `for ${m} minutes`

  // ── choosing ────────────────────────────────────────────────────────────────────────
  // a seed from an opened project, used by the next Begin only (any edit to the journey drops it)
  let seedOverride: number | null = null
  function reset() {
    seedOverride = null
    position.value = 0
    elapsed.value = 0
    info.value = null
  }

  const ordinal = (n: number) => `stop ${n}`

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

  // what a stop carries besides where it sits: its key, grid, density and variation, if it has its own
  const settingsOf = (q: Point) => ({
    ...(q.key === undefined ? {} : { key: q.key }),
    ...(q.grid === undefined ? {} : { grid: q.grid }),
    ...(q.density === undefined ? {} : { density: q.density }),
    ...(q.variation === undefined ? {} : { variation: q.variation }),
    ...(q.bars === undefined ? {} : { bars: q.bars }),
  })

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
  // Length is for the whole drift: 15% settled where you are, 30% arriving where you are going
  // (ending in the fade), and the middle 55% travelling — split between the legs, with a brief
  // settle (a third of a leg) at each stop in between so every mood is heard. ∞ travels over
  // ten minutes, then stays.
  function planFor(pts: Point[], m: number, tonics: number[]) {
    const endless = m === Infinity
    const total = (endless ? 10 : m) * 60
    // a later stop may set the pulse's grid and density, and every sound's variation; the first stop's are the sound menu's
    const moods = pts.map((p, i) => ({
      rung: rungFor(p.v),
      arousal: p.a,
      tonic: tonics[i],
      variation: i > 0 ? p.variation : variationChoice.value,
      ...(i > 0 ? { grid: p.grid, density: p.density } : {}),
      bars: i > 0 ? p.bars : barsChoice.value, // clusters (the pulse: patterns) change every n bars, or 0 for free time
    }))
    const n = moods.length
    if (n === 1) return { waypoints: [{ ...moods[0], hold: endless ? Infinity : total }], walk: 0 }
    const leg = (total * 0.55) / (n - 1 + 0.3 * (n - 2))
    return {
      waypoints: moods.map((mood, i) => ({
        ...mood,
        hold: i === 0 ? total * 0.15 : i === n - 1 ? (endless ? Infinity : total * 0.3) : leg * 0.3,
      })),
      walk: leg,
    }
  }

  function begin() {
    if (!points.value.length || drifting.value) return
    clearTimeout(audioTeardown)
    const forcedSeed = seedOverride
    reset()
    // each stop's key: the first is the journey's (chosen, or a fresh one each drift); a later stop
    // with none chosen keeps the key of the stop before it
    const tonics: number[] = []
    points.value.forEach((p, i) =>
      tonics.push(i === 0 ? rootChoice.value ?? Math.floor(Math.random() * 12) : p.key ?? tonics[i - 1])
    )
    plan.value = { ...planFor(points.value, minutes.value, tonics), tonic: tonics[0] }
    seed.value = forcedSeed ?? Math.floor(Math.random() * 2 ** 31)
    const pulse = VOICES[voiceId.value]?.style === 'pulse'
    driftBpm.value = effectiveBpm.value
    totalSeconds.value = layoutTimeline(plan.value.waypoints, plan.value.walk, plan.value.tonic, driftBpm.value).duration
    driftGrid.value = pulse ? gridChoice.value : undefined
    driftDensity.value = pulse ? densityChoice.value : undefined
    const uniform = tonics.every((t) => t === tonics[0])
    const stages: Stage[] = []
    plan.value.waypoints.forEach((w, i) => {
      const last = stages[stages.length - 1]
      if (last && last.rung === w.rung && last.key === tonics[i]) last.to = i
      else {
        const mode = LADDER[w.rung]
        stages.push({ mode, key: tonics[i], label: uniform ? mode : `${NOTE_NAMES[tonics[i]]} ${mode}`, rung: w.rung, from: i, to: i })
      }
    })
    layout.value = layoutTimeline(plan.value.waypoints, plan.value.walk, plan.value.tonic, driftBpm.value)
    // the tempo is shown where it matters: the pulse plays to it, and bars are counted in it
    const onBars = plan.value.waypoints.some((w) => w.bars)
    // a stop's chord setting that does not fit its stretch of the journey is eased to the longest that does
    const L = layout.value
    const eased = L.bars.flatMap((b, i) => (b !== L.barsAsked[i] ? [{ stop: i, asked: L.barsAsked[i] as Bars, got: b as Bars }] : []))
    info.value = {
      key: NOTE_NAMES[tonics[0]],
      uniform,
      stages,
      bpm: pulse || onBars ? driftBpm.value : undefined,
      bars: L.barSeconds && Number.isFinite(L.duration) ? Math.round(L.duration / L.barSeconds) : undefined,
      eased: eased.length > 0,
      seed: `seed ${seed.value}`,
    }
    lastDrift = {
      voiceId: voiceId.value,
      plan: plan.value,
      seed: seed.value,
      bpm: driftBpm.value,
      grid: driftGrid.value,
      density: driftDensity.value,
      stops: points.value.map(wordFor).join(' > '),
      minutes: minutes.value,
      key: info.value.key,
      head: uniform ? info.value.key : '',
      modes: stages.map((st) => st.label),
      points: points.value.map((p) => ({ ...p })),
      words: points.value.map(wordFor),
    }
    session.value++
    audioActive.value = true
    drifting.value = true
    preview.value = null
    const words = points.value.map(wordFor)
    const route =
      words.length === 1
        ? `in ${words[0]}`
        : `from ${words[0]}${words.length > 2 ? ` through ${words.slice(1, -1).join(', ')}` : ''} to ${words[words.length - 1]}`
    say(
      `Drifting ${route} ${lengthName(minutes.value)}, ${uniform ? `in ${NOTE_NAMES[tonics[0]]}` : `from ${NOTE_NAMES[tonics[0]]} to ${NOTE_NAMES[tonics[tonics.length - 1]]}`}${pulse || onBars ? `, ${driftBpm.value} beats per minute` : ''}${onBars && barsChoice.value ? `, a new ${pulse ? 'pattern' : 'cluster'} ${BARS_NAME[barsChoice.value]}` : ''}.` +
        eased.map((e) => ` ${pulse ? 'Pattern' : 'Chords'} at ${ordinal(e.stop + 1)} eased from ${BARS_NAME[e.asked]} to ${BARS_NAME[e.got]}, to fit.`).join('')
    )
  }

  function onProgress(newPosition: number, _text: number, seconds: number) {
    position.value = newPosition
    elapsed.value = seconds
  }

  function saveProject() {
    if (!lastDrift) return
    const d = lastDrift
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
    seedOverride = p.seed
    say(`Project opened: ${p.stops.length === 1 ? '1 stop' : `${p.stops.length} stops`}, ${NOTE_NAMES[p.root]}. Press begin.`)
  }

  async function exportMidi() {
    if (!lastDrift || exporting.value) return
    exporting.value = 'saving…'
    try {
      const d = lastDrift
      const score = scoreFor(VOICES[d.voiceId], d.plan, d.seed, { bpm: d.bpm, grid: d.grid, density: d.density })
      const bytes = await midiBytes(score, { voice: VOICES[d.voiceId].label, seed: d.seed, stops: d.stops, minutes: d.minutes, feel: d.grid && d.density ? `${GRID_LABEL[d.grid]} ${d.density}` : undefined })
      download(bytes, exportName(d.head, d.modes, d.bpm, 'mid'), 'audio/midi')
      say(`MIDI file saved: ${d.head ? d.head + ' ' : ''}${d.modes.join(' to ')}.`)
    } catch {
      say('Sorry, the MIDI file could not be made.')
    } finally {
      exporting.value = ''
    }
  }

  // Clips for a DAW's clip view (Ableton Session View, Logic Live Loops), in one zip: a cluster on
  // bars for the sustained voices, a four-bar phrase for the pulse. Free time has nowhere to cut.
  const canClips = computed(() => {
    const L = layout.value
    return !!info.value && (driftGrid.value !== undefined || !!L?.bars.some((b) => b > 0))
  })
  async function exportClips() {
    if (!lastDrift || exporting.value) return
    if (!canClips.value) {
      say('Clips need chords on bars (1, 2, 4 or 8) or the pulse: free time has no bar lines to cut on.')
      return
    }
    exporting.value = 'saving…'
    try {
      const d = lastDrift
      const voice = VOICES[d.voiceId]
      const score = scoreFor(voice, d.plan, d.seed, { bpm: d.bpm, grid: d.grid, density: d.density })
      const files = await clipFiles(score, { voice: voice.label, seed: d.seed, stops: d.stops, minutes: d.minutes, feel: d.grid && d.density ? `${GRID_LABEL[d.grid]} ${d.density}` : undefined }, d.words)
      if (!files.length) {
        say('There was nothing to cut into clips.')
        return
      }
      download(zipStored(files), exportName(d.head, d.modes, d.bpm, 'zip', `${d.voiceId}-clips`), 'application/zip')
      say(`${files.length - 1} clips saved: ${d.head ? d.head + ' ' : ''}${d.modes.join(' to ')}.`)
    } catch {
      say('Sorry, the clips could not be made.')
    } finally {
      exporting.value = ''
    }
  }

  // The audio is rendered offline, faster than real time; it cannot run beside a live drift
  // (the offline context takes over Tone's clock), so it waits until the sound has stopped.
  async function exportWav() {
    if (!lastDrift || exporting.value || audioActive.value) return
    exporting.value = 'rendering…'
    say('Rendering the audio. This can take a little while.')
    try {
      const d = lastDrift
      const voice = VOICES[d.voiceId]
      const bytes = await renderDriftWav(voice, d.plan, d.seed, { bpm: d.bpm, grid: d.grid, density: d.density }, (p) => {
        exporting.value = p.stage === 'loading' ? 'loading…' : `rendering ${Math.round(p.done * 100)}%`
      })
      download(bytes, exportName(d.head, d.modes, d.bpm, 'wav'), 'audio/wav')
      say(`Audio file saved: ${d.head ? d.head + ' ' : ''}${d.modes.join(' to ')}.`)
    } catch {
      say('Sorry, the audio could not be rendered.')
    } finally {
      exporting.value = ''
    }
  }

  // Several seeds of this journey in one zip: the same stops, key, tempo, length and sound, a
  // different seed in each, so the files fit together in a DAW (the modes change at the same
  // moments in all of them) without repeating each other's notes. The seeds run on from this
  // drift's own, so the first file is what was just heard.
  async function exportVariations(count: number, format: 'mid' | 'wav') {
    if (!lastDrift || exporting.value || (format === 'wav' && audioActive.value)) return
    const d = lastDrift
    const voice = VOICES[d.voiceId]
    const files: ZipFile[] = []
    const tempo = { bpm: d.bpm, grid: d.grid, density: d.density }
    exporting.value = format === 'wav' ? 'loading…' : 'saving…'
    say(format === 'wav' ? `Rendering ${count} variations. This can take a while.` : `Making ${count} variations.`)
    try {
      for (let k = 0; k < count; k++) {
        const seed = (d.seed + k) % 2 ** 31
        const of = `${k + 1}/${count}`
        let bytes: Uint8Array
        if (format === 'mid') {
          exporting.value = `saving ${of}`
          await new Promise((r) => setTimeout(r)) // let the label show
          const score = scoreFor(voice, d.plan, seed, tempo)
          bytes = await midiBytes(score, { voice: voice.label, seed, stops: d.stops, minutes: d.minutes, feel: d.grid && d.density ? `${GRID_LABEL[d.grid]} ${d.density}` : undefined })
        } else {
          bytes = await renderDriftWav(voice, d.plan, seed, tempo, (p) => {
            exporting.value = p.stage === 'loading' ? 'loading…' : `rendering ${of} ${Math.round(p.done * 100)}%`
          })
        }
        files.push({ name: exportName(d.head, d.modes, d.bpm, format, `${d.voiceId}-seed${seed}`), data: bytes })
      }
      const name = exportName(d.head, d.modes, d.bpm, 'zip', `${d.voiceId}-${count}-seeds`)
      download(zipStored(files), name, 'application/zip')
      say(`${count} variations saved: ${d.head ? d.head + ' ' : ''}${d.modes.join(' to ')}.`)
    } catch {
      say('Sorry, the variations could not be made.')
    } finally {
      exporting.value = ''
    }
  }

  // The mode and key sounding now: the start, moved by every step made so far.
  const nowState = computed(() => (layout.value ? stateAt(layout.value, elapsed.value) : null))
  // Which label to mark: among the stages in this mode and key, the one nearest the travelling
  // point. While passing through a mode or key that is not a stop (a long walk), nothing is marked.
  const activeStage = computed(() => {
    const now = nowState.value
    if (!info.value || !now || (!drifting.value && elapsed.value === 0)) return -1 // nothing is sounding
    let best = -1
    let gap = Infinity
    info.value.stages.forEach((st, i) => {
      if (st.rung !== now.rung || st.key !== now.tonic) return
      const d = position.value < st.from ? st.from - position.value : position.value > st.to ? position.value - st.to : 0
      if (d < gap) {
        gap = d
        best = i
      }
    })
    return best
  })
  // between two stops a long walk passes through modes and keys that have no label: say which
  const passing = computed(() => {
    const now = nowState.value
    if (!drifting.value || !info.value || !now || activeStage.value >= 0) return '\u00a0'
    return `passing ${info.value.uniform ? '' : NOTE_NAMES[now.tonic] + ' '}${LADDER[now.rung]}`
  })
  watch(activeStage, (i, before) => {
    if (drifting.value && i >= 0 && i !== before && info.value) say(`Now in ${info.value.stages[i].label}.`)
  })

  // ── a stop's key ────────────────────────────────────────────────────────────────────
  // The first stop's key is the journey's (also set in the sound menu); a later stop's is its own,
  // or none, which keeps the key of the stop before.
  const stopKeys = computed<(number | null)[]>(() => [
    rootChoice.value,
    ...points.value.slice(1).map((p) => p.key ?? null),
  ])
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
  const isPulse = computed(() => VOICES[voiceId.value]?.style === 'pulse')
  const stopGrids = computed<(Grid | null)[]>(() => [gridChoice.value, ...points.value.slice(1).map((p) => p.grid ?? null)])
  const stopDensities = computed<(Density | null)[]>(() => [
    densityChoice.value,
    ...points.value.slice(1).map((p) => p.density ?? null),
  ])
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
  const stopVariations = computed<(Variation | null)[]>(() => [variationChoice.value, ...points.value.slice(1).map((p) => p.variation ?? null)])
  const setStopGrid = (i: number, g: Grid | null) => setStopFeel(i, 'grid', g)
  const setStopDensity = (i: number, d: Density | null) => setStopFeel(i, 'density', d)
  const setStopVariation = (i: number, v: Variation | null) => setStopFeel(i, 'variation', v)
  const stopBars = computed<(Bars | null)[]>(() => [barsChoice.value, ...points.value.slice(1).map((p) => p.bars ?? null)])
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

  const progress = computed(() =>
    drifting.value && Number.isFinite(totalSeconds.value)
      ? Math.min(1, Math.max(0, elapsed.value / totalSeconds.value))
      : null
  )

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

    <p class="hint" :class="{ journey: !!info }" :style="vars(topInk)" aria-hidden="true">
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
        <span class="seed">{{ info.seed }}</span>
        <span class="seed passing">{{ passing }}</span>
      </template>
    </p>

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
        :can-clips="canClips"
        @midi="exportMidi"
        @wav="exportWav"
        @save="saveProject"
        @variations="exportVariations"
        @clips="exportClips"
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
  .field-app .hint .seed {
    display: block;
    margin-top: 2px;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
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
