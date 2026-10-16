<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { emotionPalettes } from '../data/EmotionGradient'

  interface Props {
    emotionA: string
    emotionB: string
    activeSide: 'A' | 'B'
    fadeSeconds: number
    gradientType?: 'random' | 'linear' | 'radial' | 'conic'
  }

  const props = defineProps<Props>()

  const defaultColors = ['#5C6D7A', '#E8D7F1']

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

  function gradientFor(emotion: string): string {
    const colors = emotionPalettes[emotion.toLowerCase()] ?? ['#ccc', '#eee']
    return getGradient(colors, props.gradientType ?? 'random')
  }

  // The resting gradient sits underneath; A and B fade in over it.
  const idleGradient = getGradient(defaultColors, props.gradientType ?? 'random')
  // Layers always exist and keep their last gradient, so they can fade out
  // after the emotion is cleared instead of vanishing.
  const gradientA = ref('')
  const gradientB = ref('')
  watch(
    () => props.emotionA,
    (emotion) => {
      if (emotion) gradientA.value = gradientFor(emotion)
    },
    { immediate: true }
  )
  watch(
    () => props.emotionB,
    (emotion) => {
      if (emotion) gradientB.value = gradientFor(emotion)
    },
    { immediate: true }
  )

  // With a single emotion there is no B, so A stays put
  const aOn = computed(() => !!props.emotionA && (!props.emotionB || props.activeSide === 'A'))
  const bOn = computed(() => !!props.emotionB && props.activeSide === 'B')
</script>

<template>
  <div class="background-layer">
    <div class="breathing-background" :style="{ background: idleGradient }"></div>
  </div>
  <div
    class="background-layer"
    :style="{ opacity: aOn ? 1 : 0, transitionDuration: props.fadeSeconds + 's' }">
    <div class="breathing-background" :style="{ background: gradientA }"></div>
  </div>
  <div
    class="background-layer"
    :style="{ opacity: bOn ? 1 : 0, transitionDuration: props.fadeSeconds + 's' }">
    <div class="breathing-background" :style="{ background: gradientB }"></div>
  </div>
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
  }

  /* The wrapper fades between A and B; the inner layer breathes, since the
     keyframes animate opacity and would override the wrapper's.
     Only transform and opacity are animated, so Chrome can run it on the
     compositor. Animating background-position repainted three oversized
     gradients every frame and left unrasterized tiles flashing on screen. */
  .breathing-background {
    position: absolute;
    inset: 0;
    background-size: 200% 200%;
    background-position: 50% 50%;
    will-change: transform, opacity;
    animation: breathe 12s ease-in-out infinite;
  }

  @keyframes breathe {
    0% {
      transform: scale(1) translate(0, 0);
      opacity: 1;
    }
    25% {
      transform: scale(2) translate(-2%, -2%);
      opacity: 0.95;
    }
    50% {
      transform: scale(4) translate(-4%, -4%);
      opacity: 0.9;
    }
    75% {
      transform: scale(2) translate(-2%, -2%);
      opacity: 0.95;
    }
    100% {
      transform: scale(1) translate(0, 0);
      opacity: 1;
    }
  }
</style>
