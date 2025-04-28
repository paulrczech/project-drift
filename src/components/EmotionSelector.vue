<script setup lang="ts">
  import { ref, watch } from 'vue'
  import Multiselect from 'vue-multiselect'
  import { emotionProfiles } from '../data/EmotionConfig'

  const emit = defineEmits<{
    (e: 'submit:selected', emotions: string[]): void
    (e: 'end:drift'): void
  }>()

  const selectedEmotions = ref<string[]>([])
  const isSelected = ref(false)

  const emotionOptions = emotionProfiles.map((profile) => profile.label)

  function reset() {
    selectedEmotions.value = []
    isSelected.value = false
  }

  defineExpose({
    reset,
  })

  function handleSubmit() {
    if (selectedEmotions.value.length === 0) return
    emit('submit:selected', selectedEmotions.value)
    isSelected.value = true
  }

  function handleEndDrift() {
    emit('end:drift')
    selectedEmotions.value = []
    isSelected.value = false
  }
  watch(selectedEmotions, (newVal) => {
    if (newVal.length > 2) {
      selectedEmotions.value = newVal.slice(0, 2)
    }
  })
</script>

<template>
  <div class="selector-wrapper">
    <Multiselect
      v-model="selectedEmotions"
      :options="emotionOptions"
      :multiple="true"
      :close-on-select="false"
      :clear-on-select="false"
      :allow-empty="true"
      :disabled="isSelected"
      placeholder="Please select 1 or 2 emotions" />

    <button
      v-if="!isSelected"
      class="submit-button"
      @click="handleSubmit"
      :disabled="selectedEmotions.length === 0">
      Start Drift
    </button>

    <button v-if="isSelected" class="end-button" @click="handleEndDrift">
      End Drift
    </button>
  </div>
</template>

<style scoped>
  .selector-wrapper {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .multiselect {
    width: auto;
    min-width: 300px;
    font-size: 1rem;
  }

  .submit-button {
    padding: 0.5rem 1rem;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    font-size: 0.875rem;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
  }

  .submit-button:disabled {
    background-color: rgba(0, 0, 0, 0.4);
    cursor: not-allowed;
  }

  .submit-button:hover:enabled {
    background-color: rgba(0, 0, 0, 1);
  }

  .end-button {
    padding: 0.5rem 1rem;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    font-size: 0.875rem;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
  }

  .end-button:hover {
    background-color: rgba(0, 0, 0, 1);
  }
</style>
