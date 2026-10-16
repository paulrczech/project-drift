<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { emotionPalettes } from '../data/EmotionGradient'

  interface Props {
    emotions: string[] // in journey order; empty when idle
    position: number // fractional index along `emotions`: 0 = first, 1 = second, 0.5 = halfway
    fadeSeconds: number // how smoothly a layer follows `position`
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

  // The resting gradient sits underneath; the emotions stack on top of it.
  const idleGradient = getGradient(defaultColors, props.gradientType ?? 'random')

  // Layers keep their last gradients, so the stack can fade out after the emotions
  // are cleared instead of vanishing.
  const gradients = ref<string[]>([])
  watch(
    () => props.emotions,
    (emotions) => {
      if (!emotions.length) return
      gradients.value = emotions.map((emotion) =>
        getGradient(
          emotionPalettes[emotion.toLowerCase()] ?? ['#ccc', '#eee'],
          props.gradientType ?? 'random'
        )
      )
    },
    { immediate: true }
  )

  const active = computed(() => props.emotions.length > 0)

  // The first emotion is opaque; each later one fades in over the one before as the
  // drift reaches it. Fading over an opaque layer (not against its neighbour) means the
  // resting gradient never shows through mid-fade.
  const layerOpacity = (i: number) =>
    i === 0 ? 1 : Math.min(1, Math.max(0, props.position - (i - 1)))
</script>

<template>
  <div class="background-layer">
    <div class="breathing-background" :style="{ background: idleGradient }"></div>
  </div>
  <div class="background-layer stack" :style="{ opacity: active ? 1 : 0 }">
    <div
      v-for="(gradient, i) in gradients"
      :key="i"
      class="background-layer"
      :style="{
        opacity: layerOpacity(i),
        transitionDuration: props.fadeSeconds + 's',
      }">
      <div class="breathing-background" :style="{ background: gradient }"></div>
    </div>
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

  /* Updates arrive a few times a second, so layers follow them linearly:
     ease-in-out would pulse at every update. */
  .stack {
    transition-duration: 3s;
  }

  .stack > .background-layer {
    z-index: auto;
    transition-timing-function: linear;
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
