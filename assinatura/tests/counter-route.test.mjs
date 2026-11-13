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
async function startServer(databasePath) {
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', SIGNATURE_DB_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stderr.on('data', chunk => { output += chunk.toString() })
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 10000)
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
