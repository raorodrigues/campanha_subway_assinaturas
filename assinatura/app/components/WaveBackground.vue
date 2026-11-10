<script setup lang="ts">
// Subway wave pattern, rebuilt as vector from /images/bg.webp (1080×1920):
// thick meander lines (136px) with legs every 190px and rows every 522px.
// Same construction as the LED counter's WaveBackground, at kiosk scale.
// As in referencia_animacao.mp4, each row drifts on its own: even rows to the
// right, odd rows to the left, ~95px/s, in a seamless loop.
const STROKE = 136
const LEG_SPACING = 190
// One ∩∪ pair: shifting by this distance leaves the pattern unchanged.
const PERIOD = LEG_SPACING * 2
const ROW_PERIOD = 522
// Centre of the ∩ turns of the first row; puts the light gaps between rows at
// y ≈ 420, 942 and 1465, where the reference rows split.
const TOP_TURN_Y = 69
const LEG_LENGTH = 180
const RADIUS = LEG_SPACING / 2
// Room above and below the leg ends for the turns and the stroke.
const TURN_EXTENT = RADIUS + STROKE / 2
const ROW_HEIGHT = LEG_LENGTH + TURN_EXTENT * 2
// Four rows fill the full 1920px (the footer slides up over them when the page boots).
const ROW_COUNT = 4
const WIDTH = 1080 + PERIOD
// Legs start one spacing off screen on both sides so the line ends never show.
const LEG_COUNT = Math.ceil(WIDTH / LEG_SPACING) + 3

// Path in the row's own box: the ∩ turns sit TURN_EXTENT below its top edge.
function rowPath() {
  const top = TURN_EXTENT
  const bottom = top + LEG_LENGTH
  const legX = (index: number) => (index - 1) * LEG_SPACING
  let d = `M ${legX(0)} ${top} L ${legX(0)} ${bottom}`
  for (let i = 1; i < LEG_COUNT; i++) {
    // Odd legs are reached through a bottom turn (∪), even ones through a top turn (∩).
    const atBottom = i % 2 === 1
    const y = atBottom ? bottom : top
    const nextY = atBottom ? top : bottom
    d += ` A ${RADIUS} ${RADIUS} 0 0 ${atBottom ? 0 : 1} ${legX(i)} ${y} L ${legX(i)} ${nextY}`
  }
  return d
}

const path = rowPath()
const rows = Array.from({ length: ROW_COUNT }, (_, index) => ({
  index,
  direction: index % 2 === 0 ? 'right' : 'left',
  top: `${TOP_TURN_Y + index * ROW_PERIOD - TURN_EXTENT}px`,
}))
</script>

<template>
  <div class="wave-background" aria-hidden="true">
    <svg
      v-for="row in rows"
      :key="row.index"
      class="wave-background__row"
      :class="`wave-background__row--${row.direction}`"
      :style="{ top: row.top }"
      :viewBox="`0 0 ${WIDTH} ${ROW_HEIGHT}`"
      :width="WIDTH"
      :height="ROW_HEIGHT"
      focusable="false"
    >
      <path :d="path" fill="none" stroke="#005422" :stroke-width="STROKE" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<style scoped>
.wave-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 1080px;
  height: 1920px;
  overflow: hidden;
  background: #008938;
  pointer-events: none;
}

.wave-background__row {
  position: absolute;
  display: block;
  will-change: transform;
}

/* Right-moving rows start one period to the left; left-moving rows start at 0. */
.wave-background__row--right {
  left: -380px;
}

.wave-background__row--left {
  left: 0;
}

@media (prefers-reduced-motion: no-preference) {
  /* 380px per cycle at ~95px/s, measured on the reference video. */
  .wave-background__row--right {
    animation: wave-drift-right 4s linear infinite;
  }

  .wave-background__row--left {
    animation: wave-drift-left 4s linear infinite;
  }
}

@keyframes wave-drift-right {
  from { transform: translateX(0); }
  to { transform: translateX(380px); }
}

@keyframes wave-drift-left {
  from { transform: translateX(0); }
  to { transform: translateX(-380px); }
}
</style>
