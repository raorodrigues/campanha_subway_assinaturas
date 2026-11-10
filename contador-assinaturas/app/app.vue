<script setup lang="ts">
const total = ref<number | null>(null)
const connectionError = ref(false)
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let disposed = false

async function refreshCount() {
  controller = new AbortController()
  try {
    const result = await $fetch('/api/signatures/count', {
      signal: controller.signal,
      timeout: 4000,
      retry: 0,
    })
    if (disposed) return
    total.value = result.total
    connectionError.value = false
  } catch (error) {
    if (disposed) return
    console.error('Failed to refresh signature count', error)
    connectionError.value = true
  } finally {
    if (!disposed) refreshTimer = setTimeout(refreshCount, 2000)
  }
}

// Display-only kiosk screen: no long-press menu or Ctrl+wheel/pinch zoom.
function blockContextMenu(event: Event) {
  event.preventDefault()
}

function blockZoomWheel(event: WheelEvent) {
  if (event.ctrlKey) event.preventDefault()
}

// `?demo` simulates new signatures locally to preview the panel animation
// without the signature server.
function runDemo() {
  total.value = (total.value ?? 12310) + 1
  refreshTimer = setTimeout(runDemo, 1200)
}

onMounted(() => {
  document.addEventListener('contextmenu', blockContextMenu)
  window.addEventListener('wheel', blockZoomWheel, { passive: false })
  if (new URLSearchParams(window.location.search).has('demo')) runDemo()
  else void refreshCount()
})
onBeforeUnmount(() => {
  document.removeEventListener('contextmenu', blockContextMenu)
  window.removeEventListener('wheel', blockZoomWheel)
  disposed = true
  clearTimeout(refreshTimer)
  controller?.abort()
})
</script>

<template>
  <main class="led-panel">
    <NuxtRouteAnnouncer />
    <WaveBackground />
    <section class="led-content" aria-labelledby="counter-title">
      <p class="counter-total" aria-live="off">
        <OdometerNumber v-if="total !== null" :value="total" />
      </p>
      <h1 id="counter-title" class="counter-caption">Já assinaram</h1>
    </section>
    <p v-if="connectionError || total === null" class="connection-status" :class="{ 'is-error': connectionError }" role="status">
      <span class="visually-hidden">
        {{ connectionError
          ? (total === null
            ? 'Não foi possível conectar ao servidor de assinaturas.'
            : 'Conexão interrompida. Exibindo a última contagem recebida.')
          : 'Conectando…' }}
      </span>
    </p>
  </main>
</template>

<style>
:root {
  --subway-green: #008939;
  --subway-green-dark: #00491e;
  --subway-yellow: #ffe100;
  --panel-width: 384px;
  --panel-height: 192px;
  color-scheme: dark;
  background: #000;
}

* {
  box-sizing: border-box;
  touch-action: pan-x pan-y;
}

html,
body {
  margin: 0;
  overflow: hidden;
  background: #000;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  overscroll-behavior: none;
  cursor: none;
}

/* Rendered 1:1 at the LED panel resolution, pinned to the top-left corner. */
.led-panel {
  position: relative;
  width: var(--panel-width);
  height: var(--panel-height);
  overflow: hidden;
  background: var(--subway-green);
  font-family: Anton, Impact, "Arial Narrow", sans-serif;
  text-transform: uppercase;
}

.led-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.counter-total {
  --digit-count: 5;
  margin: 0;
  color: #fff;
  font-size: 108px;
  line-height: 1;
}

/* Anton is narrower than the reference face: widen glyphs to match it. */
.counter-total .odometer {
  --digit-width: 0.535em;
  /*
   * Anton metrics: ascent 1.18em, descent 0.33em, digit ink 0.87em tall.
   * Baseline sits at line-height/2 + 0.425em, so line-height 0.99em puts it
   * at 0.92em: ink spans 0.05em–0.92em inside the 0.96em clipping cell,
   * leaving a small margin top and bottom (no clipped digits).
   */
  --digit-height: 0.96em;
  /* Shrink only when the count no longer fits the 384px panel (7+ digits). */
  font-size: min(108px, calc(360px / (var(--digit-count) * 0.535)));
  line-height: 0.99em;
}

.counter-total .odometer-digit {
  transform-origin: center;
  scale: 1.1 1;
}

.counter-caption {
  margin: 0;
  color: var(--subway-yellow);
  margin-top: 0;
  font-size: 41px;
  font-weight: 400;
  letter-spacing: 0.015em;
  line-height: 1;
  scale: 1.14 1;
}

.connection-status {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 4px;
  height: 4px;
  margin: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
}

.connection-status.is-error {
  background: #ff3b1f;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

</style>
