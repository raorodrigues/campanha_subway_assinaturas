import { assertSubwayFonts } from './scripts/subway-fonts.mjs'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/fonts.css', '~/assets/css/motion.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
    }
  },
  hooks: {
    // Fail before bundling rather than ship a fallback face to the kiosk.
    // Not on `nuxt prepare`, so a fresh `npm install` still works without the zip.
    'build:before': () => assertSubwayFonts(),
  },
  runtimeConfig: {
    public: {
      signatureCountdownSeconds: 10,
      signatureIdleTimeoutSeconds: 5
    }
  }
})
