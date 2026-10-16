<script setup lang="ts">
  import { onMounted, onUnmounted } from 'vue'
  import * as Tone from 'tone'

  interface Props {
    samplesA: string[]
    samplesB: string[]
    crossfadeInterval?: number // in ms, default 8000
  }

  const props = defineProps<Props>()

  // The Transport is the shared clock: each fade start is announced here so
  // text and visuals follow the audio instead of running their own timers.
  const emit = defineEmits<{
    (e: 'fade', to: 'A' | 'B', seconds: number): void
  }>()

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
  let side: 'A' | 'B' = 'A'

  // Set once End is clicked or the component unmounts, so a drift that is
  // still loading never starts afterwards.
  let halted = false
  let stopTimer: number | undefined

  function stopDrift() {
    halted = true
    if (!gainNode) return // still loading: nothing audible to fade

    // Stop the cycle so no further fade events reach text and visuals
    loop?.stop()
    Tone.getDraw().cancel(0)

    // Smooth fade out
    const now = Tone.now()
    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(Math.max(0, gainNode.gain.value), now) // Start from current (clamped: mid-ramp reads can dip a hair below 0)
    gainNode.gain.linearRampToValueAtTime(0, now + 3) // Fade to silence in 3 seconds

    // Stop after fade completes
    stopTimer = window.setTimeout(() => {
      Tone.Transport.stop()
      playerA.stop()
      playerB.stop()
    }, 3000) // matches fade duration
  }

  onMounted(async () => {
    await Tone.start()
    if (halted) return

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
    if (halted) return

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
      const to = side === 'A' ? 'B' : 'A'
      side = to
      const fadeStart = time + soloDur
      crossFade.fade.rampTo(to === 'A' ? 0 : 1, fadeDur, fadeStart)
      Tone.getDraw().schedule(() => emit('fade', to, fadeDur), fadeStart)
    }, period).start(0)
  })

  onUnmounted(() => {
    halted = true
    clearTimeout(stopTimer)
    Tone.getDraw().cancel(0)
    loop?.dispose()
    playerA?.dispose()
    playerB?.dispose()
    crossFade?.dispose()
    reverb?.dispose()
    delay?.dispose()
    gainNode?.dispose()
    Tone.Transport.stop()
  })
</script>

<template>
  <!-- No visual needed -->
</template>
