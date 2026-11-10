// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // Bundled locally: the kiosk runs offline.
  css: ['@fontsource/anton/latin.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
    },
  },
  runtimeConfig: {
    signatureApiBase: 'http://127.0.0.1:3000',
  },
})
