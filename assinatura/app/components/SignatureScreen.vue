<script setup lang="ts">
import type { TypedImageLine } from '~/components/TypedImage.vue'

interface SignaturePoint {
  x: number
  y: number
  time: number
}

type SignatureStroke = SignaturePoint[]

// The two lines interlock: the "p" of "para" (x 331–340) hangs below the top of
// "b"/"i" in "abaixo". Each line gets a notch so every glyph is typed with its own line.
// Clip coordinates are local to each line box (TypedImage pads lines by 32px on the left).
const INSTRUCTION_LINES: TypedImageLine[] = [
  {
    x: 0, y: 0, width: 728, height: 95, chars: 24, // Use o dedo para escrever
    clip: 'polygon(0 0, 100% 0, 100% 75px, 373px 75px, 373px 100%, 363px 100%, 363px 75px, 0 75px)',
  },
  {
    x: 112, y: 75, width: 487, height: 68, chars: 15, // seu nome abaixo
    clip: 'polygon(0 0, 251px 0, 251px 20px, 262px 20px, 262px 0, 100% 0, 100% 100%, 0 100%)',
  },
]

const props = defineProps<{
  /** True once the enter animation has settled; countdowns and input start only then. */
  active: boolean
  submitting: boolean
  error: string
  durationSeconds: number
  idleTimeoutSeconds: number
}>()

const emit = defineEmits<{
  close: []
  complete: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
const hasSignature = ref(false)
const isDrawing = ref(false)
const remainingSeconds = ref(props.durationSeconds)
const idleRemainingSeconds = ref(props.idleTimeoutSeconds)
const hasStartedSigning = ref(false)
const expired = ref(false)
let deadline = 0
let idleDeadline = 0
let timerId: ReturnType<typeof setInterval> | null = null
let completionRequested = false

const TRAIL_DURATION = 900
const strokes: SignatureStroke[] = []
let context: CanvasRenderingContext2D | null = null
let frameId: number | null = null
let activePointerId: number | null = null
let resizeObserver: ResizeObserver | null = null
let canvasWidth = 0
let canvasHeight = 0

function requestDraw() {
  if (frameId === null) {
    frameId = requestAnimationFrame(drawFrame)
  }
}

function resizeCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return

  const pixelRatio = window.devicePixelRatio || 1
  // Layout size ignores the preview scale and the enter-animation transforms.
  canvasWidth = canvas.clientWidth
  canvasHeight = canvas.clientHeight
  canvas.width = Math.round(canvasWidth * pixelRatio)
  canvas.height = Math.round(canvasHeight * pixelRatio)
  context = canvas.getContext('2d')

  if (context) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    requestDraw()
  }
}

const STROKE_COLOR = '#17684f'
const STROKE_WIDTH = 3.5
// The trail fades in this many opacity steps. Each step is one continuous
// path, so the line has no overlapping joints (which showed up as dots).
const FADE_STEPS = 24
// Points closer than this (CSS px) add jitter instead of detail.
const MIN_POINT_DISTANCE = 0.75

interface CurvePiece {
  from: { x: number, y: number }
  control: { x: number, y: number } | null
  to: { x: number, y: number }
  time: number
}

function trailAlpha(now: number, time: number) {
  return Math.max(0, 1 - (now - time) / TRAIL_DURATION)
}

// Smooths the sampled points with quadratic curves through their midpoints:
// each piece ends where the next starts with the same tangent.
function strokePieces(stroke: SignatureStroke): CurvePiece[] {
  const points = stroke.map(point => ({ x: point.x * canvasWidth, y: point.y * canvasHeight }))
  const mid = (a: { x: number, y: number }, b: { x: number, y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const last = points.length - 1
  const pieces: CurvePiece[] = [{ from: points[0]!, control: null, to: mid(points[0]!, points[1]!), time: stroke[1]!.time }]
  for (let index = 1; index < last; index += 1) {
    pieces.push({
      from: mid(points[index - 1]!, points[index]!),
      control: points[index]!,
      to: mid(points[index]!, points[index + 1]!),
      time: stroke[index]!.time,
    })
  }
  pieces.push({ from: mid(points[last - 1]!, points[last]!), control: null, to: points[last]!, time: stroke[last]!.time })
  return pieces
}

// Half-disc cap at a stroke end, flush with the butt end of the line.
function drawCap(ctx: CanvasRenderingContext2D, at: { x: number, y: number }, towards: { x: number, y: number }) {
  const angle = Math.atan2(at.y - towards.y, at.x - towards.x)
  ctx.beginPath()
  ctx.arc(at.x, at.y, STROKE_WIDTH / 2, angle - Math.PI / 2, angle + Math.PI / 2)
  ctx.fill()
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: SignatureStroke, now: number) {
  if (stroke.length === 1) {
    const point = stroke[0]!
    const alpha = trailAlpha(now, point.time)
    if (alpha <= 0) return false
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(point.x * canvasWidth, point.y * canvasHeight, STROKE_WIDTH / 2, 0, Math.PI * 2)
    ctx.fill()
    return true
  }

  const pieces = strokePieces(stroke)
  let visible = false
  let index = 0
  while (index < pieces.length) {
    const step = Math.ceil(trailAlpha(now, pieces[index]!.time) * FADE_STEPS)
    let end = index
    while (end + 1 < pieces.length && Math.ceil(trailAlpha(now, pieces[end + 1]!.time) * FADE_STEPS) === step) end += 1

    if (step > 0) {
      visible = true
      ctx.globalAlpha = step / FADE_STEPS
      ctx.beginPath()
      ctx.moveTo(pieces[index]!.from.x, pieces[index]!.from.y)
      for (let piece = index; piece <= end; piece += 1) {
        const { control, to } = pieces[piece]!
        if (control) ctx.quadraticCurveTo(control.x, control.y, to.x, to.y)
        else ctx.lineTo(to.x, to.y)
      }
      ctx.stroke()
      if (index === 0) drawCap(ctx, pieces[0]!.from, pieces[0]!.to)
      if (end === pieces.length - 1) drawCap(ctx, pieces[end]!.to, pieces[end]!.control ?? pieces[end]!.from)
    }
    index = end + 1
  }
  return visible
}

function drawFrame(now: number) {
  frameId = null
  const ctx = context
  if (!ctx) return

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  ctx.strokeStyle = STROKE_COLOR
  ctx.fillStyle = STROKE_COLOR
  ctx.lineWidth = STROKE_WIDTH
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'

  let hasVisibleTrail = false
  for (const stroke of strokes) {
    if (drawStroke(ctx, stroke, now)) hasVisibleTrail = true
  }

  ctx.globalAlpha = 1
  if (isDrawing.value || hasVisibleTrail) requestDraw()
}

function getPoint(event: PointerEvent, rect = canvasRef.value?.getBoundingClientRect()): SignaturePoint {
  if (!rect) throw new Error('Signature canvas is unavailable')

  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    time: performance.now(),
  }
}

function startDrawing(event: PointerEvent) {
  if (!props.active || props.submitting || completionRequested || expired.value || event.button !== 0 ||
    activePointerId !== null || !event.isPrimary) return
  event.preventDefault()

  const canvas = canvasRef.value
  if (!canvas) return

  activePointerId = event.pointerId
  hasStartedSigning.value = true
  isDrawing.value = true
  hasSignature.value = true
  strokes.push([getPoint(event)])
  canvas.setPointerCapture(event.pointerId)
  requestDraw()
}

function continueDrawing(event: PointerEvent) {
  if (props.submitting || completionRequested || expired.value ||
    !isDrawing.value || event.pointerId !== activePointerId) return
  event.preventDefault()

  const currentStroke = strokes[strokes.length - 1]!
  const rect = canvasRef.value?.getBoundingClientRect()
  // Coalesced events carry every sample the screen reported since the last
  // frame, so fast curves keep their shape instead of turning into corners.
  const samples = event.getCoalescedEvents?.() ?? []
  for (const sample of samples.length ? samples : [event]) {
    const point = getPoint(sample, rect)
    const previous = currentStroke[currentStroke.length - 1]!
    const distance = Math.hypot((point.x - previous.x) * canvasWidth, (point.y - previous.y) * canvasHeight)
    if (distance >= MIN_POINT_DISTANCE) currentStroke.push(point)
  }
  requestDraw()
}

function stopDrawing(event: PointerEvent) {
  if (event.pointerId !== activePointerId) return
  isDrawing.value = false
  activePointerId = null
  requestDraw()
}

function clearSignature() {
  strokes.length = 0
  hasSignature.value = false
  isDrawing.value = false
  activePointerId = null

  if (frameId !== null) {
    cancelAnimationFrame(frameId)
    frameId = null
  }

  context?.clearRect(0, 0, canvasWidth, canvasHeight)
}

function close() {
  if (props.submitting) return
  stopTimer()
  clearSignature()
  emit('close')
}

function complete() {
  if (!hasSignature.value || props.submitting || (completionRequested && !props.error)) return
  stopTimer()
  completionRequested = true
  isDrawing.value = false
  activePointerId = null
  // The drawing never leaves this component. Only a completion signal is sent.
  strokes.length = 0
  context?.clearRect(0, 0, canvasWidth, canvasHeight)
  emit('complete')
}

function stopTimer() {
  if (timerId !== null) clearInterval(timerId)
  timerId = null
}

function updateCountdown() {
  remainingSeconds.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  if (!hasStartedSigning.value) {
    idleRemainingSeconds.value = Math.max(0, Math.ceil((idleDeadline - Date.now()) / 1000))
    if (idleRemainingSeconds.value === 0) {
      stopTimer()
      close()
      return
    }
  }

  if (remainingSeconds.value === 0) {
    expired.value = true
    stopTimer()
    if (hasSignature.value) complete()
    else close()
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

function startSession() {
  completionRequested = false
  expired.value = false
  hasStartedSigning.value = false
  remainingSeconds.value = props.durationSeconds
  idleRemainingSeconds.value = props.idleTimeoutSeconds
  deadline = Date.now() + props.durationSeconds * 1000
  idleDeadline = Date.now() + props.idleTimeoutSeconds * 1000
  stopTimer()
  timerId = setInterval(updateCountdown, 100)
  window.addEventListener('keydown', handleKeydown)
  rootRef.value?.focus({ preventScroll: true })
}

function suspendSession() {
  stopTimer()
  window.removeEventListener('keydown', handleKeydown)
}

watch(
  () => props.active,
  (active) => {
    if (active) startSession()
    else suspendSession()
  },
)

onMounted(() => {
  resizeCanvas()
  resizeObserver = new ResizeObserver(resizeCanvas)
  if (canvasRef.value) resizeObserver.observe(canvasRef.value)
  if (props.active) startSession()
})

onBeforeUnmount(() => {
  suspendSession()
  clearSignature()
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <section
    ref="rootRef"
    class="screen signing-screen"
    aria-label="Tela para assinatura"
    tabindex="-1"
  >
    <div class="signing-screen__hand m m-pop">
      <SignatureHandCue />
    </div>

    <p class="visually-hidden">Use o dedo para escrever seu nome abaixo.</p>
    <TypedImage
      class="signing-screen__instructions"
      src="/images/texto-assinatura.webp"
      :width="728"
      :height="143"
      :lines="INSTRUCTION_LINES"
    />

    <div class="signing-screen__pad m m-line">
      <img class="signing-screen__pad-frame" src="/images/box-assinatura.webp" alt="" aria-hidden="true" draggable="false">
      <canvas
        ref="canvasRef"
        aria-label="Área para assinar usando o dedo ou uma caneta touch"
        @pointerdown="startDrawing"
        @pointermove="continueDrawing"
        @pointerup="stopDrawing"
        @pointercancel="stopDrawing"
        @lostpointercapture="stopDrawing"
      />
      <span class="signing-screen__countdown" role="timer" aria-live="off">
        {{ submitting ? 'Salvando…' : error ? 'Erro' : `${hasStartedSigning ? remainingSeconds : idleRemainingSeconds}s` }}
      </span>
      <div v-if="error" class="signing-screen__error">
        <p role="alert">{{ error }}</p>
        <button type="button" :disabled="submitting" @click="complete">
          {{ submitting ? 'Salvando…' : 'Tentar novamente' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.signing-screen {
  outline: none;
}

/* Full-screen layer so the hand cue keeps its absolute position while this wrapper is transformed. */
.signing-screen__hand {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform-origin: 630px 525px;
}

.signing-screen__instructions {
  position: absolute;
  top: 720px;
  left: 176px;
  width: 728px;
  height: 143px;
}

.signing-screen__pad {
  position: absolute;
  top: 908px;
  left: 92px;
  width: 897px;
  height: 288px;
}

.signing-screen__pad-frame {
  position: absolute;
  width: 897px;
  height: 288px;
  inset: 0;
  pointer-events: none;
}

.signing-screen__pad canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  inset: 0;
  touch-action: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.signing-screen__countdown {
  position: absolute;
  z-index: 2;
  top: 18px;
  right: 20px;
  display: grid;
  min-width: 60px;
  height: 38px;
  padding: 0 12px;
  place-items: center;
  border-radius: 19px;
  background: #00843d;
  box-shadow: 0 2px 6px rgb(0 0 0 / 15%);
  color: #fff;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  pointer-events: none;
}

.signing-screen__error {
  position: absolute;
  z-index: 3;
  top: 78px;
  left: 50%;
  display: grid;
  width: min(680px, calc(100% - 48px));
  justify-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 26px rgb(0 0 0 / 18%);
  color: #a12626;
  font-size: 16px;
  line-height: 1.4;
  text-align: center;
  transform: translateX(-50%);
}

.signing-screen__error p {
  margin: 0;
}

.signing-screen__error button {
  min-height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: #00843d;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.signing-screen__error button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.signing-screen button:focus-visible {
  outline: 3px solid #f4dc18;
  outline-offset: 3px;
}
</style>
