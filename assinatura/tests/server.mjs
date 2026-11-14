import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Runs against the production build: `npm run build` first.
// `env` entries set to null are removed from the inherited environment.
export async function startServer(databasePath, env = {}) {
  const childEnv = { ...process.env, HOST: '127.0.0.1', PORT: '0', SIGNATURE_DB_PATH: databasePath }
  for (const key of Object.keys(childEnv)) {
    if (key === 'NUXT_SIGNATURE_COUNT_OFFSET' || key.startsWith('NUXT_REMOTE_COUNT_')) delete childEnv[key]
  }
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
      const match = output.match(/Listening on http:\/\/127\.0\.0\.1:(\d+)/)
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
  // Everything the server printed so far (stdout + stderr).
  return { address, child, logs: () => output }
}

export async function submit(address) {
  const response = await fetch(`${address}/api/signatures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: randomUUID() }),
  })
  assert.equal(response.status, 200)
  return response.json()
}

// Always stops the server, even when an assertion fails.
export async function withServer(databasePath, env, run) {
  const server = await startServer(databasePath, env)
  const exited = once(server.child, 'exit')
  try {
    await run(server.address, server)
  } finally {
    server.child.kill('SIGTERM')
    await exited
  }
}

export const readCount = address => fetch(`${address}/api/signatures/count`).then(response => response.json())
