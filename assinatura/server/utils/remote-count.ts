import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { storeRemoteCount } from './signature-store'

// Signatures from the campaign's online API (GET …/signatures/count, JWT Bearer,
// answers {"count": N}). The kiosk may lose internet at any time, so a failed
// call never changes the shown total: the last good count stays in SQLite.
export const REMOTE_REQUEST_TIMEOUT_MS = 10_000
export const MAX_RETRY_DELAY_SECONDS = 600

export interface RemoteCountConfig {
  url: string
  intervalSeconds: number
  tokenFile: string
}

export type RemoteCountResult =
  | { ok: true, total: number }
  | { ok: false, reason: string, rateLimited?: boolean }

// Empty URL = feature off (fully offline kiosk). Anything else must be valid,
// or the server refuses to start with a clear log line.
export function parseRemoteCountConfig(config: Record<string, unknown>): RemoteCountConfig | undefined {
  const url = typeof config.remoteCountUrl === 'string' ? config.remoteCountUrl.trim() : ''
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`NUXT_REMOTE_COUNT_URL is not a valid URL (got ${JSON.stringify(url)}).`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('NUXT_REMOTE_COUNT_URL must start with https://.')
  }
  const intervalSeconds = config.remoteCountIntervalSeconds
  if (typeof intervalSeconds !== 'number' || !Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86_400) {
    throw new Error(`NUXT_REMOTE_COUNT_INTERVAL_SECONDS must be a whole number from 1 to 86400 (got ${JSON.stringify(intervalSeconds)}).`)
  }
  const tokenFile = typeof config.remoteCountTokenFile === 'string' ? config.remoteCountTokenFile.trim() : ''
  if (!tokenFile) throw new Error('NUXT_REMOTE_COUNT_TOKEN_FILE is required when NUXT_REMOTE_COUNT_URL is set.')
  return { url, intervalSeconds, tokenFile: resolve(tokenFile) }
}

// Read on every call, so replacing token.txt (30-day JWT) needs no restart.
async function readToken(tokenFile: string) {
  try {
    return (await readFile(tokenFile, 'utf8')).trim().replace(/^Bearer\s+/i, '')
  } catch {
    return ''
  }
}

export async function fetchRemoteCount(config: RemoteCountConfig): Promise<RemoteCountResult> {
  const token = await readToken(config.tokenFile)
  if (!token) return { ok: false, reason: `token file missing or empty: ${config.tokenFile}` }

  let response: Response
  try {
    response = await fetch(config.url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { ok: false, reason: name === 'TimeoutError' ? 'timed out' : 'no connection' }
  }

  if (response.status === 401) return { ok: false, reason: 'HTTP 401: token invalid or expired, ask for a new one' }
  if (response.status === 429) return { ok: false, reason: 'HTTP 429: too many requests', rateLimited: true }
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, reason: 'answer is not JSON' }
  }
  const count = typeof body === 'object' && body !== null && 'count' in body ? body.count : undefined
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    return { ok: false, reason: 'answer has no valid "count"' }
  }
  return { ok: true, total: count }
}

// Polls the API: right away, then every intervalSeconds. A 429 doubles the
// wait (up to 10 min) until a call succeeds. Logs only when the state changes,
// so a long outage is one line, not one per minute. Never logs the token.
export function startRemoteCountPolling(config: RemoteCountConfig) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let delaySeconds = config.intervalSeconds
  let lastState = ''

  function log(state: string, message: string, warn = false) {
    if (state === lastState) return
    lastState = state
    const line = `[remote-count] ${message}`
    if (warn) console.warn(line)
    else console.log(line)
  }

  async function poll() {
    const result = await fetchRemoteCount(config)
    if (stopped) return
    if (result.ok) {
      try {
        await storeRemoteCount(result.total)
        log(`ok`, `online count received: ${result.total}`)
      } catch (error) {
        log('store-error', `could not store the online count: ${error instanceof Error ? error.message : error}`, true)
      }
      delaySeconds = config.intervalSeconds
    } else {
      log(result.reason, `online count unavailable (${result.reason}); keeping the last stored value`, true)
      delaySeconds = result.rateLimited
        ? Math.min(Math.max(delaySeconds * 2, config.intervalSeconds), MAX_RETRY_DELAY_SECONDS)
        : config.intervalSeconds
    }
    timer = setTimeout(poll, delaySeconds * 1000)
  }

  console.log(`[remote-count] polling ${new URL(config.url).origin} every ${config.intervalSeconds} s`)
  void poll()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
