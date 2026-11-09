// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  app: {
    head: {
      meta: [
        { name: 'viewport', content: 'width=1080, initial-scale=1' }
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
