// Manual / diagnostic start of the kiosk, without PowerShell or PM2.
// Reads kiosk.json exactly like start-kiosk.ps1 (same port, database, online
// count and token file), runs the server in this window, copies its output to
// logs\assinatura.log and opens both pages in a normal browser window.
// No automatic restarts: closing this window (or Ctrl+C) stops the server.
//
//   run-manual.cmd                    start + open the pages
//   run-manual.cmd --sem-navegador    start only
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(ROOT, 'data')
const LOG_DIR = join(ROOT, 'logs')
const SERVER_DIR = join(ROOT, 'assinatura')
const ENTRY = join(SERVER_DIR, '.output', 'server', 'index.mjs')
const READY_TIMEOUT_MS = 30_000

function fail(message) {
  console.error(`\nERRO: ${message}\n`)
  process.exit(1)
}

function readConfig() {
  const file = join(ROOT, 'kiosk.json')
  let config
  try {
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch (error) {
    fail(`não consegui ler ${file}: ${error.message}`)
  }
  for (const key of ['host', 'signaturePort']) {
    if (config[key] === undefined || config[key] === '') fail(`kiosk.json sem '${key}'.`)
  }
  return config
}

// Same names, defaults and token-path rule as start-kiosk.ps1.
function buildEnv(config) {
  const pick = (key, fallback) => String(config[key] ?? fallback)
  let tokenFile = pick('remoteCountTokenFile', 'token.txt')
  if (!isAbsolute(tokenFile)) tokenFile = join(ROOT, tokenFile)
  return {
    NODE_ENV: 'production',
    HOST: String(config.host),
    PORT: String(config.signaturePort),
    SIGNATURE_DB_PATH: join(DATA_DIR, 'signatures.sqlite'),
    NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS: pick('signatureIdleTimeoutSeconds', 5),
    NUXT_PUBLIC_SIGNATURE_FINISH_PAUSE_SECONDS: pick('signatureFinishPauseSeconds', 2),
    NUXT_PUBLIC_SIGNATURE_MAX_SECONDS: pick('signatureMaxSeconds', 30),
    NUXT_SIGNATURE_COUNT_OFFSET: pick('signatureCountOffset', 0),
    NUXT_REMOTE_COUNT_URL: pick('remoteCountUrl', ''),
    NUXT_REMOTE_COUNT_INTERVAL_SECONDS: pick('remoteCountIntervalSeconds', 60),
    NUXT_REMOTE_COUNT_TOKEN_FILE: tokenFile,
  }
}

function counterUrl(base, config) {
  const value = (key, fallback) => config[key] ?? fallback
  return `${base}/counter?x=${value('counterOffsetX', 0)}&y=${value('counterOffsetY', 0)}`
    + `&w=${value('counterWidth', 512)}&h=${value('counterHeight', 192)}`
}

async function readCount(base) {
  try {
    const response = await fetch(`${base}/api/signatures/count`, { signal: AbortSignal.timeout(2000) })
    return response.ok ? await response.json() : undefined
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

const config = readConfig()
const env = buildEnv(config)
const base = `http://127.0.0.1:${env.PORT}`
const openBrowser = !process.argv.includes('--sem-navegador')

if (!existsSync(ENTRY)) fail(`build não encontrado: ${ENTRY}`)
if (await readCount(base)) {
  fail(`já existe um servidor em ${base}. Se o quiosque automático estiver ligado, rode stop-kiosk.cmd primeiro.`)
}
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(LOG_DIR, { recursive: true })

const logFile = join(LOG_DIR, 'assinatura.log')
const remote = env.NUXT_REMOTE_COUNT_URL.trim()
console.log(`
  Modo manual (sem reinício automático: fechar esta janela para o servidor)
  Assinatura:      ${base}/
  Contador LED:    ${counterUrl(base, config)}
  Total (JSON):    ${base}/api/signatures/count
  Banco:           ${env.SIGNATURE_DB_PATH}
  Log:             ${logFile}
  Contagem online: ${remote ? `${remote} a cada ${env.NUXT_REMOTE_COUNT_INTERVAL_SECONDS} s` : 'desligada (remoteCountUrl vazio)'}`)
if (remote) {
  const tokenOk = existsSync(env.NUXT_REMOTE_COUNT_TOKEN_FILE)
  console.log(`  Token:           ${env.NUXT_REMOTE_COUNT_TOKEN_FILE}${tokenOk ? '' : '  <-- NÃO ENCONTRADO'}`)
}
console.log('')

const log = createWriteStream(logFile, { flags: 'a' })
log.write(`\n--- ${new Date().toISOString()} run-manual start ---\n`)
const server = spawn(process.execPath, [ENTRY], {
  cwd: SERVER_DIR,
  env: { ...process.env, ...env },
  stdio: ['ignore', 'pipe', 'pipe'],
})
for (const [stream, out] of [[server.stdout, process.stdout], [server.stderr, process.stderr]]) {
  stream.on('data', (chunk) => {
    out.write(chunk)
    log.write(chunk)
  })
}

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  console.log('\nParando o servidor...')
  server.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

server.on('exit', (code, signal) => {
  log.end(`--- ${new Date().toISOString()} run-manual stop (code ${code ?? signal}) ---\n`)
  if (!stopping) console.error(`\nO servidor parou (código ${code ?? signal}). Veja as mensagens acima ou ${logFile}.`)
  process.exitCode = stopping ? 0 : (code || 1)
})

const deadline = Date.now() + READY_TIMEOUT_MS
let count
while (!stopping && server.exitCode === null && Date.now() < deadline) {
  count = await readCount(base)
  if (count) break
  await new Promise((resolve) => setTimeout(resolve, 300))
}
if (count) {
  console.log(`\nServidor pronto. Total no painel agora: ${count.total}`)
  if (openBrowser) {
    openInBrowser(`${base}/`)
    openInBrowser(counterUrl(base, config))
  }
  console.log('Ctrl+C ou fechar esta janela para parar.\n')
} else if (!stopping && server.exitCode === null) {
  console.warn(`\nO servidor não respondeu em ${READY_TIMEOUT_MS / 1000} s. Veja as mensagens acima.`)
}
