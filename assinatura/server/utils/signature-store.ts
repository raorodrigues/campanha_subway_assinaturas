import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

async function openDatabase() {
  const { DatabaseSync } = await loadSqlite()
  const path = resolve(process.env.SIGNATURE_DB_PATH || '.data/signatures.sqlite')
  mkdirSync(dirname(path), { recursive: true })
  const connection = new DatabaseSync(path)
  connection.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS signature_submissions (
      id TEXT PRIMARY KEY,
      created_at TEXT
    );
  `)
  addCreatedAtColumn(connection)
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

export async function recordSignature(id: string) {
  const database = await getDatabase()
  // ISO 8601 UTC with milliseconds, e.g. 2026-11-13T14:05:09.123Z
  database.prepare(`
    INSERT OR IGNORE INTO signature_submissions (id, created_at)
    VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(id)
  return countSignatures(database)
}
