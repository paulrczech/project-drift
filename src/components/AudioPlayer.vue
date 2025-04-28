<script setup lang="ts">
  import { onMounted, onUnmounted } from 'vue'
  import * as Tone from 'tone'

  interface Props {
    samplesA: string[]
    samplesB: string[]
    crossfadeInterval?: number // in ms, default 8000
  }

  const props = defineProps<Props>()

  defineExpose({
    stopDrift,
  })

  // Calculate durations in seconds
  const period = (props.crossfadeInterval ?? 8000) / 1000
  const fadeDur = period * 0.3 // 30% of cycle used for fade overlap
  const soloDur = period - fadeDur // remaining time for solo playback

  let playerA: Tone.Player
  let playerB: Tone.Player
  let crossFade: Tone.CrossFade
  let reverb: Tone.Reverb
  let delay: Tone.FeedbackDelay
  let gainNode: Tone.Gain
  let loop: Tone.Loop

  async function stopDrift() {
    const now = Tone.now()

    // Smooth fade out
    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(gainNode.gain.value, now) // Start from current
    gainNode.gain.linearRampToValueAtTime(0, now + 3) // Fade to silence in 3 seconds

    // Stop after fade completes
    setTimeout(() => {
      Tone.Transport.stop()
      playerA.stop()
      playerB.stop()
    }, 3000) // matches fade duration
  }

  onMounted(async () => {
    await Tone.start()

    // Pick random samples (or fallback to same)
    const sampleA =
      props.samplesA[Math.floor(Math.random() * props.samplesA.length)]
    const sampleB = props.samplesB.length
      ? props.samplesB[Math.floor(Math.random() * props.samplesB.length)]
      : sampleA

    // Initialize players and enable looping
    playerA = new Tone.Player(`/sounds/${sampleA}`)
    playerB = new Tone.Player(`/sounds/${sampleB}`)
    playerA.loop = true
    playerB.loop = true

    await Tone.loaded()

    // Crossfade node between two players
    crossFade = new Tone.CrossFade(0)

    // Ambient effects
    reverb = new Tone.Reverb({ decay: 8, wet: 0.9 })
    delay = new Tone.FeedbackDelay('8n', 0.5)

    // Master gain for overall level
    gainNode = new Tone.Gain(0).toDestination()

    // Connect audio graph
    playerA.connect(crossFade.a)
    playerB.connect(crossFade.b)
    crossFade.connect(gainNode)
    crossFade.connect(reverb)
    crossFade.connect(delay)
    reverb.connect(gainNode)
    delay.connect(gainNode)

    // Sync players to Transport for seamless loop
    playerA.sync().start(0)
    playerB.sync().start(0)
    Tone.Transport.start()

    // Smoothly fade in the gain over time
    const now = Tone.now()
    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(0, now)
    gainNode.gain.linearRampToValueAtTime(0.5, now + 3)

    // Schedule repeating crossfade with precise timing
    loop = new Tone.Loop((time) => {
      const current = crossFade.fade.value
      const next = current < 0.5 ? 1 : 0
      crossFade.fade.setValueAtTime(current, time)
      crossFade.fade.rampTo(next, fadeDur, time + soloDur)
    }, period).start(0)
  })

  onUnmounted(() => {
    loop.dispose()
    playerA.dispose()
    playerB.dispose()
    crossFade.dispose()
    reverb.dispose()
    delay.dispose()
    gainNode.dispose()
    Tone.Transport.stop()
  })
</script>

<template>
  <!-- No visual needed -->
</template>
