#!/usr/bin/env bash
# Build the Vercel branch as a static UI (0 serverless functions).
#
# The full app keeps its server routes for the Kaggle branch; this script
# temporarily parks the pieces a static export cannot contain, builds `out/`,
# and restores the tree even when the build fails. Vercel rewrites `/api/*` to
# the compute gateway (see `vercel.json`), so the browser still gets the full
# application while all compute stays on Kaggle.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

HOLD="$(mktemp -d "${TMPDIR:-/tmp}/kelaska-vercel-hold.XXXXXX")"

restore() {
  local status=$?
  # Restore in reverse order; `mv` back only what this script parked.
  for rel in \
    instrumentation.node.ts \
    instrumentation.ts \
    proxy.ts \
    app/generation-preview/layout.tsx \
    'app/project-workspace/[workspaceId]' \
    'app/classroom/[id]' \
    app/docs \
    app/api; do
    if [[ -e "$HOLD/$rel" ]]; then
      rm -rf "$ROOT/$rel"
      mkdir -p "$(dirname "$ROOT/$rel")"
      mv "$HOLD/$rel" "$ROOT/$rel"
    fi
  done
  rmdir "$HOLD" 2>/dev/null || true
  exit "$status"
}
trap restore EXIT INT TERM

park() {
  local rel="$1"
  if [[ -e "$ROOT/$rel" ]]; then
    mkdir -p "$HOLD/$(dirname "$rel")"
    mv "$ROOT/$rel" "$HOLD/$rel"
    echo "[vercel-static] parked $rel"
  fi
}

# A static export cannot contain route handlers, middleware, instrumentation,
# or dynamic route segments. Each has a query-string equivalent in `app/`.
park app/api
park app/docs
park 'app/classroom/[id]'
park 'app/project-workspace/[workspaceId]'
park proxy.ts
park instrumentation.ts
park instrumentation.node.ts

# The generation preview is a client-only page; its layout only exists to force
# dynamic rendering, which a static export cannot honor.
park app/generation-preview/layout.tsx
cat > app/generation-preview/layout.tsx <<'LAYOUT'
// Static Vercel build: the preview is a client-only page, so it exports as-is.
// The Kaggle build keeps the original force-dynamic layout.
export const dynamic = 'force-static';

export default function GenerationPreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
LAYOUT

export STATIC_UI=1
export NEXT_PUBLIC_STATIC_UI=1
export NEXT_TELEMETRY_DISABLED=1
# The workbench is the Vercel home by default; a classic-home deployment can
# override it with NEXT_PUBLIC_WORKBENCH_ENABLED=false.
export NEXT_PUBLIC_WORKBENCH_ENABLED="${NEXT_PUBLIC_WORKBENCH_ENABLED:-true}"
# Canonical URL for metadata. Vercel exposes the production hostname to builds.
if [[ -z "${NEXT_PUBLIC_SITE_URL:-}" ]]; then
  if [[ -n "${VERCEL_PROJECT_PRODUCTION_URL:-}" ]]; then
    export NEXT_PUBLIC_SITE_URL="https://${VERCEL_PROJECT_PRODUCTION_URL}"
  elif [[ -n "${VERCEL_URL:-}" ]]; then
    export NEXT_PUBLIC_SITE_URL="https://${VERCEL_URL}"
  fi
fi
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"

if [[ ! -x node_modules/.bin/next ]]; then
  echo "[vercel-static] node_modules/.bin/next is missing; run bun install first" >&2
  exit 1
fi

echo "[vercel-static] building static UI (output: export)"
# The same asset preparation `bun run build` does: the classroom's interactive
# libraries, the Monaco editor and the standalone player are served from
# `public/`, which a static export copies verbatim.
node scripts/sync-interactive-assets.mjs
node scripts/prepare-code-editor.mjs
node scripts/sync-maic-importer.mjs
node scripts/assert-vendor-maic-importer.mjs
node scripts/build-standalone-player.mjs
node_modules/.bin/next build

if [[ ! -f out/index.html ]]; then
  echo "[vercel-static] build finished without out/index.html" >&2
  exit 1
fi

echo "[vercel-static] done: $(du -sh out | cut -f1) in $ROOT/out"
