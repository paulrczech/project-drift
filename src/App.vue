<script setup lang="ts">
  import { ref } from 'vue'
  import EmotionSelector from './components/EmotionSelector.vue'
  import EmotionalSnippet from './components/EmotionalSnippet.vue'
  import BreathingBackground from './components/BreathingBackground.vue'
  import AudioPlayer from './components/AudioPlayer.vue'
  import { emotionProfiles } from './data/EmotionConfig'

  const hasSelected = ref(false)
  const isFadingOut = ref(false)

  const isDrifting = ref(false)
  const audioPlayerRef = ref<InstanceType<typeof AudioPlayer> | null>(null)
  const emotionSelectorRef = ref<InstanceType<typeof EmotionSelector> | null>(
    null
  )

  // Selected visual/audio/text properties
  const defaultMessage = 'Welcome to Drift.'
  const backgroundA = ref('')
  const backgroundB = ref('')
  const snippetA = ref(defaultMessage)
  const snippetB = ref('')
  const samplesA = ref<string[]>([])
  const samplesB = ref<string[]>([])

  const currentEmotion = ref<string>('')

  const crossfadeInterval = ref(4000)

  function handleSubmit(selectedEmotions: string[]) {
    if (!selectedEmotions.length) return

    isFadingOut.value = true
    hasSelected.value = true
    isDrifting.value = true

    currentEmotion.value = selectedEmotions[0] ?? ''

    const selectedProfiles = emotionProfiles.filter((profile) =>
      selectedEmotions.includes(profile.label)
    )

    backgroundA.value = selectedProfiles[0]?.background ?? ''
    backgroundB.value = selectedProfiles[1]?.background ?? backgroundA.value

    snippetA.value = selectedProfiles[0]?.snippet ?? ''
    snippetB.value = selectedProfiles[1]?.snippet ?? snippetA.value

    if (selectedProfiles.length === 1) {
      samplesA.value = [selectedProfiles[0].samples[0]]
      samplesB.value = [selectedProfiles[0].samples[1]]
    } else {
      samplesA.value = selectedProfiles[0]?.samples ?? []
      samplesB.value = selectedProfiles[1]?.samples ?? []
    }
  }

  function stopDrift() {
    audioPlayerRef.value?.stopDrift()
    emotionSelectorRef.value?.reset()
    isDrifting.value = false
    isFadingOut.value = true
    hasSelected.value = false
    snippetA.value = defaultMessage
    snippetB.value = ''
    backgroundA.value = ''
    backgroundB.value = ''
    currentEmotion.value = ''
  }
</script>

<template>
  <BreathingBackground :currentEmotion="currentEmotion" gradientType="radial" />

  <div class="app-container">
    <EmotionalSnippet
      :snippetA="snippetA"
      :snippetB="snippetB"
      :crossfadeInterval="crossfadeInterval" />

    <div class="emotion-bar">
      <EmotionSelector
        ref="emotionSelectorRef"
        @submit:selected="handleSubmit"
        @end:drift="stopDrift" />

      <AudioPlayer
        v-if="hasSelected"
        ref="audioPlayerRef"
        :samplesA="samplesA"
        :samplesB="samplesB"
        :crossfadeInterval="crossfadeInterval"
        :playerOffset="2" />
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
