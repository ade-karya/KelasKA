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
#
# A rerun that did not touch `packages/docs` reuses the existing export: the
# docs app is a second full Next build (~15-60 s) and used to compete with the
# main production build on 4-vCPU hosts. `--force` rebuilds regardless.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS_DIR="$ROOT_DIR/packages/docs"
OUT_DIR="$ROOT_DIR/public/docs-site"
DOCS_STAMP="$DOCS_DIR/node_modules/.cache/kelaska/docs.sha256"
BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
FORCE_DOCS=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE_DOCS=1 ;;
    *) echo "[docs] opsi tidak dikenal: $arg (pakai --force)" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$DOCS_DIR/package.json" ]]; then
  echo "[docs] packages/docs tidak ada; dilewati."
  exit 0
fi
if [[ -z "$BUN_BIN" || ! -x "$BUN_BIN" ]]; then
  echo "[docs] Bun tidak ditemukan; build dokumentasi dilewati." >&2
  exit 1
fi

# Sidik jari sumber docs (git) + versi Bun. File stamp disimpan di
# node_modules docs (gitignored), jadi tidak mengubah sidik jari build utama.
docs_fingerprint() {
  {
    printf 'kelaska-docs-v1\n'
    printf 'head=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo tanpa-git)"
    git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=normal -- \
      packages/docs scripts/build-docs.sh 2>/dev/null \
      | grep -vE '^\?\? packages/docs/(node_modules|\.next|out)/' || true
    printf 'bun=%s\n' "$("$BUN_BIN" --version 2>/dev/null || echo '?')"
  } | sha256sum | awk '{print $1}'
}

if [[ "$FORCE_DOCS" -eq 0 && -f "$DOCS_STAMP" && -f "$OUT_DIR/index.html" ]]; then
  if [[ "$(cat "$DOCS_STAMP" 2>/dev/null)" == "$(docs_fingerprint)" ]]; then
    echo "[docs] sumber tidak berubah — lewati build (pakai --force untuk membangun ulang)."
    exit 0
  fi
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

mkdir -p "$(dirname "$DOCS_STAMP")"
docs_fingerprint > "$DOCS_STAMP"

echo "[docs] selesai: public/docs-site ($(du -sh "$OUT_DIR" | cut -f1))."
