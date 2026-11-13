import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Runs against the production build: `npm run build` first.
// `env` entries set to null are removed from the inherited environment.
async function startServer(databasePath, env = {}) {
  const childEnv = { ...process.env, HOST: '127.0.0.1', PORT: '0', SIGNATURE_DB_PATH: databasePath }
  delete childEnv.NUXT_SIGNATURE_COUNT_OFFSET
  for (const [key, value] of Object.entries(env)) {
    if (value === null) delete childEnv[key]
    else childEnv[key] = value
  }
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stderr.on('data', chunk => { output += chunk.toString() })
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Server startup timed out: ${output}`))
    }, 10000)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(`http://127.0.0.1:${match[1]}`)
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Server exited with ${code}: ${output}`))
    })
  })
  return { address, child }
}

test('one server serves the kiosk, the LED counter page and the shared count', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-counter-test-'))
  const { address, child } = await startServer(join(directory, 'signatures.sqlite'))
  const exited = once(child, 'exit')
  try {
    const counter = await fetch(`${address}/counter`)
    assert.equal(counter.status, 200)
    const counterHtml = await counter.text()
    assert.match(counterHtml, /Já assinaram/)
    assert.match(counterHtml, /class="[^"]*page-counter/)
    assert.doesNotMatch(counterHtml, /width=1080/, 'the LED panel must not inherit the kiosk viewport')

    const kiosk = await fetch(`${address}/`)
    assert.equal(kiosk.status, 200)
    const kioskHtml = await kiosk.text()
    assert.match(kioskHtml, /class="[^"]*page-signature/)
    assert.match(kioskHtml, /width=1080/)
    // Live text in the official font, not the old text artwork.
    assert.match(kioskHtml, /PATRIMONIO/)
    assert.match(kioskHtml, /Assine aqui/)
    assert.doesNotMatch(kioskHtml, /texto-eleja|botao-assine/)

    const count = () => fetch(`${address}/api/signatures/count`).then(response => response.json())
    assert.deepEqual(await count(), { total: 0 })
    const submitted = await fetch(`${address}/api/signatures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: randomUUID() }),
    })
    assert.equal(submitted.status, 200)
    assert.deepEqual(await count(), { total: 1 })
  } finally {
    child.kill('SIGTERM')
    await exited
    rmSync(directory, { recursive: true })
  }
})

async function submit(address) {
  const response = await fetch(`${address}/api/signatures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: randomUUID() }),
  })
  assert.equal(response.status, 200)
  return response.json()
}

// Always stops the server, even when an assertion fails.
async function withServer(databasePath, env, run) {
  const { address, child } = await startServer(databasePath, env)
  const exited = once(child, 'exit')
  try {
    await run(address)
  } finally {
    child.kill('SIGTERM')
    await exited
  }
}

const readCount = address => fetch(`${address}/api/signatures/count`).then(response => response.json())

test('NUXT_SIGNATURE_COUNT_OFFSET is added to the shown total, never stored', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-offset-test-'))
  const databasePath = join(directory, 'signatures.sqlite')
  try {
    await withServer(databasePath, { NUXT_SIGNATURE_COUNT_OFFSET: '1000' }, async (address) => {
      assert.deepEqual(await readCount(address), { total: 1000 })
      assert.deepEqual(await submit(address), { total: 1001 })
      assert.deepEqual(await readCount(address), { total: 1001 })
    })
    // Without the variable the offset defaults to 0: only the real signature remains.
    await withServer(databasePath, { NUXT_SIGNATURE_COUNT_OFFSET: null }, async (address) => {
      assert.deepEqual(await readCount(address), { total: 1 })
    })
  } finally {
    rmSync(directory, { recursive: true })
  }
})

for (const invalid of ['-5', '1.5', 'abc']) {
  test(`the server refuses to start with NUXT_SIGNATURE_COUNT_OFFSET=${invalid}`, { timeout: 30000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'assinatura-offset-test-'))
    try {
      let started
      try {
        started = await startServer(join(directory, 'signatures.sqlite'), { NUXT_SIGNATURE_COUNT_OFFSET: invalid })
      } catch (error) {
        assert.match(error.message, /NUXT_SIGNATURE_COUNT_OFFSET must be a whole number ≥ 0/)
        return
      }
      started.child.kill('SIGKILL')
      assert.fail(`the server started with NUXT_SIGNATURE_COUNT_OFFSET=${invalid}`)
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
}
