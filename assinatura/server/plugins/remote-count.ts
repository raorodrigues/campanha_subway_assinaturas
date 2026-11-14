import { parseRemoteCountConfig, startRemoteCountPolling } from '../utils/remote-count'

// Adds the campaign's online signature count to the panel when
// NUXT_REMOTE_COUNT_URL is set. Invalid settings stop the server at startup.
export default defineNitroPlugin((nitroApp) => {
  const config = parseRemoteCountConfig(useRuntimeConfig())
  if (!config) return
  const stop = startRemoteCountPolling(config)
  nitroApp.hooks.hook('close', stop)
})
