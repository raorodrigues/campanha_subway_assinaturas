import { getSignatureCount } from '../../utils/signature-store'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return withSignatureCountOffset(await getSignatureCount())
})
