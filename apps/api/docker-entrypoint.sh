#!/bin/sh
set -eu

if [ "${1:-}" = "node" ] && [ "${2:-}" = "src/server.js" ]; then
  echo "Running database migrations before starting API..."
  npm run migrate
fi

exec "$@"
