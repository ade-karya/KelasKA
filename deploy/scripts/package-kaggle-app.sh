#!/usr/bin/env bash
# Package an already-built standalone app for the Kaggle APP_MODE kernel.
#
# This script does NOT run `next build`: build first with PM2 stopped (the
# install.sh --colab --no-start path does that and re-syncs static assets).
# The output directory is meant to be uploaded as the `app/` subfolder of the
# private Kaggle model dataset.
set -euo pipefail

REPO="$(pwd)"
OUT=""

usage() {
  echo "Usage: $0 --out DIR [--repo DIR]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      OUT="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      ;;
  esac
done

[[ -n "$OUT" ]] || usage

STANDALONE="$REPO/.next/standalone"
for required in "$STANDALONE/server.js" "$REPO/.next/static" "$REPO/public"; do
  if [[ ! -e "$required" ]]; then
    echo "missing $required — build the app first (install.sh --colab --no-start)" >&2
    exit 1
  fi
done

case "$OUT" in
  / | "$REPO" | "$REPO"/*)
    echo "refusing to overwrite the source tree: $OUT" >&2
    exit 1
    ;;
esac

rm -rf "$OUT"
mkdir -p "$OUT"
cp -a "$STANDALONE/." "$OUT/"
# next build does not copy client assets into standalone; the app on Kaggle
# needs them or every /_next/static/* request is a 404.
rm -rf "$OUT/.next/static" "$OUT/public"
cp -a "$REPO/.next/static" "$OUT/.next/static"
cp -a "$REPO/public" "$OUT/public"

if command -v bun >/dev/null 2>&1; then
  cp -a "$(command -v bun)" "$OUT/bun"
  chmod 755 "$OUT/bun"
else
  echo "warning: bun not found; the kernel will fall back to node server.js" >&2
fi

printf 'packaged %s\n' "$OUT"
printf 'server.js sha256: %s\n' "$(sha256sum "$OUT/server.js" | cut -d' ' -f1)"
printf 'size: %s\n' "$(du -sh "$OUT" | cut -f1)"
echo
echo "Next: upload this directory as <model-dataset>/app (kaggle datasets version -p DIR -m '...'),"
echo "then set KELASKA_APP_MODE=1 and the APP_* secrets on the kernel."
