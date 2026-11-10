import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const storeUrl = new URL('../server/utils/signature-store.ts', import.meta.url).href

function runStore(databasePath, id) {
  const operation = id ? `recordSignature(${JSON.stringify(id)})` : 'getSignatureCount()'
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    '--input-type=module',
    '-e',
    `import { getSignatureCount, recordSignature } from ${JSON.stringify(storeUrl)};
     console.log(JSON.stringify(await ${operation}));`,
  ], {
    env: { ...process.env, SIGNATURE_DB_PATH: databasePath },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  // `nuxt dev` prints this Node 22 warning as an ERROR line; the store must silence it.
  assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/)
  return JSON.parse(result.stdout)
}

test('SQLite preserves the count across processes and ignores duplicate submissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-store-test-'))
  try {
    const path = join(directory, 'nested', 'signatures.sqlite')
    const firstId = randomUUID()
    assert.deepEqual(runStore(path), { total: 0 })
    assert.deepEqual(runStore(path, firstId), { total: 1 })
    assert.deepEqual(runStore(path, firstId), { total: 1 })
    assert.deepEqual(runStore(path, randomUUID()), { total: 2 })
    assert.deepEqual(runStore(path), { total: 2 })
  } finally {
    rmSync(directory, { recursive: true })
  }
})
