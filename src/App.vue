<script setup lang="ts">
  import { defineAsyncComponent, ref } from 'vue'
  import EmotionSelector from './components/EmotionSelector.vue'
  import EmotionalSnippet from './components/EmotionalSnippet.vue'
  import BreathingBackground from './components/BreathingBackground.vue'
  import { emotionProfiles } from './data/EmotionConfig'
  import { MOODS, rungFor } from './engine/moods'
  import type { TimelinePlan } from './engine/compose'

  // Tone.js is large and only needed once a drift starts, so the players load on demand.
  const GenerativePlayer = defineAsyncComponent(
    () => import('./components/GenerativePlayer.vue')
  )
  const AudioPlayer = defineAsyncComponent(
    () => import('./components/AudioPlayer.vue')
  )

  // `?engine=loops` plays the original recorded loops, for comparing the two.
  const useLoops = new URLSearchParams(window.location.search).get('engine') === 'loops'

  const hasSelected = ref(false)
  // The audio outlives "End Drift" by its fade-out; `session` remounts it on restart
  const audioActive = ref(false)
  const session = ref(0)
  let audioTeardown: number | undefined

  const playerRef = ref<{ stopDrift: () => void } | null>(null)
  const emotionSelectorRef = ref<InstanceType<typeof EmotionSelector> | null>(
    null
  )

  // Text and visuals follow the audio clock. `emotions` can hold any number, in
  // journey order; `position` is the fractional index along them (0.5 = halfway
  // from the first to the second), `textIndex` which one's line is showing.
  const defaultMessage = 'Welcome to Drift.'
  const emotions = ref<string[]>([])
  const snippets = ref<string[]>([defaultMessage])
  const position = ref(0)
  const textIndex = ref(0)
  const backgroundFade = ref(0.5)
  const textFade = ref(6)

  // Generative drift
  const plan = ref<Omit<TimelinePlan, 'rng'>>({ waypoints: [], walk: 0 })
  const seed = ref(0)

  // Loops (original engine)
  const samplesA = ref<string[]>([])
  const samplesB = ref<string[]>([])
  const crossfadeInterval = ref(16000)

  function handleProgress(newPosition: number, newTextIndex: number) {
    position.value = newPosition
    textIndex.value = newTextIndex
  }

  function handleFade(to: 'A' | 'B', seconds: number) {
    backgroundFade.value = seconds
    textFade.value = seconds
    position.value = to === 'A' ? 0 : 1
    textIndex.value = position.value
  }

  // One journey: settle for a fifth of its length, walk through the middle three
  // fifths, then stay with the last emotion until the drift is ended.
  function planFor(rungs: number[], minutes: number) {
    if (rungs.length === 1) return { waypoints: [{ rung: rungs[0], hold: Infinity }], walk: 0 }
    const total = minutes * 60
    return {
      waypoints: rungs.map((rung, i) => ({
        rung,
        hold: i === 0 ? total * 0.2 : i === rungs.length - 1 ? Infinity : 0,
      })),
      walk: (total * 0.6) / (rungs.length - 1),
    }
  }

  function handleSubmit(selectedEmotions: string[], journeyMinutes: number) {
    if (!selectedEmotions.length) return

    hasSelected.value = true
    clearTimeout(audioTeardown)
    session.value++
    audioActive.value = true

    // Keep the user's pick order: the journey runs from the first emotion chosen
    const profiles = selectedEmotions
      .map((label) => emotionProfiles.find((profile) => profile.label === label))
      .filter((profile) => profile !== undefined)

    emotions.value = profiles.map((profile) => profile.label)
    snippets.value = profiles.map((profile) => profile.snippet)
    position.value = 0
    textIndex.value = 0

    if (useLoops) {
      backgroundFade.value = (crossfadeInterval.value / 1000) * 0.3
      textFade.value = backgroundFade.value
      const [a, b] = profiles
      samplesA.value = b ? a.samples : [a.samples[0]]
      samplesB.value = b ? b.samples : [a.samples[1]]
      return
    }

    backgroundFade.value = 0.5
    textFade.value = 6
    plan.value = {
      ...planFor(
        emotions.value.map((label) => rungFor(MOODS[label].valence)),
        journeyMinutes
      ),
      tonic: Math.floor(Math.random() * 12), // a fresh key each time, never shown
    }
    seed.value = Math.floor(Math.random() * 2 ** 31)
    console.info('drift', { emotions: emotions.value, journeyMinutes, tonic: plan.value.tonic, seed: seed.value })
  }

  function stopDrift() {
    playerRef.value?.stopDrift()
    emotionSelectorRef.value?.reset()
    hasSelected.value = false
    // Unmount only after the 3s audio fade, or the player is disposed mid-fade
    audioTeardown = window.setTimeout(() => (audioActive.value = false), 3100)
    emotions.value = []
    snippets.value = [defaultMessage]
    position.value = 0
    textIndex.value = 0
  }
</script>

<template>
  <BreathingBackground
    :emotions="emotions"
    :position="position"
    :fadeSeconds="backgroundFade"
    gradientType="radial" />

  <div class="app-container">
    <EmotionalSnippet
      :snippets="snippets"
      :index="textIndex"
      :fadeSeconds="textFade" />

    <div class="emotion-bar">
      <EmotionSelector
        ref="emotionSelectorRef"
        @submit:selected="handleSubmit"
        @end:drift="stopDrift" />

      <template v-if="audioActive">
        <AudioPlayer
          v-if="useLoops"
          :key="session"
          ref="playerRef"
          :samplesA="samplesA"
          :samplesB="samplesB"
          :crossfadeInterval="crossfadeInterval"
          @fade="handleFade" />
        <GenerativePlayer
          v-else
          :key="session"
          ref="playerRef"
          :plan="plan"
          :seed="seed"
          @progress="handleProgress" />
      </template>
    </div>
  </div>
</template>

<style>
  .app-container {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .emotion-bar__wrapper {
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 1rem;
  }

  .emotion-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    width: auto;
    padding: 1rem;
  }
</style>
