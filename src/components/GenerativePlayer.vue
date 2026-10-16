<script setup lang="ts">
  import { onMounted, onUnmounted } from 'vue'
  import {
    Composer,
    layoutTimeline,
    positionAt,
    textIndexAt,
    arousalAt,
    ATTACK,
    RELEASE,
    type TimelinePlan,
  } from '../engine/compose'

  interface Props {
    plan: Omit<TimelinePlan, 'rng'>
    seed: number
  }

  const props = defineProps<Props>()

  // The audio clock is the only clock: every 250ms we report where the drift is, and
  // text and visuals follow.
  const emit = defineEmits<{
    (e: 'progress', position: number, textIndex: number): void
  }>()

  defineExpose({ stopDrift })

  const URLS: Record<string, string> = {
    E2: 'E2.mp3',
    'G#2': 'Gs2.mp3',
    C3: 'C3.mp3',
    E3: 'E3.mp3',
    'G#3': 'Gs3.mp3',
    C4: 'C4.mp3',
    E4: 'E4.mp3',
    'G#4': 'Gs4.mp3',
    C5: 'C5.mp3',
    E5: 'E5.mp3',
    'G#5': 'Gs5.mp3',
    C6: 'C6.mp3',
  }
  const VELOCITY = 0.8
  const LEVEL = 0.5 // the loops ran at 0.5; the pad measured ~4x hotter at 0.8
  const FADE = 3 // seconds, in and out
  // Notes are queued this far ahead. Hidden tabs throttle timers to as little as one
  // tick a minute, so the queue has to outlast that.
  const LOOKAHEAD = 90

  const layout = layoutTimeline(props.plan.waypoints, props.plan.walk)

  type ToneModule = typeof import('tone')
  let Tone: ToneModule
  let sampler: InstanceType<ToneModule['Sampler']> | undefined
  let reverb: InstanceType<ToneModule['Reverb']> | undefined
  let master: InstanceType<ToneModule['Gain']> | undefined
  let composer: Composer
  let t0 = 0 // audio-context time at which the drift began
  let halted = false
  let scheduleTimer: number | undefined
  let progressTimer: number | undefined

  function mulberry(seed: number) {
    let a = seed
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function schedule() {
    const now = Tone.now()
    for (const e of composer.pull(now - t0 + LOOKAHEAD)) {
      const at = t0 + e.time
      const late = Math.max(0, now - at) // after a stall, join the note already in progress
      if (late >= e.hold) continue
      sampler?.triggerAttackRelease(
        Tone.Frequency(e.note, 'midi').toNote(),
        e.hold - late,
        Math.max(at, now),
        VELOCITY
      )
    }
  }

  function report() {
    const t = Math.max(0, Tone.now() - t0)
    emit('progress', positionAt(layout, t), textIndexAt(layout, t))
    // calmer music sits in a wetter room, livelier music in a drier one
    const a = arousalAt(layout, t)
    reverb?.wet.rampTo(0.45 - 0.2 * a, 0.5)
  }

  function clearTimers() {
    clearInterval(scheduleTimer)
    clearInterval(progressTimer)
  }

  function stopDrift() {
    halted = true // a drift still loading never starts
    clearTimers()
    if (!master) return
    const now = Tone.now()
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(Math.max(0, master.gain.value), now)
    master.gain.linearRampToValueAtTime(0, now + FADE)
  }

  onMounted(async () => {
    Tone = await import('tone')
    if (halted) return
    await Tone.start()
    if (halted) return

    master = new Tone.Gain(0).toDestination()
    reverb = new Tone.Reverb({ decay: 8, wet: 0.35 }).connect(master) // wet follows arousal
    await reverb.ready
    if (halted) return

    await new Promise<void>((resolve) => {
      sampler = new Tone.Sampler({
        urls: URLS,
        baseUrl: '/samples/retro-pad/',
        attack: ATTACK,
        release: RELEASE,
        onload: () => resolve(),
      }).connect(reverb!)
    })
    if (halted) return

    composer = new Composer({ ...props.plan, rng: mulberry(props.seed) })
    t0 = Tone.now() + 0.3
    master.gain.setValueAtTime(0, Tone.now())
    master.gain.linearRampToValueAtTime(LEVEL, t0 + FADE)

    schedule()
    report()
    scheduleTimer = window.setInterval(schedule, 5000)
    progressTimer = window.setInterval(report, 250)
  })

  onUnmounted(() => {
    halted = true
    clearTimers()
    sampler?.dispose()
    reverb?.dispose()
    master?.dispose()
  })
</script>

<template>
  <!-- No visual needed -->
</template>
