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
  '/images/lanche.webp',
  '/images/foto-direita.webp',
  '/images/box-assinatura.webp',
  '/images/maozinha.webp',
] as const

// Live text in the official font. *Asterisks* mark the highlighted words
// (yellow; they flash white in attract mode). Line breaks follow the layout.
const WELCOME_LINES = [
  'ELEJA *FRANGO*',
  '*COM CATUPIRY®*',
  'PATRIMÔNIO',
  'AFETIVO',
  'BRASILEIRO',
]
const THANK_YOU_LINES = [
  'MUITO',
  'OBRIGADO!',
  'SEU AMOR',
  'POR FRANGO',
  'COM CATUPIRY®',
  'FOI REGISTRADO',
  'COM SUCESSO.',
]

if (!Number.isSafeInteger(signatureCountdownSeconds) || signatureCountdownSeconds < 1) {
  throw new Error('NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS must be a positive integer.')
}

if (!Number.isSafeInteger(signatureIdleTimeoutSeconds) || signatureIdleTimeoutSeconds < 1) {
  throw new Error('NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS must be a positive integer.')
}

useHead({
  htmlAttrs: { class: 'page-signature' },
  meta: [
    { name: 'viewport', content: `width=${KIOSK_WIDTH}, initial-scale=1, maximum-scale=1, user-scalable=no` },
  ],
  link: KIOSK_IMAGES.map(href => ({ rel: 'preload', as: 'image', type: 'image/webp', href })),
})

const screen = ref<KioskScreen>('welcome')
// False until hydration: hides the server-rendered welcome so it can play its entrance.
const isReady = ref(false)
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

// Taps are blocked only while a screen leaves. During an enter, objects that are not
// visible yet are `visibility: hidden` (motion.css), so the welcome button works as soon as it shows.
function onScreenBeforeLeave() {
  isTransitioning.value = true
  isAttracting.value = false
  isSigningActive.value = false
}

function onScreenAfterLeave() {
  isTransitioning.value = false
}

function onScreenAfterEnter() {
  if (screen.value === 'welcome') isAttracting.value = true
  else if (screen.value === 'signing') isSigningActive.value = true
  else startThankYouTimer()
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

// The whole welcome screen acts as the "Assine aqui" button: a tap anywhere
// shows the pressed artwork and opens the signature screen. The button itself
// stays focusable, and its keyboard click bubbles up to the same handler.
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
  // The first welcome plays its entrance through <Transition appear>; its after-enter starts attract mode.
  isReady.value = true
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
  <main class="kiosk" :class="{ 'is-ready': isReady }" :style="{ '--kiosk-scale': kioskScale }">

    <!-- Shared by every screen; never part of a transition. -->
    <WaveBackground />
    <!-- Only the white Subway footer of bg.webp shows; it rises once when the page boots. -->
    <img class="screen-footer" src="/images/bg.webp" alt="" draggable="false">

    <div class="stage" :class="{ 'is-transitioning': isTransitioning }" :data-screen="screen">
      <Transition
        name="screen"
        mode="out-in"
        appear
        @before-leave="onScreenBeforeLeave"
        @after-leave="onScreenAfterLeave"
        @after-enter="onScreenAfterEnter"
      >
        <section
          v-if="screen === 'welcome'"
          key="welcome"
          class="screen welcome-screen"
          :class="{ 'is-attracting': isAttracting }"
          aria-labelledby="welcome-title"
          @pointerdown="pressSignButton"
          @pointerup="releaseSignButton"
          @pointerleave="releaseSignButton"
          @pointercancel="releaseSignButton"
          @click="activateSignButton"
        >
          <WordReveal id="welcome-title" tag="h1" class="welcome-screen__headline" :lines="WELCOME_LINES" />

          <button
            class="welcome-screen__button m m-pop"
            :class="{ 'is-pressed': isSignButtonPressed }"
            type="button"
          >
            <span class="welcome-screen__button-face">Assine aqui</span>
          </button>

          <!-- As in the first version: each photo enters and leaves on its own side. -->
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
          <WordReveal class="thank-you-screen__message" :lines="THANK_YOU_LINES" />
        </section>
      </Transition>
    </div>
  </main>
</template>

<style>
/* Shared kiosk resets live in app.vue; this screen only sets its own colours. */
html.page-signature {
  color-scheme: light;
  background: #00843d;
  color: #17231f;
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

/* Taps are ignored while a screen leaves (see onScreenBeforeLeave). */
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

.screen-footer {
  position: absolute;
  width: 1080px;
  height: 1920px;
  inset: 0;
  clip-path: inset(1636px 0 0 0);
}

/* Before hydration: no screen yet, footer below the edge (see motion.css for the boot animation). */
.kiosk:not(.is-ready) .stage {
  opacity: 0;
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

.kiosk {
  --kiosk-white: #fff;
  /* Sampled from the artwork: the headline yellow and the button face match. */
  --kiosk-yellow: #f2db25;
  --button-face: #f2db25;
  --button-depth: #daaa06;
  --button-text: #00471d;
}

/*
 * Headline and thank-you text, measured on the artwork they replace: Subway
 * Sans Cond Black, 113px caps (156px type) on a 128px line pitch, slightly
 * tightened as in the layout.
 */
.welcome-screen__headline,
.thank-you-screen__message {
  position: absolute;
  color: var(--kiosk-white);
  font-size: 156px;
  font-weight: 900;
  line-height: 128px;
  letter-spacing: -0.025em;
  text-transform: uppercase;
}

/* In a 128px line box the caps start ~1px below the top: matches the artwork at y=130. */
.welcome-screen__headline {
  top: 129px;
  left: 78px;
}

.word-reveal__word--highlight {
  color: var(--kiosk-yellow);
}

/*
 * "Assine aqui": a yellow face on a darker yellow slab (the 3D depth of the
 * layout). The depth is drawn with stacked shadows so it reads as one solid
 * extrusion; pressing slides the face down into it.
 */
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

.welcome-screen__button-face {
  --depth-shadow:
    3px 3px 0 var(--button-depth), 6px 6px 0 var(--button-depth),
    9px 9px 0 var(--button-depth), 12px 12px 0 var(--button-depth),
    15px 15px 0 var(--button-depth), 18px 18px 0 var(--button-depth),
    21px 21px 0 var(--button-depth), 22px 24px 0 var(--button-depth);
  --pressed-shadow:
    0 0 0 var(--button-depth), 0 0 0 var(--button-depth),
    0 0 0 var(--button-depth), 0 0 0 var(--button-depth),
    0 0 0 var(--button-depth), 0 0 0 var(--button-depth),
    0 0 0 var(--button-depth), 0 0 0 var(--button-depth);
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 896px;
  height: 160px;
  border-radius: 22px;
  background: var(--button-face);
  box-shadow: var(--depth-shadow);
  color: var(--button-text);
  font-size: 104px;
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
}

.welcome-screen__button.is-pressed .welcome-screen__button-face {
  transform: translate(22px, 24px);
  box-shadow: var(--pressed-shadow);
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

/* Seven lines (896px), centred in the green area above the footer (0–1636px). */
.thank-you-screen__message {
  top: 370px;
  left: 0;
  width: 1080px;
  text-align: center;
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
