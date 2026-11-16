import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

const SQLITE_EXPERIMENTAL_WARNING = 'SQLite is an experimental feature'

let databasePromise: Promise<DatabaseSync> | undefined

// Node 22 prints an ExperimentalWarning the first time node:sqlite loads, and
// `nuxt dev` shows it as an ERROR line. The module works; drop only that warning.
async function loadSqlite() {
  const emitWarning = process.emitWarning
  process.emitWarning = function (this: NodeJS.Process, warning: string | Error, ...rest: unknown[]) {
    const message = typeof warning === 'string' ? warning : warning.message
    if (message.startsWith(SQLITE_EXPERIMENTAL_WARNING)) return
    Reflect.apply(emitWarning, this, [warning, ...rest])
  } as typeof process.emitWarning

  try {
    return await import('node:sqlite')
  } finally {
    process.emitWarning = emitWarning
  }
}

// A plain-text copy of every signature, next to the database by default
// (SIGNATURE_CSV_PATH overrides). It opens in Excel and survives a lost or
// corrupted SQLite file: on start the two are merged, so either one rebuilds
// the other. Separator ';' so Excel in pt-BR splits the columns.
const CSV_HEADER = 'id;criado_em_utc;criado_em_local'

let csvPath = ''

function databasePath() {
  return resolve(process.env.SIGNATURE_DB_PATH || '.data/signatures.sqlite')
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0')
}

// Server-local time, e.g. 2026-11-16 11:36:51, for people reading the CSV.
function localTime(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function csvLine(id: string, createdAt: string | null) {
  return `${id};${createdAt ?? ''};${localTime(createdAt)}\n`
}

function readCsv(path: string) {
  const rows = new Map<string, string | null>()
  if (!existsSync(path)) return rows
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const [id = '', createdAt = ''] = line.split(';').map((cell) => cell.trim())
    if (!id || id === 'id') continue
    rows.set(id, createdAt || null)
  }
  return rows
}

// Database rows missing from the CSV are appended to it; CSV rows missing from
// the database are inserted into it. Neither side ever loses a row.
function mergeWithCsv(connection: DatabaseSync, path: string) {
  const csvRows = readCsv(path)
  const insert = connection.prepare('INSERT OR IGNORE INTO signature_submissions (id, created_at) VALUES (?, ?)')
  connection.exec('BEGIN')
  try {
    for (const [id, createdAt] of csvRows) insert.run(id, createdAt)
    connection.exec('COMMIT')
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }

  const missing = connection
    .prepare('SELECT id, created_at FROM signature_submissions ORDER BY created_at, id')
    .all()
    .filter((row) => !csvRows.has(String(row.id)))
    .map((row) => csvLine(String(row.id), typeof row.created_at === 'string' ? row.created_at : null))
  if (!existsSync(path)) writeFileSync(path, `${CSV_HEADER}\n`)
  if (missing.length) appendFileSync(path, missing.join(''))
}

// Never fails a signature: if the CSV is locked (open in Excel on Windows) the
// row is still in SQLite and the next start copies it over.
function appendToCsv(id: string, createdAt: string | null) {
  try {
    if (!existsSync(csvPath)) writeFileSync(csvPath, `${CSV_HEADER}\n`)
    appendFileSync(csvPath, csvLine(id, createdAt))
  } catch (error) {
    console.warn(`[signature-store] could not write ${csvPath}: ${(error as Error).message}`)
  }
}

async function openDatabase() {
  const { DatabaseSync } = await loadSqlite()
  const path = databasePath()
  mkdirSync(dirname(path), { recursive: true })
  const connection = new DatabaseSync(path)
  connection.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS signature_submissions (
      id TEXT PRIMARY KEY,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS remote_signature_count (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total INTEGER NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `)
  addCreatedAtColumn(connection)
  csvPath = resolve(process.env.SIGNATURE_CSV_PATH || join(dirname(path), 'assinaturas.csv'))
  mkdirSync(dirname(csvPath), { recursive: true })
  try {
    mergeWithCsv(connection, csvPath)
  } catch (error) {
    console.warn(`[signature-store] could not merge ${csvPath}: ${(error as Error).message}`)
  }
  return connection
}

// Databases created before created_at existed keep their table, so add the column
// in place. Those older rows stay NULL: their real creation time was never recorded.
function addCreatedAtColumn(connection: DatabaseSync) {
  const columns = connection.prepare('PRAGMA table_info(signature_submissions)').all()
  if (columns.some((column) => column.name === 'created_at')) return
  connection.exec('ALTER TABLE signature_submissions ADD COLUMN created_at TEXT')
}

function getDatabase() {
  databasePromise ??= openDatabase().catch((error: unknown) => {
    // Allow the next request to retry instead of caching the failure forever.
    databasePromise = undefined
    throw error
  })
  return databasePromise
}

function countSignatures(database: DatabaseSync) {
  const row = database.prepare('SELECT COUNT(*) AS total FROM signature_submissions').get()
  if (!row || typeof row.total !== 'number' || !Number.isSafeInteger(row.total)) {
    throw new Error('Invalid signature count returned by SQLite')
  }
  return { total: row.total }
}

export async function getSignatureCount() {
  return countSignatures(await getDatabase())
}

// Last count received from the campaign's online API (see remote-count.ts).
// Kept on disk so a restart without internet still shows it instead of
// dropping thousands of signatures from the panel. 0 until the first answer.
export async function getStoredRemoteCount() {
  const database = await getDatabase()
  const row = database.prepare('SELECT total FROM remote_signature_count WHERE id = 1').get()
  return row && typeof row.total === 'number' && Number.isSafeInteger(row.total) ? row.total : 0
}

export async function storeRemoteCount(total: number) {
  const database = await getDatabase()
  database.prepare(`
    INSERT INTO remote_signature_count (id, total, fetched_at)
    VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT (id) DO UPDATE SET total = excluded.total, fetched_at = excluded.fetched_at
  `).run(total)
}

export async function recordSignature(id: string) {
  const database = await getDatabase()
  // ISO 8601 UTC with milliseconds, e.g. 2026-11-13T14:05:09.123Z
  const inserted = database.prepare(`
    INSERT OR IGNORE INTO signature_submissions (id, created_at)
    VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    RETURNING created_at
  `).get(id)
  // A repeated id inserts nothing and returns no row: the CSV already has it.
  if (inserted) appendToCsv(id, typeof inserted.created_at === 'string' ? inserted.created_at : null)
  return countSignatures(database)
}
