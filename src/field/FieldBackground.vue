<script setup lang="ts">
  import { onBeforeUnmount, ref, watch } from 'vue'

  // One still gradient (top to bottom: a radial one read as a halo). It is given the three colours that belong at the current spot on
  // the mood field and eases toward them, so touching, dragging and drifting all just
  // change the target and the screen follows. Nothing moves except those colour changes:
  // no breathing, no pulsing — the music is the movement.

  const props = defineProps<{
    palette: string[] // three hex colours
  }>()

  const rgb = (hex: string): number[] => {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  let current = props.palette.map(rgb)
  const shown = ref(current.map((c) => c.map(Math.round)))
  let target = current
  let frame = 0

  function tick() {
    let moving = false
    current = current.map((c, i) =>
      c.map((x, k) => {
        const d = target[i][k] - x
        if (Math.abs(d) < 0.4) return target[i][k]
        moving = true
        return x + d * 0.06
      })
    )
    const next = current.map((c) => c.map(Math.round))
    // only touch the DOM when a colour has visibly changed
    if (next.some((c, i) => c.some((x, k) => x !== shown.value[i][k]))) shown.value = next
    frame = moving ? requestAnimationFrame(tick) : 0
  }

  watch(
    () => props.palette,
    (palette) => {
      target = palette.map(rgb)
      if (!frame) frame = requestAnimationFrame(tick)
    }
  )

  onBeforeUnmount(() => cancelAnimationFrame(frame))

  const css = (c: number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`
</script>

<template>
  <div class="field-background" aria-hidden="true">
    <div
      class="gradient"
      :style="{
        background: `linear-gradient(180deg, ${shown.map(css).join(', ')})`,
      }"></div>
  </div>
</template>

<style scoped>
  .field-background {
    position: fixed;
    inset: 0;
    z-index: -2;
    overflow: hidden;
  }

  .gradient {
    position: absolute;
    inset: 0;
  }
</style>
