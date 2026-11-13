import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SUBWAY_FONT_FILES, assertSubwayFonts } from '../scripts/subway-fonts.mjs'

test('the build stops with a clear message when a Subway font file is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assinatura-fonts-test-'))
  try {
    assert.throws(() => assertSubwayFonts(directory), /git checkout -- app\/assets\/fonts\/subway/)
    mkdirSync(directory, { recursive: true })
    for (const file of SUBWAY_FONT_FILES.slice(1)) writeFileSync(join(directory, file), 'x')
    assert.throws(() => assertSubwayFonts(directory), new RegExp(SUBWAY_FONT_FILES[0]))
    writeFileSync(join(directory, SUBWAY_FONT_FILES[0]), 'x')
    assert.doesNotThrow(() => assertSubwayFonts(directory))
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('every Subway @font-face pins its vertical metrics so Windows renders like macOS', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(new URL('../app/assets/css/fonts.css', import.meta.url), 'utf8')
  const faces = css.match(/@font-face\s*{[^}]*}/g) ?? []
  assert.equal(faces.length, SUBWAY_FONT_FILES.length)
  for (const face of faces) {
    // Without these, Chrome on Windows uses usWinAscent/Descent and the LED
    // counter digits drop below their clipping cells.
    assert.match(face, /ascent-override:\s*80\.9%/)
    assert.match(face, /descent-override:\s*19\.1%/)
    assert.match(face, /line-gap-override:\s*20%/)
  }
})
