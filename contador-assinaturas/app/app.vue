<script setup lang="ts">
const total = ref<number | null>(null)
const connectionError = ref(false)
const formattedTotal = computed(() => total.value?.toLocaleString('pt-BR') ?? '—')
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

onMounted(() => {
  document.addEventListener('contextmenu', blockContextMenu)
  window.addEventListener('wheel', blockZoomWheel, { passive: false })
  void refreshCount()
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
  <main class="counter-screen">
    <NuxtRouteAnnouncer />
    <section aria-labelledby="counter-title">
      <h1 id="counter-title">Assinaturas</h1>
      <p class="counter-total" aria-label="Quantidade de assinaturas">{{ formattedTotal }}</p>
      <p v-if="connectionError" class="connection-error" role="status">
        {{ total === null
          ? 'Não foi possível conectar ao servidor de assinaturas.'
          : 'Conexão interrompida. Exibindo a última contagem recebida.' }}
        Tentando reconectar…
      </p>
      <p v-else-if="total === null" class="loading-message" role="status">Conectando…</p>
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f5f6f3;
  color: #17231f;
}

* {
  box-sizing: border-box;
  touch-action: pan-x pan-y;
}

html,
body {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  overscroll-behavior: none;
}

body {
  margin: 0;
  min-width: 320px;
}

.counter-screen {
  display: grid;
  min-height: 100vh;
  min-height: 100svh;
  padding: 24px;
  place-items: center;
  text-align: center;
}

.counter-screen section {
  width: min(100%, 900px);
}

.counter-screen h1 {
  margin: 0;
  color: #65716c;
  font-size: clamp(1.25rem, 4vw, 2rem);
  font-weight: 500;
}

.counter-total {
  margin: 20px 0;
  overflow-wrap: anywhere;
  color: #17684f;
  font-size: clamp(5rem, 18vw, 12rem);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.06em;
  line-height: 1.1;
}

.connection-error,
.loading-message {
  margin: 24px auto 0;
  max-width: 500px;
  line-height: 1.6;
}

.connection-error {
  color: #9e3d28;
}

.loading-message {
  color: #65716c;
}
</style>
