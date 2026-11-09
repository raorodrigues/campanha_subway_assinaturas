export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig(event)

  try {
    const response: unknown = await $fetch('/api/signatures/count', {
      baseURL: config.signatureApiBase,
      timeout: 3000,
      retry: 0,
    })

    if (
      typeof response !== 'object' || response === null ||
      !('total' in response) || typeof response.total !== 'number' ||
      !Number.isSafeInteger(response.total) || response.total < 0
    ) {
      throw new Error('Signature server returned an invalid count')
    }

    return { total: response.total }
  } catch (error) {
    console.error('Failed to retrieve signature count', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Signature count unavailable',
    })
  }
})
