// Signatures collected outside this kiosk, added to the total shown on the API
// and the LED panel. Never stored in SQLite: changing it only changes the
// display. Set with NUXT_SIGNATURE_COUNT_OFFSET (Nuxt parses the env value).
export function parseSignatureCountOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`NUXT_SIGNATURE_COUNT_OFFSET must be a whole number ≥ 0 (got ${JSON.stringify(value)}).`)
  }
  return value
}

export function withSignatureCountOffset(count: { total: number }) {
  const offset = parseSignatureCountOffset(useRuntimeConfig().signatureCountOffset)
  return { total: count.total + offset }
}
