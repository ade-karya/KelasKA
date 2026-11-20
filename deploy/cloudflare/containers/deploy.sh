#!/usr/bin/env bash
# Build and deploy the Cloudflare Containers proxy.
# Run from anywhere; all paths are relative to this file.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules/wrangler ]; then
  echo "[cloudflare] installing the proxy's own dependencies"
  npm install --no-audit --no-fund
fi

echo "[cloudflare] typechecking the Worker"
npm run --silent typecheck

# Extra arguments are forwarded to wrangler (e.g. --env staging).
exec npx --no-install wrangler deploy --config wrangler.jsonc "$@"
