<script setup lang="ts">
// LED panel counter (384×192), opened by the kiosk on the second display.
// Same server as the signature kiosk, so the count comes straight from SQLite.
useHead({
  htmlAttrs: { class: 'page-counter' },
  title: 'Contador de assinaturas',
})

// The count is a local SQLite COUNT(*) (~1 ms), so polling every 500 ms costs
// nothing and a new signature shows up on the panel almost at once. The next
// poll starts only after the previous answer, so requests never pile up.
const REFRESH_INTERVAL = 500
const REQUEST_TIMEOUT = 2000

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
      timeout: REQUEST_TIMEOUT,
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
    if (!disposed) refreshTimer = setTimeout(refreshCount, REFRESH_INTERVAL)
  }
}

// The panel is designed at 384×192 and scaled to fill the display while
// keeping its 2:1 ratio; any leftover area stays black (letterbox).
const PANEL_WIDTH = 384
const PANEL_HEIGHT = 192
const panelScale = ref(1)

function fitPanel() {
  panelScale.value = Math.min(window.innerWidth / PANEL_WIDTH, window.innerHeight / PANEL_HEIGHT)
}

// Display-only screen: no long-press menu or Ctrl+wheel/pinch zoom.
function blockContextMenu(event: Event) {
  event.preventDefault()
}

function blockZoomWheel(event: WheelEvent) {
  if (event.ctrlKey) event.preventDefault()
}

// `?demo` simulates new signatures to preview the panel animation.
function runDemo() {
  total.value = (total.value ?? 12310) + 1
  refreshTimer = setTimeout(runDemo, 1200)
}

onMounted(() => {
  fitPanel()
  window.addEventListener('resize', fitPanel)
  document.addEventListener('contextmenu', blockContextMenu)
  window.addEventListener('wheel', blockZoomWheel, { passive: false })
  if (new URLSearchParams(window.location.search).has('demo')) runDemo()
  else void refreshCount()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', fitPanel)
  document.removeEventListener('contextmenu', blockContextMenu)
  window.removeEventListener('wheel', blockZoomWheel)
  disposed = true
  clearTimeout(refreshTimer)
  controller?.abort()
})
</script>

<template>
  <div class="led-stage">
    <main class="led-panel" :style="{ '--panel-scale': panelScale }">
      <LedWaveBackground />
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
  </div>
</template>

<style>
html.page-counter {
  --subway-green: #008939;
  --subway-green-dark: #00491e;
  --subway-yellow: #ffe100;
  --panel-width: 384px;
  --panel-height: 192px;
  color-scheme: dark;
  background: #000;
}

html.page-counter body {
  background: #000;
  cursor: none;
}

/* Fills the display; the panel is centred and scaled inside it. */
.led-stage {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #000;
}

/*
 * Laid out at the LED panel resolution (384×192), then scaled around its centre
 * to fit the window. With Windows display scaling above 100% the 384×192 output
 * has fewer CSS pixels, and the panel shrinks to fit instead of being cropped.
 */
.led-panel {
  position: absolute;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
  scale: var(--panel-scale, 1);
  width: var(--panel-width);
  height: var(--panel-height);
  overflow: hidden;
  background: var(--subway-green);
  font-weight: 900;
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

/*
 * Sizes measured on painel-led-contador-384x192px.mp4: digits ~82px tall in
 * 58px slots, caption 275px wide, 15px between the two.
 */
.counter-total {
  --digit-count: 4;
  display: flex;
  margin: 0;
  color: #fff;
  font-size: 115px;
  line-height: 0;
}

.counter-total .odometer {
  /* Fixed slots, as in the reference: the narrow "1" keeps a full-width slot. */
  --digit-width: 0.5em;
  /*
   * Subway Sans Cond Black metrics: ascent 0.81em, descent 0.19em, digit ink
   * 0.725em tall. In a 0.91em line box the baseline sits at 0.765em, so the
   * ink spans 0.04em–0.765em inside the 0.82em clipping cell: a small margin
   * top and bottom, no clipped digits while rolling.
   */
  --digit-height: 0.82em;
  /* Shrink only when the count no longer fits the 384px panel (7+ digits). */
  font-size: min(115px, calc(360px / (var(--digit-count) * 0.5)));
  line-height: 0.91em;
}

.counter-caption {
  margin: 4px 0 0;
  color: var(--subway-yellow);
  font-size: 48px;
  font-weight: 900;
  line-height: 1;
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
