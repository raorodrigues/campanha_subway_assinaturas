<script setup lang="ts">
const isSignatureModalOpen = ref(false)
const hasCompletedSignature = ref(false)
const isSubmitting = ref(false)
const submissionError = ref('')
const isSignButtonPressed = ref(false)
const runtimeConfig = useRuntimeConfig()
const signatureCountdownSeconds = Number(runtimeConfig.public.signatureCountdownSeconds)
const signatureIdleTimeoutSeconds = Number(runtimeConfig.public.signatureIdleTimeoutSeconds)
let submissionId = ''
let thankYouTimeout: ReturnType<typeof setTimeout> | null = null
let signButtonTimeout: ReturnType<typeof setTimeout> | null = null

const SIGN_BUTTON_PRESS_DURATION = 180
const KIOSK_WIDTH = 1080
const KIOSK_HEIGHT = 1920

const kioskScale = ref(1)

// The kiosk display is exactly 1080×1920 (scale 1); smaller windows get a scaled preview.
function updateKioskScale() {
  kioskScale.value = Math.min(1, window.innerWidth / KIOSK_WIDTH, window.innerHeight / KIOSK_HEIGHT)
}

onMounted(() => {
  updateKioskScale()
  window.addEventListener('resize', updateKioskScale)
})

if (!Number.isSafeInteger(signatureCountdownSeconds) || signatureCountdownSeconds < 1) {
  throw new Error('NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS must be a positive integer.')
}

if (!Number.isSafeInteger(signatureIdleTimeoutSeconds) || signatureIdleTimeoutSeconds < 1) {
  throw new Error('NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS must be a positive integer.')
}

function openSignatureModal() {
  if (thankYouTimeout !== null) clearTimeout(thankYouTimeout)
  thankYouTimeout = null
  submissionId = createSubmissionId()
  submissionError.value = ''
  hasCompletedSignature.value = false
  isSignatureModalOpen.value = true
}

function pressSignButton() {
  if (signButtonTimeout === null) isSignButtonPressed.value = true
}

function releaseSignButton() {
  if (signButtonTimeout === null) isSignButtonPressed.value = false
}

function activateSignButton() {
  if (signButtonTimeout !== null) return
  isSignButtonPressed.value = true
  // Keeps the pressed artwork visible briefly before switching screens.
  signButtonTimeout = setTimeout(() => {
    signButtonTimeout = null
    isSignButtonPressed.value = false
    openSignatureModal()
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

async function completeSignature() {
  if (isSubmitting.value) return
  isSubmitting.value = true
  submissionError.value = ''
  try {
    await $fetch('/api/signatures', { method: 'POST', body: { id: submissionId } })
    isSignatureModalOpen.value = false
    hasCompletedSignature.value = true
    thankYouTimeout = setTimeout(() => {
      hasCompletedSignature.value = false
      thankYouTimeout = null
    }, 5000)
  } catch (error) {
    console.error('Failed to persist signature count', error)
    submissionError.value = 'Não foi possível registrar a assinatura. Toque em “Tentar novamente”.'
  } finally {
    isSubmitting.value = false
  }
}

onBeforeUnmount(() => {
  if (thankYouTimeout !== null) clearTimeout(thankYouTimeout)
  if (signButtonTimeout !== null) clearTimeout(signButtonTimeout)
  window.removeEventListener('resize', updateKioskScale)
})
</script>

<template>
  <main class="kiosk" :style="{ '--kiosk-scale': kioskScale }">
    <NuxtRouteAnnouncer />

    <Transition name="kiosk-page" mode="out-in">
      <section v-if="hasCompletedSignature" key="thank-you" class="thank-you-screen" aria-label="Agradecimento">
        <img class="screen-background" src="/images/bg.webp" alt="">
        <img class="thank-you-screen__message" src="/images/texto-obrigado.webp" alt="Obrigado pela participação.">
      </section>

      <section v-else key="welcome" class="welcome-screen" aria-labelledby="welcome-title">
        <img class="screen-background" src="/images/bg.webp" alt="">
        <h1 id="welcome-title" class="visually-hidden">Eleja frango com Catupiry, patrimônio afetivo brasileiro</h1>
        <img class="welcome-screen__headline" src="/images/texto-eleja.webp" alt="" aria-hidden="true">

        <button
          class="welcome-screen__button"
          :class="{ 'is-pressed': isSignButtonPressed }"
          type="button"
          aria-label="Assine aqui"
          @pointerdown="pressSignButton"
          @pointerup="releaseSignButton"
          @pointerleave="releaseSignButton"
          @pointercancel="releaseSignButton"
          @click="activateSignButton"
        >
          <img class="welcome-screen__button-idle" src="/images/botao-assine-repouso.webp" alt="">
          <img class="welcome-screen__button-pressed" src="/images/botao-assine-clicado.webp" alt="">
        </button>

        <div class="welcome-screen__food" aria-hidden="true">
          <div class="welcome-screen__food-left">
            <img src="/images/lanche.webp" alt="">
          </div>
          <img class="welcome-screen__food-right" src="/images/foto-direita.webp" alt="">
        </div>
      </section>
    </Transition>

    <SignatureModal
      :open="isSignatureModalOpen"
      :submitting="isSubmitting"
      :error="submissionError"
      :duration-seconds="signatureCountdownSeconds"
      :idle-timeout-seconds="signatureIdleTimeoutSeconds"
      @close="isSignatureModalOpen = false"
      @complete="completeSignature"
    />
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

.welcome-screen,
.thank-you-screen {
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
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
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

.kiosk-page-enter-active,
.kiosk-page-leave-active {
  transition: opacity 360ms ease, transform 360ms ease;
}

.kiosk-page-enter-from {
  transform: translateY(14px);
  opacity: 0;
}

.kiosk-page-leave-to {
  transform: translateY(-14px);
  opacity: 0;
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
