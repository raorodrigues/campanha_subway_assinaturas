import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readCount, startServer, submit, withServer } from './server.mjs'

// Runs against the production build: `npm run build` first.
const TOKEN = 'eyJ0ZXN0IjoidG9rZW4ifQ.test-jwt-never-logged'

// Stand-in for the campaign API: answers with whatever `reply` says and
// records each request's headers.
async function startFakeApi() {
  const api = { reply: { status: 200, body: { count: 0 } }, requests: [] }
  const server = createServer((request, response) => {
    api.requests.push({ url: request.url, headers: request.headers })
    response.writeHead(api.reply.status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(api.reply.body))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  api.url = `http://127.0.0.1:${server.address().port}/api/v1/signatures/count`
  api.close = () => new Promise(resolve => server.close(resolve))
  return api
}

async function waitFor(check, what, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-remote-test-'))
  const tokenFile = join(directory, 'token.txt')
  writeFileSync(tokenFile, `${TOKEN}\n`)
  return { directory, databasePath: join(directory, 'signatures.sqlite'), tokenFile }
}

const remoteEnv = (url, tokenFile, extra = {}) => ({
  NUXT_REMOTE_COUNT_URL: url,
  NUXT_REMOTE_COUNT_TOKEN_FILE: tokenFile,
  NUXT_REMOTE_COUNT_INTERVAL_SECONDS: '1',
  ...extra,
})

test('the online count is added to the kiosk signatures and the offset', { timeout: 30000 }, async () => {
  const { directory, databasePath, tokenFile } = setup()
  const api = await startFakeApi()
  api.reply = { status: 200, body: { count: 12000 } }
  try {
    await withServer(databasePath, remoteEnv(api.url, tokenFile, { NUXT_SIGNATURE_COUNT_OFFSET: '5' }), async (address, server) => {
      await waitFor(async () => (await readCount(address)).total === 12005, 'the first online count')
      assert.deepEqual(await submit(address), { total: 12006 })

      api.reply = { status: 200, body: { count: 12040 } }
      await waitFor(async () => (await readCount(address)).total === 12046, 'the updated online count')

      const { headers } = api.requests.at(-1)
      assert.equal(headers.authorization, `Bearer ${TOKEN}`)
      assert.equal(headers.accept, 'application/json')
      assert.doesNotMatch(server.logs(), new RegExp(TOKEN.replace(/\./g, '\\.')), 'the token must never be logged')

      // The browser never sees the token or the API address.
      const counterHtml = await fetch(`${address}/counter`).then(response => response.text())
      assert.doesNotMatch(counterHtml, /test-jwt|signatures\/count"/)
    })
  } finally {
    await api.close()
    rmSync(directory, { recursive: true })
  }
})

test('API errors and a restart without internet keep the last online count', { timeout: 45000 }, async () => {
  const { directory, databasePath, tokenFile } = setup()
  const api = await startFakeApi()
  api.reply = { status: 200, body: { count: 800 } }
  try {
    await withServer(databasePath, remoteEnv(api.url, tokenFile), async (address, server) => {
      await waitFor(async () => (await readCount(address)).total === 800, 'the first online count')

      for (const reply of [
        { status: 401, body: { message: 'Unauthenticated.' } },
        { status: 500, body: { message: 'Internal server error.' } },
        { status: 200, body: { count: -3 } },
        { status: 200, body: { total: 900 } },
      ]) {
        api.reply = reply
        const before = api.requests.length
        await waitFor(() => api.requests.length > before, `a call answered with ${JSON.stringify(reply)}`)
        await new Promise(resolve => setTimeout(resolve, 200))
        assert.deepEqual(await readCount(address), { total: 800 }, JSON.stringify(reply))
      }
      assert.match(server.logs(), /token invalid or expired/)
    })

    // API gone (no internet): the stored count still shows after a restart.
    await api.close()
    await withServer(databasePath, remoteEnv(api.url, tokenFile), async (address, server) => {
      await waitFor(() => /online count unavailable \(no connection\)/.test(server.logs()), 'the failed call')
      assert.deepEqual(await readCount(address), { total: 800 })
    })
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('a missing token file makes no call and keeps the panel running', { timeout: 30000 }, async () => {
  const { directory, databasePath } = setup()
  const api = await startFakeApi()
  try {
    await withServer(databasePath, remoteEnv(api.url, join(directory, 'missing.txt')), async (address, server) => {
      await waitFor(() => /token file missing or empty/.test(server.logs()), 'the missing token warning')
      assert.equal(api.requests.length, 0)
      assert.deepEqual(await readCount(address), { total: 0 })
    })
  } finally {
    await api.close()
    rmSync(directory, { recursive: true })
  }
})

test('without NUXT_REMOTE_COUNT_URL the kiosk makes no external call', { timeout: 30000 }, async () => {
  const { directory, databasePath, tokenFile } = setup()
  const api = await startFakeApi()
  api.reply = { status: 200, body: { count: 999 } }
  try {
    await withServer(databasePath, { NUXT_REMOTE_COUNT_TOKEN_FILE: tokenFile, NUXT_REMOTE_COUNT_INTERVAL_SECONDS: '1' }, async (address, server) => {
      await new Promise(resolve => setTimeout(resolve, 1500))
      assert.equal(api.requests.length, 0)
      assert.deepEqual(await readCount(address), { total: 0 })
      assert.doesNotMatch(server.logs(), /remote-count/)
    })
  } finally {
    await api.close()
    rmSync(directory, { recursive: true })
  }
})

for (const [name, env] of [
  ['an invalid URL', { NUXT_REMOTE_COUNT_URL: 'not a url' }],
  ['a zero interval', { NUXT_REMOTE_COUNT_INTERVAL_SECONDS: '0' }],
  ['no token file', { NUXT_REMOTE_COUNT_TOKEN_FILE: '' }],
]) {
  test(`the server refuses to start with ${name}`, { timeout: 30000 }, async () => {
    const { directory, databasePath, tokenFile } = setup()
    try {
      let started
      try {
        started = await startServer(databasePath, remoteEnv('https://example.invalid/count', tokenFile, env))
      } catch (error) {
        assert.match(error.message, /NUXT_REMOTE_COUNT_/)
        return
      }
      started.child.kill('SIGKILL')
      assert.fail(`the server started with ${name}`)
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
}
