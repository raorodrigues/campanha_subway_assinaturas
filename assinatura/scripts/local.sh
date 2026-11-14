#!/usr/bin/env bash
# Runs the kiosk build locally, as on the totem: `npm run local`.
#   npm run local                  build + start, online count on if ../token.txt exists
#   npm run local -- --offline     no API calls (local SQLite only)
#   npm run local -- --no-build    reuse the current .output
#   npm run local -- --open        also open the kiosk and the LED counter in the browser
#   PORT=3001 npm run local        other port (default 3000)
# Ctrl+C stops the server.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(dirname "$APP_DIR")"
KIOSK_CONFIG="$REPO_DIR/kiosk-windows/kiosk.json"
TOKEN_FILE="$REPO_DIR/token.txt"
PORT="${PORT:-3000}"

offline=0 build=1 open_browser=0
for arg in "$@"; do
  case "$arg" in
    --offline) offline=1 ;;
    --no-build) build=0 ;;
    --open) open_browser=1 ;;
    *) echo "Unknown option: $arg (use --offline, --no-build or --open)" >&2; exit 2 ;;
  esac
done

log() { printf '\033[32m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# The server needs Node 22 (node:sqlite); the shell default may be older.
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || "$(node_major "$NODE_BIN")" != 22 ]]; then
  NODE_BIN=""
  for candidate in "$HOME"/.nvm/versions/node/v22.*/bin/node; do
    [[ -x "$candidate" ]] && NODE_BIN="$candidate"
  done
  [[ -n "$NODE_BIN" ]] || fail "Node 22 not found. Install it (nvm install 22) and try again."
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
log "Node $(node -v)"

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  fail "Port $PORT is already in use. Stop that server or run: PORT=3001 npm run local"
fi

cd "$APP_DIR"
if (( build )); then
  log "Building…"
  npm run build --silent
fi
[[ -f .output/server/index.mjs ]] || fail "No build found. Run without --no-build."

# Online count: same URL and interval as the totem (kiosk.json), token from ../token.txt.
unset NUXT_REMOTE_COUNT_URL NUXT_REMOTE_COUNT_TOKEN_FILE NUXT_REMOTE_COUNT_INTERVAL_SECONDS
if (( offline )); then
  log "Online count: off (--offline)"
elif [[ ! -f "$TOKEN_FILE" ]]; then
  log "Online count: off (no token.txt at the repo root)"
else
  read -r remote_url remote_interval < <(node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    console.log(c.remoteCountUrl || "-", c.remoteCountIntervalSeconds || 60)' "$KIOSK_CONFIG")
  if [[ "$remote_url" == "-" ]]; then
    log "Online count: off (remoteCountUrl empty in kiosk.json)"
  else
    export NUXT_REMOTE_COUNT_URL="$remote_url"
    export NUXT_REMOTE_COUNT_INTERVAL_SECONDS="$remote_interval"
    export NUXT_REMOTE_COUNT_TOKEN_FILE="$TOKEN_FILE"
    log "Online count: on ($remote_url, every ${remote_interval} s)"
  fi
fi

BASE="http://127.0.0.1:$PORT"
cat <<EOF

  Kiosk (signature):   $BASE/
  LED counter:         $BASE/counter?w=512&h=192
  Counter demo:        $BASE/counter?w=512&h=192&demo
  Calibration ruler:   $BASE/counter?calibrar
  Raw count (JSON):    $BASE/api/signatures/count
  Database:            $APP_DIR/.data/signatures.sqlite

  Ctrl+C to stop.

EOF

if (( open_browser )); then
  ( for _ in $(seq 1 50); do
      curl -fs -o /dev/null "$BASE/api/signatures/count" && break
      sleep 0.2
    done
    open "$BASE/" && open "$BASE/counter?w=512&h=192" ) &
fi

export HOST=127.0.0.1 PORT
exec node .output/server/index.mjs
