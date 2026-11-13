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

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

test('each submission stores its UTC creation time, kept on duplicate submissions', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-store-test-'))
  try {
    const path = join(directory, 'signatures.sqlite')
    const id = randomUUID()
    const before = Date.now()
    runStore(path, id)
    const after = Date.now()
    const read = () => {
      const database = new DatabaseSync(path)
      try {
        return database.prepare('SELECT created_at FROM signature_submissions WHERE id = ?').get(id).created_at
      } finally {
        database.close()
      }
    }
    const createdAt = read()
    assert.match(createdAt, ISO_UTC)
    assert.ok(Date.parse(createdAt) >= before - 1000 && Date.parse(createdAt) <= after + 1000)
    runStore(path, id)
    assert.equal(read(), createdAt)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('a database created before created_at existed is migrated without losing rows', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-store-test-'))
  try {
    const path = join(directory, 'signatures.sqlite')
    const legacyId = randomUUID()
    const legacy = new DatabaseSync(path)
    legacy.exec('CREATE TABLE signature_submissions (id TEXT PRIMARY KEY)')
    legacy.prepare('INSERT INTO signature_submissions (id) VALUES (?)').run(legacyId)
    legacy.close()

    assert.deepEqual(runStore(path), { total: 1 })
    const newId = randomUUID()
    assert.deepEqual(runStore(path, newId), { total: 2 })

    const database = new DatabaseSync(path)
    try {
      const rows = Object.fromEntries(
        database.prepare('SELECT id, created_at FROM signature_submissions').all().map((row) => [row.id, row.created_at]),
      )
      assert.equal(rows[legacyId], null)
      assert.match(rows[newId], ISO_UTC)
    } finally {
      database.close()
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})
