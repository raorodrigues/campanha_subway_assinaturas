import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { SUBWAY_FONT_DIR, SUBWAY_FONT_FILES, SUBWAY_FONT_ZIP, assertSubwayFonts } from './subway-fonts.mjs'

if (!existsSync(SUBWAY_FONT_ZIP)) {
  console.error(`subway_font.zip não encontrado em ${SUBWAY_FONT_ZIP}.`)
  process.exit(1)
}

mkdirSync(SUBWAY_FONT_DIR, { recursive: true })
const result = spawnSync('unzip', [
  '-j', '-o', '-q', SUBWAY_FONT_ZIP,
  ...SUBWAY_FONT_FILES.map(file => `subway/${file}`),
  '-d', SUBWAY_FONT_DIR,
], { stdio: 'inherit' })

if (result.error || result.status !== 0) {
  console.error('Falha ao extrair as fontes com `unzip`.', result.error ?? '')
  process.exit(1)
}

assertSubwayFonts()
console.log(`Fontes Subway extraídas para ${SUBWAY_FONT_DIR}`)
