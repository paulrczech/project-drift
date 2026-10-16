<script setup lang="ts">
  import { ref, watch } from 'vue'
  import Multiselect from 'vue-multiselect'
  import { emotionProfiles } from '../data/EmotionConfig'

  const emit = defineEmits<{
    (e: 'submit:selected', emotions: string[], journeyMinutes: number): void
    (e: 'end:drift'): void
  }>()

  const selectedEmotions = ref<string[]>([])
  const isSelected = ref(false)

  // Only a two-emotion drift travels anywhere, so only then is there a length to pick.
  const journeyOptions = [1, 5, 10, 20]
  const journeyMinutes = ref(5)

  const emotionColors: Record<string, string> = {
    happy: 'emotion-happy',
    joyful: 'emotion-joyful',
    grateful: 'emotion-grateful',
    playful: 'emotion-playful',
    cheerful: 'emotion-cheerful',
    content: 'emotion-content',
    hopeful: 'emotion-hopeful',
    peaceful: 'emotion-peaceful',
    serene: 'emotion-serene',
    relaxed: 'emotion-relaxed',
    neutral: 'emotion-neutral',
    reflective: 'emotion-reflective',
    nostalgic: 'emotion-nostalgic',
    bittersweet: 'emotion-bittersweet',
    wistful: 'emotion-wistful',
    longing: 'emotion-longing',
    uneasy: 'emotion-uneasy',
    anxious: 'emotion-anxious',
    melancholy: 'emotion-melancholy',
    depressed: 'emotion-depressed',
    sad: 'emotion-sad',
  }

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
    emit('submit:selected', selectedEmotions.value, journeyMinutes.value)
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
      placeholder="Please select 1 or 2 emotions">
      <template #tag="{ option, remove }">
        <span class="multiselect__tag" :class="emotionColors[option]">
          <span>{{ option }}</span>
          <i class="multiselect__tag-icon" @click="remove(option)"> </i>
        </span>
      </template>
    </Multiselect>

    <div
      v-if="!isSelected && selectedEmotions.length === 2"
      class="journey-length"
      role="group"
      aria-label="Journey length in minutes">
      <button
        v-for="minutes in journeyOptions"
        :key="minutes"
        type="button"
        :class="{ active: minutes === journeyMinutes }"
        :aria-pressed="minutes === journeyMinutes"
        @click="journeyMinutes = minutes">
        {{ minutes }} min
      </button>
    </div>

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

  .journey-length {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem;
    background-color: rgba(0, 0, 0, 0.25);
    border-radius: 1.5rem;
  }

  .journey-length button {
    padding: 0.25rem 0.6rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.75rem;
    border: none;
    border-radius: 1.25rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.3s ease;
  }

  .journey-length button.active {
    background-color: rgba(0, 0, 0, 0.55);
    color: white;
  }

  .submit-button {
    padding: 0.5rem 1rem;
    background-color: #5c6d7a;
    color: white;
    font-size: 0.875rem;
    border: none;
    border-radius: 1.5rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
    white-space: nowrap;
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
    background-color: rgba(0, 0, 0, 0.5);
    color: white;
    font-size: 0.875rem;
    border: none;
    border-radius: 1.5rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
    white-space: nowrap;
  }

  .end-button:hover {
    background-color: rgba(0, 0, 0, 0.6);
  }
</style>
