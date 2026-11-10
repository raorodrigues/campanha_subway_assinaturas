// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/motion.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      meta: [
        { name: 'viewport', content: 'width=1080, initial-scale=1, maximum-scale=1, user-scalable=no' }
      ]
    }
  },
  runtimeConfig: {
    public: {
      signatureCountdownSeconds: 10,
      signatureIdleTimeoutSeconds: 5
    }
  }
})
