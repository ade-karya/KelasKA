#!/usr/bin/env bash
# Build the static documentation site (`packages/docs`, Fumadocs) into
# `public/docs-site`, which `app/docs/[[...slug]]/route.ts` serves at `/docs`.
#
# `packages/docs` is a separate Next.js app: it is excluded from the Bun
# workspace (`"!packages/docs"`), has its own dependency set, and exports plain
# files (`getting-started.html`, `_next/…`, `static.json`). The route handler
# maps the extension-less `/docs/<slug>` URLs onto those files.
#
# Used by install.sh (in the background, before the main production build) and
# runnable by hand: `bash scripts/build-docs.sh`.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS_DIR="$ROOT_DIR/packages/docs"
OUT_DIR="$ROOT_DIR/public/docs-site"
BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"

if [[ ! -f "$DOCS_DIR/package.json" ]]; then
  echo "[docs] packages/docs tidak ada; dilewati."
  exit 0
fi
if [[ -z "$BUN_BIN" || ! -x "$BUN_BIN" ]]; then
  echo "[docs] Bun tidak ditemukan; build dokumentasi dilewati." >&2
  exit 1
fi

# The docs app keeps its own node_modules (not part of the workspace lockfile).
if [[ ! -d "$DOCS_DIR/node_modules" || "$DOCS_DIR/package.json" -nt "$DOCS_DIR/node_modules" ]]; then
  echo "[docs] memasang dependensi packages/docs ..."
  (cd "$DOCS_DIR" && NEXT_TELEMETRY_DISABLED=1 "$BUN_BIN" install --no-save)
fi

echo "[docs] membangun situs statis (next build + postexport) ..."
(cd "$DOCS_DIR" && NEXT_TELEMETRY_DISABLED=1 "$BUN_BIN" --bun run build)

if [[ ! -f "$DOCS_DIR/out/index.html" ]]; then
  echo "[docs] build selesai tanpa out/index.html; dianggap gagal." >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$ROOT_DIR/public"
cp -a "$DOCS_DIR/out" "$OUT_DIR"

if [[ ! -f "$OUT_DIR/index.html" ]]; then
  echo "[docs] penyalinan ke public/docs-site gagal (index.html hilang)." >&2
  exit 1
fi

echo "[docs] selesai: public/docs-site ($(du -sh "$OUT_DIR" | cut -f1))."
