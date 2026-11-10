<script setup lang="ts">
// Subway wave pattern measured from painel-led-contador-384x192px.mp4:
// thick meander lines (36px) whose legs sit at fixed x positions, rows
// repeating every 138px. Each row is "written" like a pen stroke: an eraser
// sweeps left to right and a pen redraws the line behind it.
const STROKE = 36
// The path starts and ends just off screen so the round caps at its ends
// never show up.
const LEG_CENTERS = [-58, -6, 54, 105.5, 157.5, 207.5, 264, 307, 362, 414]
const ROW_PERIOD = 138
const TOP_TURN_Y = 9 // centre of the ∩ turns of the first row
const LEG_LENGTH = 35
const ROWS = [0, 1]

function rowPath(row: number) {
  const top = TOP_TURN_Y + row * ROW_PERIOD
  const bottom = top + LEG_LENGTH
  const [first] = LEG_CENTERS
  // Even legs turn at the bottom (∪) towards the next leg, odd ones at the top (∩).
  let d = `M ${first} ${top} L ${first} ${bottom}`
  for (let i = 1; i < LEG_CENTERS.length; i++) {
    const from = LEG_CENTERS[i - 1]!
    const to = LEG_CENTERS[i]!
    const radius = (to - from) / 2
    const atBottom = i % 2 === 1
    const y = atBottom ? bottom : top
    const nextY = atBottom ? top : bottom
    d += ` A ${radius} ${radius} 0 0 ${atBottom ? 0 : 1} ${to} ${y}`
    if (i < LEG_CENTERS.length - 1) d += ` L ${to} ${nextY}`
  }
  return d
}

const paths = ROWS.map(rowPath)
// Each row below follows the one above it by a third of a second.
const ROW_DELAY_SECONDS = 0.33
const rowDelay = (row: number) => ({ animationDelay: `${row * ROW_DELAY_SECONDS}s` })
</script>

<template>
  <svg
    class="wave-background"
    viewBox="0 0 384 192"
    width="384"
    height="192"
    aria-hidden="true"
    focusable="false"
  >
    <g fill="none" :stroke-width="STROKE" stroke-linecap="round" stroke-linejoin="round">
      <template v-for="(d, index) in paths" :key="index">
        <!-- Tail: the line still on screen, erased from the left. -->
        <path class="wave-tail" :d="d" pathLength="100" :style="rowDelay(index)" />
        <!-- Head: the line being redrawn behind the eraser. -->
        <path class="wave-head" :d="d" pathLength="100" :style="rowDelay(index)" />
      </template>
    </g>
  </svg>
</template>

<style>
.wave-background {
  position: absolute;
  inset: 0;
  display: block;
  stroke: var(--subway-green-dark, #00491e);
}

/*
 * One cycle lasts 10s / 3, as in the reference video. Both copies share the
 * same path: at the end of a cycle the head is complete and the tail empty,
 * which is visually identical to the start (tail complete, head empty), so
 * the loop is seamless.
 */
.wave-tail,
.wave-head {
  stroke-dasharray: 100 100;
  animation-duration: 3.333s;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-fill-mode: both;
}

.wave-tail {
  animation-name: wave-erase;
}

.wave-head {
  animation-name: wave-draw;
}

/*
 * Keyframes measured frame by frame on the reference video (top row), as
 * fraction of the path drawn/erased (pathLength = 100; the screen spans
 * roughly 16→96). The cycle starts while the screen is fully drawn, so the
 * reset of both copies is invisible. Linear between measured points.
 */
@keyframes wave-erase {
  0% { stroke-dashoffset: 0; }
  5.4% { stroke-dashoffset: -16.2; }
  11.1% { stroke-dashoffset: -22.8; }
  20.7% { stroke-dashoffset: -32.8; }
  30.3% { stroke-dashoffset: -52.6; }
  39.9% { stroke-dashoffset: -75.8; }
  49.5% { stroke-dashoffset: -85.8; }
  59.1% { stroke-dashoffset: -95.8; }
  63%, 100% { stroke-dashoffset: -100; }
}

@keyframes wave-draw {
  0%, 9.9% { stroke-dashoffset: 100; }
  30.3% { stroke-dashoffset: 83; }
  39.9% { stroke-dashoffset: 80; }
  49.5% { stroke-dashoffset: 67.2; }
  59.1% { stroke-dashoffset: 47.4; }
  68.7% { stroke-dashoffset: 36.2; }
  78.3% { stroke-dashoffset: 24.2; }
  87.9% { stroke-dashoffset: 14.2; }
  97.5% { stroke-dashoffset: 4.2; }
  100% { stroke-dashoffset: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .wave-tail,
  .wave-head {
    animation: none;
  }

  .wave-head {
    stroke-dashoffset: 100;
  }
}
</style>
