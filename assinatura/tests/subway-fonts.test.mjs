import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SUBWAY_FONT_FILES, assertSubwayFonts } from '../scripts/subway-fonts.mjs'

test('the build stops with a clear message when a Subway font file is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-fonts-test-'))
  try {
    assert.throws(() => assertSubwayFonts(directory), /npm run fonts:extract/)
    mkdirSync(directory, { recursive: true })
    for (const file of SUBWAY_FONT_FILES.slice(1)) writeFileSync(join(directory, file), 'x')
    assert.throws(() => assertSubwayFonts(directory), new RegExp(SUBWAY_FONT_FILES[0]))
    writeFileSync(join(directory, SUBWAY_FONT_FILES[0]), 'x')
    assert.doesNotThrow(() => assertSubwayFonts(directory))
  } finally {
    rmSync(directory, { recursive: true })
  }
})
