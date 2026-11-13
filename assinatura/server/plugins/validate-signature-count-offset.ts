// Refuse to start with an invalid offset: a crash with a clear log line beats a
// wrong number on the LED panel.
export default defineNitroPlugin(() => {
  parseSignatureCountOffset(useRuntimeConfig().signatureCountOffset)
})
