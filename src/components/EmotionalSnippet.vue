<script setup lang="ts">
  interface Props {
    snippets: string[] // in journey order
    index: number // which one is showing
    fadeSeconds: number
  }

  const props = defineProps<Props>()
</script>

<template>
  <div class="snippet-container" :style="{ '--fade': props.fadeSeconds + 's' }">
    <p
      v-for="(snippet, i) in props.snippets"
      :key="i"
      class="snippet-text"
      :class="{ active: i === props.index }">
      {{ snippet }}
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
    transition: opacity var(--fade, 4s) ease-in-out;
  }

  /* Active snippet fades in */
  .snippet-text.active {
    opacity: 1;
  }
</style>
