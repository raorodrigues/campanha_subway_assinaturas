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

// The LED controller software captures a fixed block of *physical* pixels on a
// larger Windows desktop and stretches it over the whole panel. The block is
// 384×192 by default (`?w=` / `?h=`, kiosk.json counterWidth/Height) and starts
// at the top-left (`?x=` / `?y=`, kiosk.json counterOffsetX/Y). The design is
// laid out at 384×192 and stretched to exactly that block, compensating the
// Windows scaling or browser zoom (devicePixelRatio), so it fills the panel
// whatever capture size the LED software uses. Never fit it to the window.
const DESIGN_WIDTH = 384
const DESIGN_HEIGHT = 192
const MAX_CAPTURE_SIZE = 4096
const panelScaleX = ref(1)
const panelScaleY = ref(1)
const panelX = ref(0)
const panelY = ref(0)
const capture = reactive({ x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT })
const calibrating = ref(false)
const devicePixelRatio = ref(1)
let resolutionQuery: MediaQueryList | undefined

function readInteger(params: URLSearchParams, name: string, fallback: number, min: number) {
  const raw = params.get(name)
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= min && value <= MAX_CAPTURE_SIZE ? value : fallback
}

function pinPanel() {
  const ratio = window.devicePixelRatio || 1
  devicePixelRatio.value = ratio
  panelScaleX.value = capture.width / DESIGN_WIDTH / ratio
  panelScaleY.value = capture.height / DESIGN_HEIGHT / ratio
  panelX.value = capture.x / ratio
  panelY.value = capture.y / ratio
  // Windows scaling or browser zoom changes the ratio: re-pin when it does.
  resolutionQuery?.removeEventListener('change', pinPanel)
  resolutionQuery = window.matchMedia(`(resolution: ${ratio}dppx)`)
  resolutionQuery.addEventListener('change', pinPanel)
}

// `?calibrar` ruler, in physical pixels from the capture origin: numbered
// stripes every 32 px. The last number fully lit on the LEDs, at the right and
// bottom edges, is the capture width and height to set in kiosk.json.
const RULER_STEP = 32
const rulerX = Array.from({ length: 1024 / RULER_STEP }, (_, index) => index * RULER_STEP)
const rulerY = Array.from({ length: 512 / RULER_STEP }, (_, index) => index * RULER_STEP)

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
  capture.x = readInteger(params, 'x', 0, 0)
  capture.y = readInteger(params, 'y', 0, 0)
  capture.width = readInteger(params, 'w', DESIGN_WIDTH, 1)
  capture.height = readInteger(params, 'h', DESIGN_HEIGHT, 1)
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
      v-show="!calibrating"
      class="led-panel"
      :style="{
        '--panel-scale-x': panelScaleX,
        '--panel-scale-y': panelScaleY,
        '--panel-x': `${panelX}px`,
        '--panel-y': `${panelY}px`,
      }"
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
    </main>
    <div
      v-if="calibrating"
      class="calibration"
      aria-hidden="true"
      :style="{
        '--panel-scale-x': 1 / devicePixelRatio,
        '--panel-scale-y': 1 / devicePixelRatio,
        '--panel-x': `${panelX}px`,
        '--panel-y': `${panelY}px`,
      }"
    >
      <span
        v-for="(start, index) in rulerX"
        :key="`x${start}`"
        class="calibration__stripe is-column"
        :class="{ 'is-odd': index % 2 }"
        :style="{ left: `${start}px` }"
      >{{ start + RULER_STEP }}</span>
      <span
        v-for="(start, index) in rulerY"
        :key="`y${start}`"
        class="calibration__stripe is-row"
        :class="{ 'is-odd': index % 2 }"
        :style="{ top: `${start}px` }"
      >{{ start + RULER_STEP }}</span>
      <span class="calibration__frame" :style="{ width: `${capture.width}px`, height: `${capture.height}px` }" />
      <span class="calibration__label">
        área {{ capture.width }}×{{ capture.height }} · x{{ capture.x }} y{{ capture.y }} · escala {{ Math.round(devicePixelRatio * 100) }}%
      </span>
    </div>
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
 * Laid out at 384×192 and pinned at the capture origin, then stretched to the
 * capture block in physical pixels (scale includes 1/devicePixelRatio). The LED
 * software maps that block onto the whole 2:1 panel, so the 2:1 design comes
 * out undistorted. Never centre or fit it to the window: the capture area does
 * not move.
 */
.led-panel {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  translate: var(--panel-x, 0) var(--panel-y, 0);
  scale: var(--panel-scale-x, 1) var(--panel-scale-y, 1);
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

/*
 * `?calibrar`: numbered stripes every 32 physical px from the capture origin,
 * along the top (width) and the left (height), plus a red frame around the
 * configured capture area. The last number lit at each edge of the LEDs is the
 * capture size.
 */
.calibration {
  position: absolute;
  top: 0;
  left: 0;
  width: 1024px;
  height: 512px;
  transform-origin: 0 0;
  translate: var(--panel-x, 0) var(--panel-y, 0);
  scale: var(--panel-scale-x, 1) var(--panel-scale-y, 1);
  background: #003a18;
  font: 700 14px/1 system-ui, sans-serif;
  pointer-events: none;
}

.calibration__stripe {
  position: absolute;
  display: flex;
  box-sizing: border-box;
  background: #fff;
  color: #000;
}

.calibration__stripe.is-odd {
  background: #ffe100;
}

.calibration__stripe.is-column {
  z-index: 1;
  top: 0;
  width: 32px;
  height: 60px;
  align-items: center;
  padding: 2px 0;
  writing-mode: vertical-rl;
  rotate: 180deg;
}

.calibration__stripe.is-row {
  left: 0;
  width: 60px;
  height: 32px;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 0 2px 2px 0;
}

.calibration__frame {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  border: 2px solid #ff0000;
}

.calibration__label {
  position: absolute;
  top: 72px;
  left: 72px;
  padding: 2px 4px;
  background: #000;
  color: #fff;
  font-size: 12px;
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
