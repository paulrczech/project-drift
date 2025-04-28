<script setup lang="ts">
  import { ref, watch, computed } from 'vue'
  import { emotionPalettes } from '../data/EmotionGradient'

  interface Props {
    currentEmotion: string
    gradientType?: 'random' | 'linear' | 'radial' | 'conic'
  }

  const props = defineProps<Props>()

  const currentBackground = ref('')
  const previousBackground = ref('')
  const fadingOut = ref(false)

  const effectiveEmotion = computed(() => {
    return props.currentEmotion || 'default'
  })

  const breathingDuration = computed(() => {
    return effectiveEmotion.value === 'default' ? '12s' : '12s'
  })

  function getGradient(
    colors: string[],
    type: 'random' | 'linear' | 'radial' | 'conic'
  ): string {
    let finalType = type
    if (type === 'random') {
      const types: ('linear' | 'radial' | 'conic')[] = [
        'linear',
        'radial',
        'conic',
      ]
      finalType = types[Math.floor(Math.random() * types.length)]
    }

    if (finalType === 'linear') {
      const angles = [45, 90, 135, 225, 270]
      const angle = angles[Math.floor(Math.random() * angles.length)]
      return `linear-gradient(${angle}deg, ${colors.join(', ')})`
    } else if (finalType === 'radial') {
      return `radial-gradient(circle at center, ${colors.join(', ')})`
    } else {
      return `conic-gradient(from 90deg at center, ${colors.join(', ')})`
    }
  }

  watch(
    () => props.currentEmotion,
    (newEmotion) => {
      const isDefault = !newEmotion || newEmotion === 'default'

      const colors = isDefault
        ? ['#2a2a2a', '#1a1a1a']
        : emotionPalettes[newEmotion.toLowerCase()] ?? ['#ccc', '#eee']

      const newGradient = getGradient(colors, props.gradientType ?? 'random')

      if (isDefault) {
        previousBackground.value = newGradient
        currentBackground.value = newGradient
        fadingOut.value = false
      } else {
        previousBackground.value = currentBackground.value
        currentBackground.value = newGradient
        fadingOut.value = true
        setTimeout(() => {
          fadingOut.value = false
        }, 1000)
      }
    },
    { immediate: true }
  )

  // Set initial background manually at startup
  if (!props.currentEmotion) {
    const colors = ['#2a2a2a', '#1a1a1a']
    currentBackground.value = getGradient(
      colors,
      props.gradientType ?? 'random'
    )
  }
</script>

<template>
  <div
    class="background-layer"
    :style="{
      background: currentBackground,
      opacity: fadingOut ? 0 : 1,
      animationDuration: breathingDuration,
    }"></div>
  <div
    class="background-layer breathing-background"
    :style="{
      background: currentBackground,
      opacity: fadingOut ? 0 : 1,
    }"></div>
</template>

<style scoped>
  .background-layer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: -2;
    transition: opacity 1s ease-in-out;
    background-size: 200% 200%;
  }

  .breathing-background {
    animation: breathe 12s ease-in-out infinite;
  }

  @keyframes breathe {
    0% {
      transform: scale(1) translate(0, 0);
      opacity: 1;
      background-position: 50% 50%;
    }
    25% {
      transform: scale(2) translate(1px, 1px);
      opacity: 0.95;
      background-position: 75% 75%;
    }
    50% {
      transform: scale(4) translate(2px, 2px);
      opacity: 0.9;
      background-position: 90% 90%;
    }
    75% {
      transform: scale(2) translate(1px, 1px);
      opacity: 0.95;
      background-position: 75% 75%;
    }
    100% {
      transform: scale(1) translate(0, 0);
      opacity: 1;
      background-position: 50% 50%;
    }
  }
</style>
