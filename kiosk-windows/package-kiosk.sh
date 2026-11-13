#!/usr/bin/env bash
# Builds the app (kiosk + LED counter at /counter) and assembles an offline Windows kiosk package.
# Run on a machine WITH internet (macOS/Linux). Output:
#   kiosk-windows/dist/kiosk/          -> copy as C:\kiosk on the totem
#   kiosk-windows/dist/kiosk-<stamp>.zip
#
# Env: SKIP_INSTALL=1 skips `npm ci` (reuse current node_modules).
set -euo pipefail

NODE_VERSION="22.22.3"
NODE_DIST="node-v${NODE_VERSION}-win-x64"
NODE_BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$KIT_DIR")"
CACHE_DIR="$KIT_DIR/.cache"
OUT_DIR="$KIT_DIR/dist/kiosk"
PROJECTS=(assinatura)

log() { printf '\033[32m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Node 22 for the build --------------------------------------------------------
if [[ -x "$HOME/.nvm/versions/node/v${NODE_VERSION}/bin/node" ]]; then
  export PATH="$HOME/.nvm/versions/node/v${NODE_VERSION}/bin:$PATH"
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 22 ]] || fail "Node 22+ necessario para o build (atual: $(node -v)). Rode 'nvm use'."
log "Build com Node $(node -v)"

# --- Build ------------------------------------------------------------------------
for project in "${PROJECTS[@]}"; do
  log "Build: $project"
  pushd "$REPO_DIR/$project" >/dev/null
  if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then npm ci; fi
  # Licensed Subway fonts come from subway_font.zip (never committed).
  npm run fonts:extract
  npm run build
  npm test
  popd >/dev/null
done

# --- Portable Node for Windows (cached, checksum-verified) -------------------------
mkdir -p "$CACHE_DIR"
zip_path="$CACHE_DIR/${NODE_DIST}.zip"
sums_path="$CACHE_DIR/SHASUMS256-${NODE_VERSION}.txt"
if [[ ! -f "$zip_path" ]]; then
  log "Baixando ${NODE_DIST}.zip"
  curl -fL --retry 3 -o "$zip_path.part" "$NODE_BASE_URL/${NODE_DIST}.zip"
  mv "$zip_path.part" "$zip_path"
fi
if [[ ! -f "$sums_path" ]]; then
  curl -fL --retry 3 -o "$sums_path" "$NODE_BASE_URL/SHASUMS256.txt"
fi
expected="$(grep " ${NODE_DIST}.zip\$" "$sums_path" | awk '{print $1}')"
actual="$(shasum -a 256 "$zip_path" | awk '{print $1}')"
[[ -n "$expected" && "$expected" == "$actual" ]] || { rm -f "$zip_path"; fail "Checksum do Node invalido; rode de novo."; }
log "Node Windows verificado (sha256 ok)"

# --- Assemble -----------------------------------------------------------------------
log "Montando $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

unzip -q "$zip_path" -d "$OUT_DIR"
mv "$OUT_DIR/$NODE_DIST" "$OUT_DIR/node"

for project in "${PROJECTS[@]}"; do
  mkdir -p "$OUT_DIR/$project"
  cp -R "$REPO_DIR/$project/.output" "$OUT_DIR/$project/.output"
done

cp "$KIT_DIR/kiosk.json" "$KIT_DIR/boot.html" "$KIT_DIR/README.md" "$OUT_DIR/"
# Windows PowerShell 5.1 reads BOM-less scripts as ANSI; batch files want CRLF.
for script in start-kiosk.ps1 install-kiosk.ps1; do
  { printf '\xEF\xBB\xBF'; sed 's/$/\r/' "$KIT_DIR/$script"; } > "$OUT_DIR/$script"
done
for script in start-kiosk.cmd stop-kiosk.cmd; do
  sed 's/$/\r/' "$KIT_DIR/$script" > "$OUT_DIR/$script"
done

commit="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
dirty="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null | head -1)"
stamp="$(date +%Y%m%d-%H%M)"
printf 'build=%s\ncommit=%s%s\nnode=%s\n' "$stamp" "$commit" "${dirty:+ (alteracoes nao commitadas)}" "$NODE_VERSION" \
  > "$OUT_DIR/VERSION.txt"

# --- Zip ----------------------------------------------------------------------------
zip_out="$KIT_DIR/dist/kiosk-${stamp}.zip"
(cd "$KIT_DIR/dist" && zip -qr "$zip_out" kiosk)
log "Pacote pronto: $zip_out ($(du -h "$zip_out" | awk '{print $1}'))"
log "No totem: extraia para C:\\kiosk e execute install-kiosk.ps1 como Administrador."
