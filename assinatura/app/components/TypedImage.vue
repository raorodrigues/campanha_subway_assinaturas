<script setup lang="ts">
/**
 * A text image split into lines so each line can be "typed" in and erased
 * by a soft-edged mask (see .m-type in motion.css). The font is not
 * available, so the reveal walks across the artwork in steps of roughly one
 * letter instead of drawing real glyphs.
 */
export interface TypedImageLine {
  /** Line box inside the image, in image pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Characters on the line, spaces included: sets the step count and duration. */
  chars: number
  /** Optional clip-path, in the line element's own coordinates, for lines whose glyphs interlock. */
  clip?: string
  /** Left edge (image px) from which this line gets the white flash overlay in attract mode. */
  flashFrom?: number
}

const props = defineProps<{
  src: string
  width: number
  height: number
  lines: TypedImageLine[]
}>()

// Room for the soft mask edge so the first and last letters are fully hidden/shown at the ends.
const PAD = 32

const lineBoxes = computed(() => {
  let charsBefore = 0
  return props.lines.map((line, index) => {
    const box = {
      key: index,
      style: {
        left: `${line.x - PAD}px`,
        top: `${line.y}px`,
        width: `${line.width + PAD * 2}px`,
        height: `${line.height}px`,
        clipPath: line.clip,
        '--n': line.chars,
        '--c': charsBefore,
        '--x': index,
      },
      imageStyle: {
        left: `${PAD - line.x}px`,
        top: `${-line.y}px`,
      },
      flashStyle: line.flashFrom === undefined
        ? null
        // The overlay is a full-size copy of the artwork, so the inset is in image pixels.
        : { clipPath: `inset(0 0 0 ${line.flashFrom}px)` },
    }
    charsBefore += line.chars
    return box
  })
})
</script>

<template>
  <div class="typed-image" :style="{ width: `${width}px`, height: `${height}px` }" aria-hidden="true">
    <div v-for="line in lineBoxes" :key="line.key" class="typed-image__line m m-type" :style="line.style">
      <img
        class="typed-image__art"
        :src="src"
        :width="width"
        :height="height"
        :style="line.imageStyle"
        alt=""
        draggable="false"
      >
      <img
        v-if="line.flashStyle"
        class="typed-image__art typed-image__flash"
        :src="src"
        :width="width"
        :height="height"
        :style="[line.imageStyle, line.flashStyle]"
        alt=""
        draggable="false"
      >
    </div>
  </div>
</template>

<style scoped>
.typed-image {
  position: absolute;
}

.typed-image__line {
  position: absolute;
  overflow: hidden;
}

.typed-image__art {
  position: absolute;
  display: block;
  max-width: none;
}

/* Turns the yellow words white; shown in pulses by the attract loop. */
.typed-image__flash {
  filter: brightness(0) invert(1);
  opacity: 0;
}
</style>
