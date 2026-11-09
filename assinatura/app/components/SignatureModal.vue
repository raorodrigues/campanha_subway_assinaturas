<script setup lang="ts">
interface SignaturePoint {
  x: number
  y: number
  time: number
}

type SignatureStroke = SignaturePoint[]

const props = defineProps<{
  open: boolean
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
const dialogRef = ref<HTMLElement | null>(null)
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
  // Layout size ignores the preview scale applied to the kiosk canvas.
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

function drawFrame(now: number) {
  frameId = null
  const ctx = context
  if (!ctx) return

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  let hasVisibleTrail = false

  for (const stroke of strokes) {
    if (stroke.length === 1) {
      const point = stroke[0]!
      const age = now - point.time
      if (age < TRAIL_DURATION) {
        ctx.globalAlpha = 1 - age / TRAIL_DURATION
        ctx.fillStyle = '#17684f'
        ctx.beginPath()
        ctx.arc(point.x * canvasWidth, point.y * canvasHeight, 2.2, 0, Math.PI * 2)
        ctx.fill()
        hasVisibleTrail = true
      }
      continue
    }

    for (let index = 1; index < stroke.length; index += 1) {
      const from = stroke[index - 1]!
      const to = stroke[index]!
      const age = now - to.time
      if (age >= TRAIL_DURATION) continue

      ctx.globalAlpha = 1 - age / TRAIL_DURATION
      ctx.strokeStyle = '#17684f'
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(from.x * canvasWidth, from.y * canvasHeight)
      ctx.lineTo(to.x * canvasWidth, to.y * canvasHeight)
      ctx.stroke()
      hasVisibleTrail = true
    }
  }

  ctx.globalAlpha = 1
  if (isDrawing.value || hasVisibleTrail) requestDraw()
}

function getPoint(event: PointerEvent): SignaturePoint & { time: number } {
  const canvas = canvasRef.value
  if (!canvas) throw new Error('Signature canvas is unavailable')

  const rect = canvas.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    time: performance.now(),
  }
}

function startDrawing(event: PointerEvent) {
  if (props.submitting || completionRequested || expired.value || event.button !== 0 ||
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
  currentStroke.push(getPoint(event))
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

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      stopTimer()
      resizeObserver?.disconnect()
      resizeObserver = null
      window.removeEventListener('keydown', handleKeydown)
      clearSignature()
      hasStartedSigning.value = false
      return
    }

    completionRequested = false
    expired.value = false
    hasStartedSigning.value = false
    remainingSeconds.value = props.durationSeconds
    idleRemainingSeconds.value = props.idleTimeoutSeconds
    deadline = Date.now() + props.durationSeconds * 1000
    idleDeadline = Date.now() + props.idleTimeoutSeconds * 1000
    timerId = setInterval(updateCountdown, 100)
    await nextTick()
    if (!props.open) return
    resizeCanvas()
    resizeObserver = new ResizeObserver(resizeCanvas)
    if (canvasRef.value) resizeObserver.observe(canvasRef.value)
    window.addEventListener('keydown', handleKeydown)
    dialogRef.value?.focus()
  },
)

onBeforeUnmount(() => {
  stopTimer()
  clearSignature()
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', handleKeydown)
  if (frameId !== null) cancelAnimationFrame(frameId)
})
</script>

<template>
  <Transition name="signature-modal">
    <div v-if="open" class="signature-backdrop" @click.self="close">
      <section
        ref="dialogRef"
        class="signature-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Tela para assinatura"
        tabindex="-1"
      >
        <SignatureHandCue />
        <img
          class="signature-screen__instructions"
          src="/images/texto-assinatura.webp"
          alt="Use o dedo para escrever seu nome abaixo."
        >

        <div class="signature-pad">
          <img class="signature-pad__frame" src="/images/box-assinatura.webp" alt="" aria-hidden="true">
          <canvas
            ref="canvasRef"
            aria-label="Área para assinar usando o dedo ou uma caneta touch"
            @pointerdown="startDrawing"
            @pointermove="continueDrawing"
            @pointerup="stopDrawing"
            @pointercancel="stopDrawing"
            @lostpointercapture="stopDrawing"
          />
          <span class="signature-modal__countdown" role="timer" aria-live="off">
            {{ submitting ? 'Salvando…' : error ? 'Erro' : `${hasStartedSigning ? remainingSeconds : idleRemainingSeconds}s` }}
          </span>
          <div v-if="error" class="signature-modal__error">
            <p role="alert">{{ error }}</p>
            <button type="button" :disabled="submitting" @click="complete">
              {{ submitting ? 'Salvando…' : 'Tentar novamente' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.signature-backdrop {
  position: fixed;
  z-index: 10;
  width: 1080px;
  height: 1920px;
  inset: 0;
  overflow: hidden;
  background: #00843d url("/images/bg.webp") center / 1080px 1920px no-repeat;
}

.signature-modal {
  position: relative;
  width: 1080px;
  height: 1920px;
  outline: none;
}

.signature-screen__instructions {
  position: absolute;
  top: 720px;
  left: 176px;
  width: 728px;
  height: 143px;
}

.signature-pad {
  position: absolute;
  top: 908px;
  left: 92px;
  width: 897px;
  height: 288px;
}

.signature-pad__frame {
  position: absolute;
  width: 897px;
  height: 288px;
  inset: 0;
  pointer-events: none;
}

.signature-pad canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  inset: 0;
  touch-action: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.signature-modal-enter-active,
.signature-modal-leave-active {
  transition: opacity 360ms ease;
}

.signature-modal-enter-from,
.signature-modal-leave-to {
  opacity: 0;
}

.signature-modal__countdown {
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

.signature-modal__error {
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

.signature-modal__error p {
  margin: 0;
}

.signature-modal__error button {
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

.signature-modal__error button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.signature-modal button:focus-visible {
  outline: 3px solid #f4dc18;
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .signature-modal-enter-active,
  .signature-modal-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
