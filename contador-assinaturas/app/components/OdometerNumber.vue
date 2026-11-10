<script setup lang="ts">
// Odometer-style number, as in the reference video: each digit that changes
// rolls down while the new one enters from above. Digits are keyed by
// position from the right so units, tens, etc. keep their slot when the
// number gains a digit.
const props = defineProps<{ value: number }>()

const digits = computed(() => {
  const text = String(Math.max(0, Math.trunc(props.value)))
  return [...text].map((char, index) => ({ slot: text.length - index, char }))
})
</script>

<template>
  <span class="odometer" :style="{ '--digit-count': digits.length }">
    <span v-for="digit in digits" :key="digit.slot" class="odometer-cell">
      <Transition name="roll">
        <span :key="digit.char" class="odometer-digit">{{ digit.char }}</span>
      </Transition>
    </span>
  </span>
</template>

<style>
.odometer {
  display: inline-flex;
}

.odometer-cell {
  position: relative;
  display: inline-block;
  width: var(--digit-width, 0.5em);
  height: var(--digit-height, 1em);
  overflow: hidden;
}

.odometer-digit {
  position: absolute;
  inset: 0;
  text-align: center;
}

.roll-enter-active,
.roll-leave-active {
  transition: transform 450ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.roll-enter-from {
  transform: translateY(-100%);
}

.roll-leave-to {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .roll-enter-active,
  .roll-leave-active {
    transition: none;
  }
}
</style>
