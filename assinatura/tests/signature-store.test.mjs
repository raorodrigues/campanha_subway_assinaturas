import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const csvIds = (path) => readFileSync(path, 'utf8').trim().split('\n').slice(1).map((line) => line.split(';')[0])

test('every new signature is also written to assinaturas.csv next to the database, once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-store-test-'))
  try {
    const path = join(directory, 'signatures.sqlite')
    const csv = join(directory, 'assinaturas.csv')
    const id = randomUUID()
    runStore(path, id)
    runStore(path, id)
    const lines = readFileSync(csv, 'utf8').trim().split('\n')
    assert.equal(lines[0], 'id;criado_em_utc;criado_em_local')
    assert.equal(lines.length, 2)
    const [csvId, utc, local] = lines[1].split(';')
    assert.equal(csvId, id)
    assert.match(utc, ISO_UTC)
    assert.match(local, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('a lost database is rebuilt from the CSV, and a lost CSV from the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-store-test-'))
  try {
    const path = join(directory, 'signatures.sqlite')
    const csv = join(directory, 'assinaturas.csv')
    const ids = [randomUUID(), randomUUID()]
    for (const id of ids) runStore(path, id)

    for (const file of [path, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true })
    assert.deepEqual(runStore(path), { total: 2 })

    rmSync(csv)
    assert.deepEqual(runStore(path), { total: 2 })
    assert.deepEqual(csvIds(csv).sort(), [...ids].sort())
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('rows only in the CSV and rows only in the database are merged on start', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-store-test-'))
  try {
    const path = join(directory, 'signatures.sqlite')
    const csv = join(directory, 'assinaturas.csv')
    const inDatabase = randomUUID()
    runStore(path, inDatabase)
    const onlyInCsv = randomUUID()
    writeFileSync(csv, `id;criado_em_utc;criado_em_local\r\n${onlyInCsv};2026-11-13T15:14:49.903Z;\r\n`)
    assert.deepEqual(runStore(path), { total: 2 })
    assert.deepEqual(csvIds(csv).map((id) => id.trim()).sort(), [inDatabase, onlyInCsv].sort())
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('SIGNATURE_CSV_PATH puts the CSV elsewhere', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-store-test-'))
  try {
    const csv = join(directory, 'outro', 'lista.csv')
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', '--input-type=module', '-e',
      `import { recordSignature } from ${JSON.stringify(storeUrl)}; await recordSignature(${JSON.stringify(randomUUID())});`,
    ], { env: { ...process.env, SIGNATURE_DB_PATH: join(directory, 'db.sqlite'), SIGNATURE_CSV_PATH: csv }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(csv))
    assert.ok(!existsSync(join(directory, 'assinaturas.csv')))
  } finally {
    rmSync(directory, { recursive: true })
  }
})
