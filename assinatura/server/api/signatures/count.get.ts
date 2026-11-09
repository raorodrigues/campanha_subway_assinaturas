import { getSignatureCount } from '../../utils/signature-store'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getSignatureCount()
})
