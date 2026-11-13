import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Official Subway fonts are licensed to the client and this repository is
// public, so the files are never committed: `npm run fonts:extract` copies the
// ones the app uses out of subway.zip (project root, also git-ignored).
export const SUBWAY_FONT_DIR = fileURLToPath(new URL('../app/assets/fonts/subway', import.meta.url))
export const SUBWAY_FONT_ZIP = fileURLToPath(new URL('../../subway.zip', import.meta.url))
export const SUBWAY_FONT_FILES = [
  'Subway Sans Cond-Medium.otf',
  'Subway Sans Cond-Bold.otf',
  'Subway Sans Cond-Black.otf',
]

export function assertSubwayFonts(directory = SUBWAY_FONT_DIR) {
  const missing = SUBWAY_FONT_FILES.filter(file => !existsSync(join(directory, file)))
  if (missing.length) {
    throw new Error(
      `Fonte Subway em falta (${missing.join(', ')}) em ${directory}. `
      + 'Coloque subway.zip na raiz do projeto e rode `npm run fonts:extract`.',
    )
  }
}
