<script setup lang="ts">
// Subway wave pattern measured from painel-led-contador-384x192px.mp4:
// thick meander lines (36px) with legs every ~52px and rows every 138px.
// Same motion as the signature kiosk's WaveBackground: each row drifts on its
// own, even rows to the right, odd rows to the left, in a seamless loop.
const STROKE = 36
// Mean leg spacing measured on the reference video (legs at -58 … 414 px).
const LEG_SPACING = 52
// One ∩∪ pair: shifting by this distance leaves the pattern unchanged.
const PERIOD = LEG_SPACING * 2
const ROW_PERIOD = 138
const TOP_TURN_Y = 9 // centre of the ∩ turns of the first row
const LEG_LENGTH = 35
const RADIUS = LEG_SPACING / 2
// Room above and below the leg ends for the turns and the stroke.
const TURN_EXTENT = RADIUS + STROKE / 2
const ROW_HEIGHT = LEG_LENGTH + TURN_EXTENT * 2
const ROW_COUNT = 2
const PANEL_WIDTH = 384
const WIDTH = PANEL_WIDTH + PERIOD
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
      <path :d="path" fill="none" :stroke-width="STROKE" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<style>
.wave-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.wave-background__row {
  position: absolute;
  display: block;
  stroke: var(--subway-green-dark, #00491e);
  will-change: transform;
}

/* Right-moving rows start one period (104px) to the left; left-moving rows start at 0. */
.wave-background__row--right {
  left: -104px;
}

.wave-background__row--left {
  left: 0;
}

@media (prefers-reduced-motion: no-preference) {
  /*
   * Same relative speed as the signature kiosk (380px every 4s on a 1080px
   * screen ≈ 8.8% of the width per second): ~34px/s on the 384px panel,
   * so one 104px period every 3.1s.
   */
  .wave-background__row--right {
    animation: wave-drift-right 3.1s linear infinite;
  }

  .wave-background__row--left {
    animation: wave-drift-left 3.1s linear infinite;
  }
}

@keyframes wave-drift-right {
  from { transform: translateX(0); }
  to { transform: translateX(104px); }
}

@keyframes wave-drift-left {
  from { transform: translateX(0); }
  to { transform: translateX(-104px); }
}
</style>
