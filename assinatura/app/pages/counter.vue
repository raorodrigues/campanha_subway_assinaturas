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

// The LED controller software captures a fixed 384×192 block of *physical*
// pixels at the top-left of a larger Windows desktop. So the panel is never
// scaled to the window: it is pinned at the capture origin and drawn at exactly
// 384×192 device pixels, whatever the Windows scaling or browser zoom
// (devicePixelRatio 1.25 → 0.8 scale). `?x=` / `?y=` move it to another
// capture origin, in physical pixels (kiosk.json counterOffsetX/Y).
const panelScale = ref(1)
const panelX = ref(0)
const panelY = ref(0)
const offset = reactive({ x: 0, y: 0 })
const calibrating = ref(false)
const devicePixelRatio = ref(1)
let resolutionQuery: MediaQueryList | undefined

function readOffset(params: URLSearchParams, name: string) {
  const value = Number(params.get(name) ?? 0)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function pinPanel() {
  const ratio = window.devicePixelRatio || 1
  devicePixelRatio.value = ratio
  panelScale.value = 1 / ratio
  panelX.value = offset.x / ratio
  panelY.value = offset.y / ratio
  // Windows scaling or browser zoom changes the ratio: re-pin when it does.
  resolutionQuery?.removeEventListener('change', pinPanel)
  resolutionQuery = window.matchMedia(`(resolution: ${ratio}dppx)`)
  resolutionQuery.addEventListener('change', pinPanel)
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
  const params = new URLSearchParams(window.location.search)
  offset.x = readOffset(params, 'x')
  offset.y = readOffset(params, 'y')
  calibrating.value = params.has('calibrar')
  pinPanel()
  window.addEventListener('resize', pinPanel)
  document.addEventListener('contextmenu', blockContextMenu)
  window.addEventListener('wheel', blockZoomWheel, { passive: false })
  if (params.has('demo')) runDemo()
  else void refreshCount()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', pinPanel)
  resolutionQuery?.removeEventListener('change', pinPanel)
  document.removeEventListener('contextmenu', blockContextMenu)
  window.removeEventListener('wheel', blockZoomWheel)
  disposed = true
  clearTimeout(refreshTimer)
  controller?.abort()
})
</script>

<template>
  <div class="led-stage">
    <main
      class="led-panel"
      :style="{ '--panel-scale': panelScale, '--panel-x': `${panelX}px`, '--panel-y': `${panelY}px` }"
    >
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
      <div v-if="calibrating" class="calibration" aria-hidden="true">
        <span class="calibration__corner is-top-left" />
        <span class="calibration__corner is-top-right" />
        <span class="calibration__corner is-bottom-left" />
        <span class="calibration__corner is-bottom-right" />
        <span class="calibration__label">384×192 · x{{ offset.x }} y{{ offset.y }} · escala {{ Math.round(devicePixelRatio * 100) }}%</span>
      </div>
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

/* Fills the display; everything outside the captured 384×192 stays black. */
.led-stage {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #000;
}

/*
 * Laid out at the LED panel resolution (384×192) and pinned at the capture
 * origin. The 1/devicePixelRatio scale makes one layout pixel one physical
 * pixel, so the panel covers exactly the 384×192 block the LED software reads.
 * Never centre or fit it to the window: the capture area does not move.
 */
.led-panel {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  translate: var(--panel-x, 0) var(--panel-y, 0);
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
  /*
   * Fixed slots, as in the reference: the narrow "1" keeps a full-width slot.
   * The widest Black digits have ~0.51em of ink and no side bearing, so the
   * slot leaves ~0.05em between neighbours instead of letting them touch.
   */
  --digit-width: 0.56em;
  /*
   * Subway Sans Cond Black metrics: ascent 0.81em, descent 0.19em, digit ink
   * 0.725em tall. In a 0.91em line box the baseline sits at 0.765em, so the
   * ink spans 0.04em–0.765em inside the 0.82em clipping cell: a small margin
   * top and bottom, no clipped digits while rolling.
   */
  --digit-height: 0.82em;
  /* Shrink only when the count no longer fits the 384px panel (7+ digits). */
  font-size: min(115px, calc(360px / (var(--digit-count) * 0.56)));
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

/* `?calibrar`: 1px frame and corner blocks to line the page up with the LEDs. */
.calibration {
  position: absolute;
  inset: 0;
  z-index: 2;
  outline: 1px solid #ff0000;
  outline-offset: -1px;
  pointer-events: none;
}

.calibration__corner {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #fff;
}

.calibration__corner.is-top-left { top: 0; left: 0; }
.calibration__corner.is-top-right { top: 0; right: 0; }
.calibration__corner.is-bottom-left { bottom: 0; left: 0; }
.calibration__corner.is-bottom-right { right: 0; bottom: 0; }

.calibration__label {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 2px 4px;
  background: #000;
  color: #fff;
  font: 700 12px/1 system-ui, sans-serif;
  text-transform: none;
  white-space: nowrap;
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
