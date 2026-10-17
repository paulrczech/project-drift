<script setup lang="ts">
  import { onMounted, onUnmounted } from 'vue'
  import {
    Composer,
    layoutTimeline,
    positionAt,
    textIndexAt,
    arousalAt,
    type TimelinePlan,
  } from '../engine/compose'
  import { routeNote, voiceFromLocation } from '../engine/voices'

  interface Props {
    plan: Omit<TimelinePlan, 'rng'>
    seed: number
  }

  const props = defineProps<Props>()

  // The audio clock is the only clock: every 250ms we report where the drift is, and
  // text and visuals follow.
  const emit = defineEmits<{
    (e: 'progress', position: number, textIndex: number, elapsed: number): void
    (e: 'ended'): void // a finite drift has faded out and finished
  }>()

  defineExpose({ stopDrift })

  const voice = voiceFromLocation()
  const VELOCITY = 0.8
  const LEVEL = voice.level
  const FADE = 3 // seconds, in and out (and when stopped)
  const END_FADE = 45 // seconds, the fade at the end of a finite drift (at most a quarter of it)
  // Notes are queued this far ahead. Hidden tabs throttle timers to as little as one
  // tick a minute, so the queue has to outlast that.
  const LOOKAHEAD = 90

  const layout = layoutTimeline(props.plan.waypoints, props.plan.walk)

  type ToneModule = typeof import('tone')
  let Tone: ToneModule
  // one sampler per layer of the voice (a single-set voice has one)
  const samplers = new Map<string, InstanceType<ToneModule['Sampler']>>()
  let reverb: InstanceType<ToneModule['Reverb']> | undefined
  let filter: InstanceType<ToneModule['Filter']> | undefined
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
      for (const r of routeNote(voice, e.note, arousalAt(layout, e.time))) {
        if ((r.layer.chain ?? 0) !== e.chain) continue // each layer re-strikes on its own schedule
        samplers
          .get(r.layer.id)
          ?.triggerAttackRelease(
            Tone.Frequency(r.note, 'midi').toNote(),
            e.hold - late,
            Math.max(at, now),
            VELOCITY * r.velocity
          )
      }
    }
  }

  function report() {
    const t = Math.max(0, Tone.now() - t0)
    emit('progress', positionAt(layout, t), textIndexAt(layout, t), t)
    if (t >= layout.duration + voice.release) {
      clearTimers()
      emit('ended')
      return
    }
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
    // an optional gentle low-pass tames the top of a bright voice
    filter = voice.lowpass ? new Tone.Filter(voice.lowpass, 'lowpass').connect(reverb) : undefined
    await reverb.ready
    if (halted) return

    await Promise.all(
      voice.layers.map(
        (layer) =>
          new Promise<void>((resolve) => {
            samplers.set(
              layer.id,
              new Tone.Sampler({
                urls: layer.urls,
                baseUrl: layer.baseUrl,
                attack: voice.attack,
                release: voice.release,
                curve: voice.curve ?? 'exponential',
                onload: () => resolve(),
              }).connect(filter ?? reverb!)
            )
          })
      )
    )
    if (halted) return

    composer = new Composer({
      ...props.plan,
      register: voice.register,
      span: voice.span,
      ceiling: voice.ceiling,
      attack: voice.attack,
      link: voice.link,
      links: voice.links,
      overlap: voice.overlap,
      maxHold: voice.maxHold,
      rng: mulberry(props.seed),
    })
    t0 = Tone.now() + 0.3
    master.gain.setValueAtTime(0, Tone.now())
    master.gain.linearRampToValueAtTime(LEVEL, t0 + FADE)
    // A finite drift ends the way it began: a slow fade to silence over its last stretch.
    if (Number.isFinite(layout.duration)) {
      const out = Math.min(END_FADE, layout.duration * 0.25)
      master.gain.setValueAtTime(LEVEL, t0 + layout.duration - out)
      master.gain.linearRampToValueAtTime(0, t0 + layout.duration)
    }

    schedule()
    report()
    scheduleTimer = window.setInterval(schedule, 5000)
    progressTimer = window.setInterval(report, 250)
  })

  onUnmounted(() => {
    halted = true
    clearTimers()
    samplers.forEach((sampler) => sampler.dispose())
    filter?.dispose()
    reverb?.dispose()
    master?.dispose()
  })
</script>

<template>
  <!-- No visual needed -->
</template>
