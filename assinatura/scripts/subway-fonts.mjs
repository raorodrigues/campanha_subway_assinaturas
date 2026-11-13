import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Official Subway fonts, cleared by the client for this public repository.
// Only the three faces the app uses are committed; the full family
// (subway.zip) stays out of Git.
export const SUBWAY_FONT_DIR = fileURLToPath(new URL('../app/assets/fonts/subway', import.meta.url))
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
      + 'Os arquivos são versionados no Git: restaure-os com `git checkout -- app/assets/fonts/subway`.',
    )
  }
}
