#!/bin/sh
set -eu

CONFIG_OUTPUT="${ADMIN_CONFIG_OUTPUT:-/usr/share/nginx/html/config.js}"

js_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

mkdir -p "$(dirname "$CONFIG_OUTPUT")"

TENCENT_MAP_KEY_ESCAPED="$(js_escape "${VITE_TENCENT_MAP_KEY:-}")"

cat > "$CONFIG_OUTPUT" <<EOF
window.__PINCH_ADMIN_CONFIG__ = Object.assign({}, window.__PINCH_ADMIN_CONFIG__, {
  TENCENT_MAP_KEY: "$TENCENT_MAP_KEY_ESCAPED"
});
EOF
