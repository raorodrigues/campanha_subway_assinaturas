<script setup lang="ts">
// Fingertip position inside /images/maozinha.webp (233×198).
const FINGERTIP_X = 12
const FINGERTIP_Y = 10

const DRAW_DURATION = 2400
const HOLD_DURATION = 800
const FADE_DURATION = 350
const CYCLE_DURATION = DRAW_DURATION + HOLD_DURATION + FADE_DURATION * 2

// Traced from the signature scribble in the reference mockup (fatiado/referencia/4.jpg).
const SIGNATURE_PATH = [
  'M25 90',
  'C47 87 73 82 87 70',
  'C107 50 113 17 100 20',
  'C87 23 80 57 73 87',
  'C67 120 50 153 33 177',
  'C20 197 10 197 17 177',
  'C27 150 50 120 77 107',
  'C90 100 100 97 97 117',
  'L95 133',
  'C100 117 110 103 127 103',
  'C140 103 146 115 142 123',
].join(' ')

const pathRef = ref<SVGPathElement | null>(null)
const handRef = ref<HTMLImageElement | null>(null)
let frameId: number | null = null
let startTime = 0
let pathLength = 0

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

function render(progress: number, opacity: number) {
  const path = pathRef.value
  const hand = handRef.value
  if (!path || !hand) return

  const point = path.getPointAtLength(pathLength * progress)
  path.style.strokeDashoffset = String(pathLength * (1 - progress))
  path.style.opacity = String(opacity)
  hand.style.opacity = String(opacity)
  hand.style.transform = `translate(${point.x - FINGERTIP_X}px, ${point.y - FINGERTIP_Y}px)`
}

function tick(now: number) {
  const elapsed = (now - startTime) % CYCLE_DURATION

  if (elapsed < FADE_DURATION) {
    render(0, elapsed / FADE_DURATION)
  } else if (elapsed < FADE_DURATION + DRAW_DURATION) {
    render(easeInOut((elapsed - FADE_DURATION) / DRAW_DURATION), 1)
  } else if (elapsed < FADE_DURATION + DRAW_DURATION + HOLD_DURATION) {
    render(1, 1)
  } else {
    render(1, 1 - (elapsed - FADE_DURATION - DRAW_DURATION - HOLD_DURATION) / FADE_DURATION)
  }

  frameId = requestAnimationFrame(tick)
}

onMounted(() => {
  const path = pathRef.value
  if (!path) return

  pathLength = path.getTotalLength()
  path.style.strokeDasharray = String(pathLength)

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    render(1, 1)
    return
  }

  startTime = performance.now()
  frameId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (frameId !== null) cancelAnimationFrame(frameId)
})
</script>

<template>
  <div class="signature-hand-cue" aria-hidden="true">
    <svg class="signature-hand-cue__trail" viewBox="0 0 400 330" width="400" height="330">
      <path ref="pathRef" :d="SIGNATURE_PATH" />
    </svg>
    <img ref="handRef" class="signature-hand-cue__hand" src="/images/maozinha.webp" alt="" width="233" height="198">
  </div>
</template>

<style scoped>
.signature-hand-cue {
  position: absolute;
  top: 360px;
  left: 430px;
  width: 400px;
  height: 330px;
  pointer-events: none;
}

.signature-hand-cue__trail {
  position: absolute;
  inset: 0;
  overflow: visible;
}

.signature-hand-cue__trail path {
  fill: none;
  stroke: #f2db25;
  stroke-width: 10;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
}

.signature-hand-cue__hand {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 233px;
  height: 198px;
  opacity: 0;
  will-change: transform, opacity;
}
</style>
