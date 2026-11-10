<script setup lang="ts">
type KioskScreen = 'welcome' | 'signing' | 'thanks'
type Timer = ReturnType<typeof setTimeout>

const runtimeConfig = useRuntimeConfig()
const signatureCountdownSeconds = Number(runtimeConfig.public.signatureCountdownSeconds)
const signatureIdleTimeoutSeconds = Number(runtimeConfig.public.signatureIdleTimeoutSeconds)

const SIGN_BUTTON_PRESS_DURATION = 180
const THANK_YOU_DURATION = 5000
const SUBMIT_REQUEST_TIMEOUT = 5000
const AUTO_RETRY_LIMIT = 2
const AUTO_RETRY_DELAY = 2000
const ERROR_RECOVERY_TIMEOUT = 15000
const SUBMISSION_ERROR_MESSAGE = 'Não foi possível registrar a assinatura. Toque em “Tentar novamente”.'
const KIOSK_WIDTH = 1080
const KIOSK_HEIGHT = 1920
const KIOSK_IMAGES = [
  '/images/bg.webp',
  '/images/texto-eleja.webp',
  '/images/botao-assine-repouso.webp',
  '/images/botao-assine-clicado.webp',
  '/images/lanche.webp',
  '/images/foto-direita.webp',
  '/images/texto-assinatura.webp',
  '/images/box-assinatura.webp',
  '/images/maozinha.webp',
  '/images/texto-obrigado.webp',
] as const

if (!Number.isSafeInteger(signatureCountdownSeconds) || signatureCountdownSeconds < 1) {
  throw new Error('NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS must be a positive integer.')
}

if (!Number.isSafeInteger(signatureIdleTimeoutSeconds) || signatureIdleTimeoutSeconds < 1) {
  throw new Error('NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS must be a positive integer.')
}

useHead({
  link: KIOSK_IMAGES.map(href => ({ rel: 'preload', as: 'image', type: 'image/webp', href })),
})

const screen = ref<KioskScreen>('welcome')
const isTransitioning = ref(false)
const isAttracting = ref(false)
const isSigningActive = ref(false)
const isSubmitting = ref(false)
const submissionError = ref('')
const isSignButtonPressed = ref(false)
const kioskScale = ref(1)

let submissionId = ''
let autoRetriesLeft = 0
let thankYouTimeout: Timer | null = null
let signButtonTimeout: Timer | null = null
let autoRetryTimeout: Timer | null = null
let recoveryTimeout: Timer | null = null
// Holds decoded images so the browser keeps them ready for later screens.
const preloadedImages: HTMLImageElement[] = []

function cancelTimer(timer: Timer | null): null {
  if (timer !== null) clearTimeout(timer)
  return null
}

// The kiosk display is exactly 1080×1920 (scale 1); smaller windows get a scaled preview.
function updateKioskScale() {
  kioskScale.value = Math.min(1, window.innerWidth / KIOSK_WIDTH, window.innerHeight / KIOSK_HEIGHT)
}

function blockContextMenu(event: Event) {
  event.preventDefault()
}

// Touchpad pinch and Ctrl+wheel arrive as wheel events with ctrlKey on Windows.
function blockZoomWheel(event: WheelEvent) {
  if (event.ctrlKey) event.preventDefault()
}

function preloadImages() {
  for (const src of KIOSK_IMAGES) {
    const image = new Image()
    image.decoding = 'async'
    image.src = src
    // A failed decode only means the image paints a little later; nothing to recover.
    image.decode().catch(() => undefined)
    preloadedImages.push(image)
  }
}

/* ----------------------------- Screen transitions ----------------------------- */

function onScreenBeforeLeave() {
  isTransitioning.value = true
  isAttracting.value = false
  isSigningActive.value = false
}

function onScreenBeforeEnter() {
  isTransitioning.value = true
}

function onScreenAfterEnter() {
  isTransitioning.value = false
  if (screen.value === 'welcome') isAttracting.value = true
  else if (screen.value === 'signing') isSigningActive.value = true
  else startThankYouTimer()
}

function onScreenEnterCancelled() {
  isTransitioning.value = false
}

function startThankYouTimer() {
  thankYouTimeout = cancelTimer(thankYouTimeout)
  thankYouTimeout = setTimeout(() => {
    thankYouTimeout = null
    if (screen.value === 'thanks') screen.value = 'welcome'
  }, THANK_YOU_DURATION)
}

/* ------------------------------- Welcome screen ------------------------------- */

function openSignatureScreen() {
  thankYouTimeout = cancelTimer(thankYouTimeout)
  submissionId = createSubmissionId()
  submissionError.value = ''
  screen.value = 'signing'
}

function pressSignButton() {
  if (signButtonTimeout === null) isSignButtonPressed.value = true
}

function releaseSignButton() {
  if (signButtonTimeout === null) isSignButtonPressed.value = false
}

function activateSignButton() {
  if (signButtonTimeout !== null || screen.value !== 'welcome') return
  isSignButtonPressed.value = true
  // Keeps the pressed artwork visible briefly before switching screens.
  signButtonTimeout = setTimeout(() => {
    signButtonTimeout = null
    isSignButtonPressed.value = false
    openSignatureScreen()
  }, SIGN_BUTTON_PRESS_DURATION)
}

function createSubmissionId() {
  // crypto.randomUUID is unavailable on a kiosk accessed over plain HTTP on a LAN.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/* ------------------------------ Signature submit ------------------------------ */

function clearRecoveryTimers() {
  autoRetryTimeout = cancelTimer(autoRetryTimeout)
  recoveryTimeout = cancelTimer(recoveryTimeout)
}

function handleSignatureClose() {
  clearRecoveryTimers()
  if (screen.value === 'signing') screen.value = 'welcome'
}

// Emitted for the first completion and for every manual "Tentar novamente" tap.
function handleSignatureComplete() {
  if (isSubmitting.value || screen.value !== 'signing') return
  autoRetryTimeout = cancelTimer(autoRetryTimeout)
  autoRetriesLeft = AUTO_RETRY_LIMIT
  // A manual retry counts as interaction, so the give-up deadline starts over.
  if (submissionError.value) armRecoveryDeadline()
  void submitSignature()
}

async function submitSignature() {
  const sessionId = submissionId
  isSubmitting.value = true
  try {
    // Same UUID on every attempt: the server ignores duplicates.
    await $fetch('/api/signatures', { method: 'POST', body: { id: sessionId }, timeout: SUBMIT_REQUEST_TIMEOUT })
    if (sessionId !== submissionId) return
    clearRecoveryTimers()
    submissionError.value = ''
    screen.value = 'thanks'
  } catch (error) {
    if (sessionId !== submissionId) return
    console.error('Failed to persist signature count', error)
    submissionError.value = SUBMISSION_ERROR_MESSAGE
    if (recoveryTimeout === null) armRecoveryDeadline()
    scheduleAutoRetry()
  } finally {
    if (sessionId === submissionId) isSubmitting.value = false
  }
}

function scheduleAutoRetry() {
  if (autoRetriesLeft <= 0) return
  autoRetriesLeft -= 1
  autoRetryTimeout = cancelTimer(autoRetryTimeout)
  autoRetryTimeout = setTimeout(() => {
    autoRetryTimeout = null
    if (!isSubmitting.value && screen.value === 'signing') void submitSignature()
  }, AUTO_RETRY_DELAY)
}

function armRecoveryDeadline() {
  recoveryTimeout = cancelTimer(recoveryTimeout)
  recoveryTimeout = setTimeout(abandonSubmission, ERROR_RECOVERY_TIMEOUT)
}

// Still failing with nobody around: go back to welcome so the kiosk never sticks on an error.
function abandonSubmission() {
  recoveryTimeout = null
  autoRetryTimeout = cancelTimer(autoRetryTimeout)
  submissionId = ''
  isSubmitting.value = false
  submissionError.value = ''
  if (screen.value === 'signing') screen.value = 'welcome'
}

/* --------------------------------- Lifecycle --------------------------------- */

onMounted(() => {
  updateKioskScale()
  window.addEventListener('resize', updateKioskScale)
  document.addEventListener('contextmenu', blockContextMenu)
  window.addEventListener('wheel', blockZoomWheel, { passive: false })
  preloadImages()
  // The first welcome is server-rendered without an enter animation, so it is idle right away.
  if (screen.value === 'welcome') isAttracting.value = true
})

onBeforeUnmount(() => {
  thankYouTimeout = cancelTimer(thankYouTimeout)
  signButtonTimeout = cancelTimer(signButtonTimeout)
  clearRecoveryTimers()
  window.removeEventListener('resize', updateKioskScale)
  document.removeEventListener('contextmenu', blockContextMenu)
  window.removeEventListener('wheel', blockZoomWheel)
  preloadedImages.length = 0
})
</script>

<template>
  <main class="kiosk" :style="{ '--kiosk-scale': kioskScale }">
    <NuxtRouteAnnouncer />

    <!-- Shared by every screen; never part of a transition. -->
    <img class="screen-background" src="/images/bg.webp" alt="" draggable="false">

    <div class="stage" :class="{ 'is-transitioning': isTransitioning }" :data-screen="screen">
      <Transition
        name="screen"
        mode="out-in"
        @before-leave="onScreenBeforeLeave"
        @before-enter="onScreenBeforeEnter"
        @after-enter="onScreenAfterEnter"
        @enter-cancelled="onScreenEnterCancelled"
      >
        <section
          v-if="screen === 'welcome'"
          key="welcome"
          class="screen welcome-screen"
          :class="{ 'is-attracting': isAttracting }"
          aria-labelledby="welcome-title"
        >
          <h1 id="welcome-title" class="visually-hidden">Eleja frango com Catupiry, patrimônio afetivo brasileiro</h1>
          <img
            class="welcome-screen__headline m m-drop"
            src="/images/texto-eleja.webp"
            alt=""
            aria-hidden="true"
            draggable="false"
          >

          <button
            class="welcome-screen__button m m-pop"
            :class="{ 'is-pressed': isSignButtonPressed }"
            type="button"
            aria-label="Assine aqui"
            @pointerdown="pressSignButton"
            @pointerup="releaseSignButton"
            @pointerleave="releaseSignButton"
            @pointercancel="releaseSignButton"
            @click="activateSignButton"
          >
            <span class="welcome-screen__button-art">
              <img class="welcome-screen__button-idle" src="/images/botao-assine-repouso.webp" alt="" draggable="false">
              <img class="welcome-screen__button-pressed" src="/images/botao-assine-clicado.webp" alt="" draggable="false">
            </span>
          </button>

          <div class="welcome-screen__food" aria-hidden="true">
            <div class="welcome-screen__food-left m m-left">
              <img src="/images/lanche.webp" alt="" draggable="false">
            </div>
            <img class="welcome-screen__food-right m m-right" src="/images/foto-direita.webp" alt="" draggable="false">
          </div>
        </section>

        <SignatureScreen
          v-else-if="screen === 'signing'"
          key="signing"
          :active="isSigningActive"
          :submitting="isSubmitting"
          :error="submissionError"
          :duration-seconds="signatureCountdownSeconds"
          :idle-timeout-seconds="signatureIdleTimeoutSeconds"
          @close="handleSignatureClose"
          @complete="handleSignatureComplete"
        />

        <section v-else key="thanks" class="screen thank-you-screen" aria-label="Agradecimento">
          <img
            class="thank-you-screen__message m m-zoom"
            src="/images/texto-obrigado.webp"
            alt="Obrigado pela participação."
            draggable="false"
          >
        </section>
      </Transition>
    </div>
  </main>
</template>

<style>
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: #00843d;
  color: #17231f;
}

* {
  box-sizing: border-box;
}

html,
body,
#__nuxt {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

/* Kiosk hardening: no text selection, callouts, overscroll, pinch/double-tap zoom or image drag. */
html,
body {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  overscroll-behavior: none;
}

/*
 * Desktop Chrome/Edge on Windows ignore `user-scalable=no`, and `manipulation`
 * still allows pinch zoom. Set on every element (touch-action is not inherited);
 * the signature canvas overrides it with `none`.
 */
* {
  touch-action: pan-x pan-y;
}

img {
  -webkit-user-drag: none;
}

button {
  font: inherit;
}

.kiosk {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1080px;
  height: 1920px;
  overflow: hidden;
  background: #00843d;
  transform: translate(-50%, -50%) scale(var(--kiosk-scale, 1));
}

.stage {
  position: absolute;
  inset: 0;
}

/* Taps are ignored while a screen change is animating. */
.stage.is-transitioning {
  pointer-events: none;
}

.screen {
  position: absolute;
  width: 1080px;
  height: 1920px;
  overflow: hidden;
  inset: 0;
}

.screen-background {
  position: absolute;
  width: 1080px;
  height: 1920px;
  inset: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

.welcome-screen__headline {
  position: absolute;
  top: 130px;
  left: 78px;
  width: 924px;
  height: 624px;
}

.welcome-screen__button {
  position: absolute;
  top: 866px;
  left: 74px;
  width: 918px;
  height: 187px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.welcome-screen__button-art {
  position: absolute;
  inset: 0;
  display: block;
}

/* Both artworks share the same bottom-right corner in the reference layouts. */
.welcome-screen__button img {
  position: absolute;
  right: 0;
  bottom: 0;
  display: block;
  max-width: none;
  pointer-events: none;
}

.welcome-screen__button-idle {
  width: 918px;
  height: 187px;
}

.welcome-screen__button-pressed {
  width: 896px;
  height: 154px;
  visibility: hidden;
}

.welcome-screen__button.is-pressed .welcome-screen__button-idle {
  visibility: hidden;
}

.welcome-screen__button.is-pressed .welcome-screen__button-pressed {
  visibility: visible;
}

.welcome-screen__button:focus-visible {
  outline: 4px solid #fff;
  outline-offset: 10px;
  border-radius: 22px;
}

.welcome-screen__food {
  position: absolute;
  top: 1175px;
  left: 0;
  display: flex;
  width: 1080px;
  height: 461px;
  overflow: hidden;
}

.welcome-screen__food-left {
  position: relative;
  width: 540px;
  height: 461px;
  flex: 0 0 540px;
  overflow: hidden;
  background: #f4dc18;
}

.welcome-screen__food-left img {
  position: absolute;
  top: -68px;
  left: 0;
  width: 1080px;
  height: 597px;
  max-width: none;
}

.welcome-screen__food-right {
  width: 540px;
  height: 461px;
  flex: 0 0 540px;
}

.thank-you-screen__message {
  position: absolute;
  top: 745px;
  left: 117px;
  width: 846px;
  height: 249px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
