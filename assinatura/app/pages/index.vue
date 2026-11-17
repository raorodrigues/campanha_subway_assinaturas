<script setup lang="ts">
type KioskScreen = 'welcome' | 'signing' | 'thanks'
type Timer = ReturnType<typeof setTimeout>

const runtimeConfig = useRuntimeConfig()
const signatureIdleTimeoutSeconds = Number(runtimeConfig.public.signatureIdleTimeoutSeconds)
const signatureFinishPauseSeconds = Number(runtimeConfig.public.signatureFinishPauseSeconds)
const signatureMaxSeconds = Number(runtimeConfig.public.signatureMaxSeconds)

const SIGN_BUTTON_PRESS_DURATION = 180
const THANK_YOU_DURATION = 5000
const SUBMIT_REQUEST_TIMEOUT = 5000
const AUTO_RETRY_LIMIT = 2
const AUTO_RETRY_DELAY = 2000
const ERROR_RECOVERY_TIMEOUT = 15000
const SUBMISSION_ERROR_MESSAGE = 'Não foi possível registrar a assinatura. Toque em “Tentar novamente”.'
const KIOSK_WIDTH = 1080
const KIOSK_HEIGHT = 1920
// Bound with :src so Vue never builds the block from an HTML string: that
// happens in an inert <template>, where Chrome rejects a <video> for good
// ("Media load rejected by URL safety check"). See reloadFoodVideos().
//
// Played as the agency delivered them: 6 s each, all from frame 0. Chicken and
// Catupiry loop; the sandwich plays once and rests on its last frame.
const FOOD_VIDEOS = {
  lanche: { src: '/videos/lanche.webm', poster: '/videos/lanche-poster.webp' },
  frango: { src: '/videos/frango.webm', poster: '/videos/frango-poster.webp' },
  catupiry: { src: '/videos/catupiry.webm', poster: '/videos/catupiry-poster.webp' },
} as const
const KIOSK_IMAGES = [
  '/images/bg.webp',
  FOOD_VIDEOS.lanche.poster,
  FOOD_VIDEOS.frango.poster,
  FOOD_VIDEOS.catupiry.poster,
  '/images/parallax/selo.webp',
  '/images/box-assinatura.webp',
  '/images/maozinha.webp',
  '/images/maozinha-branca.webp',
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
  'POR *FRANGO*',
  '*COM CATUPIRY®*',
  'FOI REGISTRADO',
  'COM SUCESSO.',
]

for (const [name, value] of [
  ['NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS', signatureIdleTimeoutSeconds],
  ['NUXT_PUBLIC_SIGNATURE_FINISH_PAUSE_SECONDS', signatureFinishPauseSeconds],
  ['NUXT_PUBLIC_SIGNATURE_MAX_SECONDS', signatureMaxSeconds],
] as const) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`)
}

// The totem is touch-only, but Windows still draws the pointer where the finger
// is (or the whole time, on touch frames that report as a mouse). Hidden here;
// add ?cursor to the URL to see it while testing with a mouse.
const route = useRoute()
useHead({
  htmlAttrs: { class: computed(() => ('cursor' in route.query ? 'page-signature show-cursor' : 'page-signature')) },
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
const sounds = useKioskSounds()

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

// The whole welcome screen acts as the "Clique e assine" button: a tap anywhere
// shows the pressed artwork and opens the signature screen. The button itself
// stays focusable, and its keyboard click bubbles up to the same handler.
function activateSignButton() {
  if (signButtonTimeout !== null || screen.value !== 'welcome') return
  isSignButtonPressed.value = true
  sounds.play('button')
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
    sounds.play('success')
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

const foodRef = ref<HTMLElement | null>(null)

// With <Transition appear>, the server sends the first welcome inside a
// <template>, so its videos are parsed in an inert document and Chrome rejects
// them before Vue moves them into the page (nothing is even requested). Loading
// them again once they are live fixes it; later welcomes are built live.
function reloadFoodVideos() {
  for (const video of foodRef.value?.querySelectorAll('video') ?? []) {
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_EMPTY) video.load()
  }
}

onMounted(() => {
  reloadFoodVideos()
  updateKioskScale()
  window.addEventListener('resize', updateKioskScale)
  document.addEventListener('contextmenu', blockContextMenu)
  window.addEventListener('wheel', blockZoomWheel, { passive: false })
  preloadImages()
  sounds.preload()
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
  sounds.dispose()
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
            <span class="welcome-screen__button-face">
              Clique e assine
              <img class="welcome-screen__button-hand" src="/images/maozinha-branca.webp" alt="" draggable="false">
            </span>
          </button>

          <!--
            Each half enters and leaves on its own side. Inside, the agency's
            videos (fatiado/lanche|frango|catupiry.webm, rendered at their layout
            position on a 1080x1920 frame), cropped to each block and otherwise
            unchanged: 6 s (the sandwich plays once, the others loop). The poster (first frame) shows until the
            video starts.
          -->
          <div ref="foodRef" class="welcome-screen__food" aria-hidden="true">
            <div class="welcome-screen__food-left m m-left">
              <video
                class="food-video food-video--lanche"
                :src="FOOD_VIDEOS.lanche.src"
                :poster="FOOD_VIDEOS.lanche.poster"
                autoplay muted playsinline preload="auto"
                disablepictureinpicture disableremoteplayback tabindex="-1"
              />
            </div>
            <div class="welcome-screen__food-right m m-right">
              <video
                class="food-video food-video--catupiry"
                :src="FOOD_VIDEOS.catupiry.src"
                :poster="FOOD_VIDEOS.catupiry.poster"
                autoplay muted loop playsinline preload="auto"
                disablepictureinpicture disableremoteplayback tabindex="-1"
              />
              <video
                class="food-video food-video--frango"
                :src="FOOD_VIDEOS.frango.src"
                :poster="FOOD_VIDEOS.frango.poster"
                autoplay muted loop playsinline preload="auto"
                disablepictureinpicture disableremoteplayback tabindex="-1"
              />
              <img class="food-seal m m-pop" src="/images/parallax/selo.webp" alt="" draggable="false">
            </div>
          </div>
        </section>

        <SignatureScreen
          v-else-if="screen === 'signing'"
          key="signing"
          :active="isSigningActive"
          :submitting="isSubmitting"
          :error="submissionError"
          :idle-timeout-seconds="signatureIdleTimeoutSeconds"
          :finish-pause-seconds="signatureFinishPauseSeconds"
          :max-seconds="signatureMaxSeconds"
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
/* !important beats the per-component cursor rules (signature pad, buttons). */
html.page-signature:not(.show-cursor),
html.page-signature:not(.show-cursor) * {
  cursor: none !important;
}

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
 * "Clique e assine": a yellow face on a darker yellow slab (the 3D depth of the
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
  /* Nudges the centred text 3px right and down onto the PSD text box (194,905). */
  box-sizing: border-box;
  padding: 6px 0 0 6px;
  /* v3 PSD: SubwaySansCond-Bold, 149.79pt x 0.707 = 106px (the headline stays Black). */
  font-size: 106px;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
}

/*
 * layouts/mub_assinatura_v3.psd: white hand pointing at the button's lower
 * right corner, over its edge (PSD 821,994). Part of the face, so it sinks
 * with it when pressed.
 */
.welcome-screen__button-hand {
  position: absolute;
  top: 128px;
  left: 747px;
  width: 143px;
  height: 124px;
  max-width: none;
  pointer-events: none;
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

/*
 * The photos must read as one solid block: no background may show between
 * them. The halves overlap instead of just touching, because a scaled-down
 * preview puts their edges on half pixels: the left panel runs 2px under the
 * right one, and the block runs 2px down under the footer's white band (it is
 * drawn above it).
 */
.welcome-screen__food {
  --food-overlap: 2px;
  position: absolute;
  top: 1175px;
  left: 0;
  display: flex;
  width: 1080px;
  height: calc(461px + var(--food-overlap));
  overflow: hidden;
}

.welcome-screen__food-left {
  position: relative;
  width: calc(540px + var(--food-overlap));
  height: 100%;
  flex: 0 0 auto;
  margin-right: calc(-1 * var(--food-overlap));
  overflow: hidden;
  background: var(--kiosk-yellow);
}

/* Cream like the Catupiry's bottom rows: when scaled, a video's edge rounds
   differently from a panel's, so the panel's background (not the video)
   draws the bottom edge, level with the yellow one on the left. */
.welcome-screen__food-right {
  position: relative;
  width: 540px;
  height: 100%;
  flex: 0 0 540px;
  overflow: hidden;
  background: #eadcc8;
}

/*
 * Block videos. Each file holds only the full-colour part of the agency's
 * frame (its 1–2px dark edges are cut off), stretched by at most 1% to fill
 * its box: chicken 1175–1418px, Catupiry® 1418–1637px, under the chicken by 1px.
 */
.welcome-screen__food img {
  position: absolute;
  max-width: none;
}

.food-video {
  position: absolute;
  left: 0;
  display: block;
  width: 100%;
  object-fit: fill;
}

/*
 * Runs 4px past the panel's bottom (clipped there): on the Windows totem the
 * stretched video showed a thin green line along its bottom edge (the
 * decoder's padding rows; 456 is not a multiple of 16). Those bottom rows are
 * plain yellow, so cutting them changes nothing else.
 */
.food-video--lanche {
  top: 0;
  height: calc(100% + 4px);
}

.food-video--frango {
  top: 0;
  height: 244px;
}

/* An explicit height: on a <video>, top + bottom alone keep the video's own
   aspect ratio, which ended it 1.2px above the sandwich panel (a visible step). */
.food-video--catupiry {
  top: 243px;
  height: calc(100% - 243px);
}

/* PSD "AF_CATUPIRY_SELO": stays still in front of the videos. */
.food-seal {
  top: 205px;
  left: 335px;
  width: 143px;
  height: 256px;
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
