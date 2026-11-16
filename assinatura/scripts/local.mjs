// `npm run local`: builds and serves the kiosk like the totem, on Windows,
// macOS or Linux. The online count is on when token.txt exists at the repo
// root (URL and interval from kiosk-windows/kiosk.json).
//   npm run local                    build + start
//   npm run local -- --offline       no API calls (local SQLite only)
//   npm run local -- --no-build      reuse the current .output
//   npm run local -- --open          also open the kiosk and the LED counter
//   npm run local -- --port=3001     other port (or PORT=3001; default 3000)
// Ctrl+C stops the server.
// Signatures live in ../dados (repo root, outside the app and git): the SQLite
// database plus assinaturas.csv. SIGNATURE_DB_PATH still overrides.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const REPO_DIR = dirname(APP_DIR)
export const TOKEN_FILE = join(REPO_DIR, 'token.txt')
const KIOSK_CONFIG = join(REPO_DIR, 'kiosk-windows', 'kiosk.json')
export const DATA_DIR = join(REPO_DIR, 'dados')
const LEGACY_DATABASE = join(APP_DIR, '.data', 'signatures.sqlite')
const MIN_NODE_MAJOR = 22 // node:sqlite

export function parseArgs(argv) {
  const options = { offline: false, build: true, open: false, port: undefined }
  for (const arg of argv) {
    if (arg === '--offline') options.offline = true
    else if (arg === '--no-build') options.build = false
    else if (arg === '--open') options.open = true
    else if (arg.startsWith('--port=')) options.port = arg.slice('--port='.length)
    else throw new Error(`Opção desconhecida: ${arg} (use --offline, --no-build, --open ou --port=3001)`)
  }
  return options
}

// What the console should say about token.txt. Reads only the JWT payload's
// dates; the token itself is never printed.
export function describeToken(text, now = new Date()) {
  const token = (text ?? '').trim().replace(/^Bearer\s+/i, '')
  if (!token) return { ok: false, message: 'token.txt está vazio' }
  let payload
  try {
    payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    return { ok: true, message: 'token carregado (validade desconhecida: não é um JWT legível)' }
  }
  if (typeof payload?.exp !== 'number') return { ok: true, message: 'token carregado (sem data de validade)' }
  const expires = new Date(payload.exp * 1000)
  const when = expires.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  if (expires <= now) return { ok: false, message: `token EXPIRADO em ${when}: peça um novo e substitua token.txt` }
  const days = Math.floor((expires - now) / 86_400_000)
  return { ok: true, message: `token válido até ${when} (${days} dia${days === 1 ? '' : 's'})` }
}

// Online-count environment for the server, or why it stays off.
export function remoteCountSetup({ offline, tokenText, kioskConfig, tokenFile }) {
  if (offline) return { env: {}, status: 'desligada (--offline)' }
  if (tokenText === undefined) return { env: {}, status: `desligada (não há token.txt em ${dirname(tokenFile)})` }
  const url = String(kioskConfig?.remoteCountUrl ?? '').trim()
  if (!url) return { env: {}, status: 'desligada (remoteCountUrl vazio em kiosk-windows/kiosk.json)' }
  const interval = String(kioskConfig?.remoteCountIntervalSeconds ?? 60)
  return {
    env: {
      NUXT_REMOTE_COUNT_URL: url,
      NUXT_REMOTE_COUNT_INTERVAL_SECONDS: interval,
      NUXT_REMOTE_COUNT_TOKEN_FILE: tokenFile,
    },
    status: `ligada (${url}, a cada ${interval} s)`,
  }
}

// Copies the database that older versions kept in assinatura/.data, once: only
// when the new location has none. The server is not running yet, so the -wal and
// -shm files are copied with it. The old copy stays in place as a backup.
export function migrateLegacyDatabase(from, to) {
  if (existsSync(to) || !existsSync(from)) return false
  mkdirSync(dirname(to), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(from + suffix)) copyFileSync(from + suffix, to + suffix)
  }
  return true
}

const say = (message) => console.log(`==> ${message}`)
function fail(message) {
  console.error(`ERRO: ${message}`)
  process.exit(1)
}

function nodeMajor(version = process.versions.node) {
  return Number(version.split('.')[0])
}

// nvm (macOS/Linux) and nvm-windows install folders holding a Node 22.
function findNode22() {
  const candidates = [
    [join(homedir(), '.nvm', 'versions', 'node'), (dir) => join(dir, 'bin', 'node')],
    [process.env.NVM_HOME, (dir) => join(dir, 'node.exe')],
    [process.env.APPDATA && join(process.env.APPDATA, 'nvm'), (dir) => join(dir, 'node.exe')],
  ]
  for (const [root, binary] of candidates) {
    if (!root || !existsSync(root)) continue
    const versions = readdirSync(root).filter((name) => /^v22\./.test(name)).sort().reverse()
    for (const version of versions) {
      const path = binary(join(root, version))
      if (existsSync(path)) return path
    }
  }
  return undefined
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

function portIsFree(host, port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(Number(port), host, () => probe.close(() => resolve(true)))
  })
}

function readOptional(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function openInBrowser(url) {
  const child = process.platform === 'win32'
    // Verbatim so cmd keeps the quotes and does not split the URL at '&'.
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`],
        { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.on('error', () => console.warn(`Não consegui abrir o navegador; abra à mão: ${url}`))
  child.unref()
}

async function waitUntilUp(base, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/signatures/count`)).ok) return true
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    fail(error.message)
  }

  // Older Node in this terminal: rerun this script with an installed Node 22.
  if (nodeMajor() < MIN_NODE_MAJOR) {
    const node22 = findNode22()
    if (!node22) fail(`Node ${MIN_NODE_MAJOR} não encontrado (atual: ${process.version}). Instale com "nvm install 22" e tente de novo.`)
    // Ctrl+C reaches the child too; stay alive until it has stopped the server.
    process.on('SIGINT', () => {})
    process.on('SIGTERM', () => {})
    const code = await run(node22, [fileURLToPath(import.meta.url), ...process.argv.slice(2)])
    process.exit(code)
  }
  say(`Node ${process.version}`)

  const host = '127.0.0.1'
  const port = String(options.port ?? process.env.PORT ?? 3000)
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) fail(`porta inválida: ${port}`)
  if (!(await portIsFree(host, port))) {
    fail(`a porta ${port} já está em uso. Pare o outro servidor ou rode: npm run local -- --port=3001`)
  }

  if (options.build) {
    say('Build...')
    const code = await run(process.execPath, [join(APP_DIR, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs'), 'build'], { cwd: APP_DIR })
    if (code !== 0) fail('o build falhou (veja as mensagens acima). Rodou "npm install"?')
  }
  if (!existsSync(join(APP_DIR, '.output', 'server', 'index.mjs'))) fail('não há build. Rode sem --no-build.')

  let kioskConfig
  try {
    kioskConfig = JSON.parse((readOptional(KIOSK_CONFIG) ?? '{}').replace(/^﻿/, ''))
  } catch (error) {
    fail(`kiosk-windows/kiosk.json inválido: ${error.message}`)
  }
  const tokenText = readOptional(TOKEN_FILE)
  const remote = remoteCountSetup({ offline: options.offline, tokenText, kioskConfig, tokenFile: TOKEN_FILE })
  say(`Contagem online: ${remote.status}`)
  if (remote.env.NUXT_REMOTE_COUNT_URL) {
    const token = describeToken(tokenText)
    if (token.ok) say(`Token: ${token.message}`)
    else console.warn(`AVISO: ${token.message}`)
  }

  const databasePath = process.env.SIGNATURE_DB_PATH
    ? resolve(APP_DIR, process.env.SIGNATURE_DB_PATH)
    : join(DATA_DIR, 'signatures.sqlite')
  if (!process.env.SIGNATURE_DB_PATH && migrateLegacyDatabase(LEGACY_DATABASE, databasePath)) {
    say(`Banco copiado de ${LEGACY_DATABASE} para ${databasePath}`)
  }
  const csvPath = process.env.SIGNATURE_CSV_PATH
    ? resolve(APP_DIR, process.env.SIGNATURE_CSV_PATH)
    : join(dirname(databasePath), 'assinaturas.csv')

  const base = `http://${host}:${port}`
  console.log(`
  Totem (assinatura):  ${base}/
  Contador LED:        ${base}/counter?w=512&h=192
  Contador demo:       ${base}/counter?w=512&h=192&demo
  Régua de calibração: ${base}/counter?calibrar
  Total (JSON):        ${base}/api/signatures/count
  Banco:               ${databasePath}
  Planilha (CSV):      ${csvPath}

  Ctrl+C para parar.
`)

  // Only the online-count settings come from here; anything else set in the
  // shell (e.g. NUXT_SIGNATURE_COUNT_OFFSET) still applies.
  const env = { ...process.env, HOST: host, PORT: port, SIGNATURE_DB_PATH: databasePath, SIGNATURE_CSV_PATH: csvPath, ...remote.env }
  if (!remote.env.NUXT_REMOTE_COUNT_URL) {
    for (const key of ['NUXT_REMOTE_COUNT_URL', 'NUXT_REMOTE_COUNT_TOKEN_FILE', 'NUXT_REMOTE_COUNT_INTERVAL_SECONDS']) delete env[key]
  }
  const server = spawn(process.execPath, [join('.output', 'server', 'index.mjs')], { cwd: APP_DIR, env, stdio: 'inherit' })
  const stop = () => server.kill()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  server.on('exit', (code, signal) => process.exit(code ?? (signal ? 0 : 1)))

  if (options.open && (await waitUntilUp(base))) {
    openInBrowser(`${base}/`)
    openInBrowser(`${base}/counter?w=512&h=192`)
  }
}

// Run only when executed (`node scripts/local.mjs`), not when the tests import it.
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
if (process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) await main()
