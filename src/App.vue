<script setup lang="ts">
  import { ref } from 'vue'
  import EmotionSelector from './components/EmotionSelector.vue'
  import EmotionalSnippet from './components/EmotionalSnippet.vue'
  import BreathingBackground from './components/BreathingBackground.vue'
  import AudioPlayer from './components/AudioPlayer.vue'
  import { emotionProfiles } from './data/EmotionConfig'

  const hasSelected = ref(false)
  // The audio outlives "End Drift" by its fade-out; `session` remounts it on restart
  const audioActive = ref(false)
  const session = ref(0)
  let audioTeardown: number | undefined
  const isFadingOut = ref(false)

  const isDrifting = ref(false)
  const audioPlayerRef = ref<InstanceType<typeof AudioPlayer> | null>(null)
  const emotionSelectorRef = ref<InstanceType<typeof EmotionSelector> | null>(
    null
  )

  // Selected visual/audio/text properties
  const defaultMessage = 'Welcome to Drift.'
  const emotionA = ref('')
  const emotionB = ref('')
  const snippetA = ref(defaultMessage)
  const snippetB = ref('')
  const samplesA = ref<string[]>([])
  const samplesB = ref<string[]>([])

  // The audio Transport drives the cycle; text and visuals follow its fade events
  const activeSide = ref<'A' | 'B'>('A')
  const fadeSeconds = ref(0)

  const crossfadeInterval = ref(16000)

  function handleFade(to: 'A' | 'B', seconds: number) {
    fadeSeconds.value = seconds
    activeSide.value = to
  }

  function handleSubmit(selectedEmotions: string[]) {
    if (!selectedEmotions.length) return

    isFadingOut.value = true
    hasSelected.value = true
    isDrifting.value = true
    clearTimeout(audioTeardown)
    session.value++
    audioActive.value = true

    // Keep the user's pick order so A is always the first emotion chosen
    const selectedProfiles = selectedEmotions
      .map((label) => emotionProfiles.find((profile) => profile.label === label))
      .filter((profile) => profile !== undefined)

    activeSide.value = 'A'
    fadeSeconds.value = (crossfadeInterval.value / 1000) * 0.3

    emotionA.value = selectedProfiles[0].label
    emotionB.value = selectedProfiles[1]?.label ?? ''

    snippetA.value = selectedProfiles[0].snippet
    snippetB.value = selectedProfiles[1]?.snippet ?? ''

    if (selectedProfiles.length === 1) {
      samplesA.value = [selectedProfiles[0].samples[0]]
      samplesB.value = [selectedProfiles[0].samples[1]]
    } else {
      samplesA.value = selectedProfiles[0].samples
      samplesB.value = selectedProfiles[1].samples
    }
  }

  function stopDrift() {
    audioPlayerRef.value?.stopDrift()
    emotionSelectorRef.value?.reset()
    isDrifting.value = false
    isFadingOut.value = true
    hasSelected.value = false
    // Unmount only after the 3s audio fade, or the player is disposed mid-fade
    audioTeardown = window.setTimeout(() => (audioActive.value = false), 3100)
    snippetA.value = defaultMessage
    snippetB.value = ''
    emotionA.value = ''
    emotionB.value = ''
    activeSide.value = 'A'
  }
</script>

<template>
  <BreathingBackground
    :emotionA="emotionA"
    :emotionB="emotionB"
    :activeSide="activeSide"
    :fadeSeconds="fadeSeconds"
    gradientType="radial" />

  <div class="app-container">
    <EmotionalSnippet
      :snippetA="snippetA"
      :snippetB="snippetB"
      :activeSide="activeSide"
      :fadeSeconds="fadeSeconds" />

    <div class="emotion-bar">
      <EmotionSelector
        ref="emotionSelectorRef"
        @submit:selected="handleSubmit"
        @end:drift="stopDrift" />

      <AudioPlayer
        v-if="audioActive"
        :key="session"
        ref="audioPlayerRef"
        :samplesA="samplesA"
        :samplesB="samplesB"
        :crossfadeInterval="crossfadeInterval"
        @fade="handleFade" />
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
