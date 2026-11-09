import { recordSignature } from '../../utils/signature-store'

export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  if (
    typeof body !== 'object' || body === null ||
    !('id' in body) || typeof body.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id) ||
    Object.keys(body).length !== 1
  ) {
    throw createError({ statusCode: 400, statusMessage: 'A submission UUID is required; signature data is not accepted' })
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return recordSignature(body.id)
})
