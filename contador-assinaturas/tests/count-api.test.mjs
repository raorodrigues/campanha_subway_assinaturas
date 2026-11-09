import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('count proxy handles valid counts, invalid responses and upstream outages', { timeout: 30000 }, async () => {
  let upstreamResponse = { total: 0 }
  let requestedPath = ''
  const upstream = createServer((request, response) => {
    requestedPath = request.url
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(upstreamResponse))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const upstreamPort = upstream.address().port
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      NUXT_SIGNATURE_API_BASE: `http://127.0.0.1:${upstreamPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stderr.on('data', chunk => { output += chunk.toString() })
  const exited = once(child, 'exit')

  try {
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
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Server exited with ${code}: ${output}`))
      })
    })
    const read = () => fetch(`${address}/api/signatures/count`)
    let response = await read()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { total: 0 })
    assert.equal(requestedPath, '/api/signatures/count')

    upstreamResponse = { total: 42, ignoredField: true }
    response = await read()
    assert.deepEqual(await response.json(), { total: 42 })

    for (const invalid of [{ total: -1 }, { total: 1.5 }, { total: '42' }, {}, null]) {
      upstreamResponse = invalid
      response = await read()
      assert.equal(response.status, 502)
      assert.equal((await response.json()).statusMessage, 'Signature count unavailable')
    }

    await new Promise(resolve => upstream.close(resolve))
    upstream.closeAllConnections()
    response = await read()
    assert.equal(response.status, 502)
  } finally {
    child.kill('SIGTERM')
    await exited
    upstream.closeAllConnections()
    if (upstream.listening) await new Promise(resolve => upstream.close(resolve))
  }
})
