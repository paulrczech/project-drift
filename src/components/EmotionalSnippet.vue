<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from 'vue'

  interface Props {
    snippetA: string
    snippetB: string
    crossfadeInterval: number
  }

  const props = defineProps<Props>()

  const activeSnippet = ref<'A' | 'B'>('A')
  let intervalId: number | undefined

  onMounted(() => {
    intervalId = window.setInterval(() => {
      activeSnippet.value = activeSnippet.value === 'A' ? 'B' : 'A'
    }, props.crossfadeInterval)
  })

  onUnmounted(() => {
    if (intervalId) {
      clearInterval(intervalId)
    }
  })
</script>

<template>
  <div class="snippet-container">
    <p
      class="snippet-text"
      :class="{ active: activeSnippet === 'A' }"
      v-if="props.snippetA">
      {{ props.snippetA }}
    </p>
    <p
      class="snippet-text"
      :class="{ active: activeSnippet === 'B' }"
      v-if="props.snippetB">
      {{ props.snippetB }}
    </p>
  </div>
</template>

<style scoped>
  .snippet-container {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 80%;
    max-width: 60ch;
    text-align: center;
    pointer-events: none;
    z-index: 2;
  }

  /* Shared style */
  .snippet-text {
    position: absolute;
    width: 100%;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.8rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition: opacity 4s ease-in-out;
  }

  /* Active snippet fades in */
  .snippet-text.active {
    opacity: 1;
  }
</style>
