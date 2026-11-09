import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let database: DatabaseSync | undefined

function getDatabase() {
  if (!database) {
    const path = resolve(process.env.SIGNATURE_DB_PATH || '.data/signatures.sqlite')
    mkdirSync(dirname(path), { recursive: true })
    const connection = new DatabaseSync(path)
    connection.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS signature_submissions (
        id TEXT PRIMARY KEY
      );
    `)
    database = connection
  }
  return database
}

export function getSignatureCount() {
  const row = getDatabase().prepare('SELECT COUNT(*) AS total FROM signature_submissions').get()
  if (!row || typeof row.total !== 'number' || !Number.isSafeInteger(row.total)) {
    throw new Error('Invalid signature count returned by SQLite')
  }
  return { total: row.total }
}

export function recordSignature(id: string) {
  getDatabase().prepare('INSERT OR IGNORE INTO signature_submissions (id) VALUES (?)').run(id)
  return getSignatureCount()
}
