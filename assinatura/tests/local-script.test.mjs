import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeToken, parseArgs, remoteCountSetup } from '../scripts/local.mjs'

const NOW = new Date('2026-11-16T12:00:00Z')
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`

test('parseArgs reads the flags and rejects unknown ones', () => {
  assert.deepEqual(parseArgs([]), { offline: false, build: true, open: false, port: undefined })
  assert.deepEqual(parseArgs(['--offline', '--no-build', '--open', '--port=3001']),
    { offline: true, build: false, open: true, port: '3001' })
  assert.throws(() => parseArgs(['--prod']), /Opção desconhecida: --prod/)
})

test('describeToken reports validity without ever echoing the token', () => {
  const valid = jwt({ exp: Date.parse('2026-12-11T21:41:58Z') / 1000 })
  const result = describeToken(`Bearer ${valid}\r\n`, NOW)
  assert.equal(result.ok, true)
  assert.match(result.message, /^token válido até 11\/12\/2026.* \(25 dias\)$/)
  assert.ok(!result.message.includes(valid.split('.')[1]))

  const expired = describeToken(jwt({ exp: Date.parse('2026-11-01T00:00:00Z') / 1000 }), NOW)
  assert.equal(expired.ok, false)
  assert.match(expired.message, /EXPIRADO/)

  assert.deepEqual(describeToken('  \n', NOW), { ok: false, message: 'token.txt está vazio' })
  assert.equal(describeToken('not-a-jwt', NOW).ok, true)
  assert.equal(describeToken(jwt({ sub: 1 }), NOW).message, 'token carregado (sem data de validade)')
})

test('remoteCountSetup turns the online count on only with a token file and a URL', () => {
  const kioskConfig = { remoteCountUrl: ' https://api.example/count ', remoteCountIntervalSeconds: 30 }
  const tokenFile = '/repo/token.txt'

  const on = remoteCountSetup({ offline: false, tokenText: 'abc', kioskConfig, tokenFile })
  assert.deepEqual(on.env, {
    NUXT_REMOTE_COUNT_URL: 'https://api.example/count',
    NUXT_REMOTE_COUNT_INTERVAL_SECONDS: '30',
    NUXT_REMOTE_COUNT_TOKEN_FILE: tokenFile,
  })

  assert.deepEqual(remoteCountSetup({ offline: true, tokenText: 'abc', kioskConfig, tokenFile }).env, {})
  assert.match(remoteCountSetup({ offline: false, tokenText: undefined, kioskConfig, tokenFile }).status, /não há token.txt/)
  assert.match(remoteCountSetup({ offline: false, tokenText: 'abc', kioskConfig: {}, tokenFile }).status, /remoteCountUrl vazio/)
  assert.equal(remoteCountSetup({ offline: false, tokenText: 'abc', kioskConfig: { remoteCountUrl: 'u' }, tokenFile })
    .env.NUXT_REMOTE_COUNT_INTERVAL_SECONDS, '60')
})
