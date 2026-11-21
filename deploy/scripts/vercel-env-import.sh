#!/usr/bin/env bash
#
# Import `.env.local` into a Vercel project with the Vercel CLI.
#
#   npx vercel login        # browser/device login
#   npx vercel link --yes --project <project>
#   bash deploy/scripts/vercel-env-import.sh .env.local
#
# Values are piped on stdin, so nothing is echoed and no secret lands in the
# shell history. Existing names are skipped; empty values are skipped because
# an empty Vercel secret is rejected by the CLI (absence means "disabled" for
# the flags that use blank values locally).
set -euo pipefail

ENV_FILE="${1:-.env.local}"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
command -v vercel >/dev/null 2>&1 || { echo "vercel CLI not found; use npx vercel" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required to list existing variables" >&2; exit 1; }

existing="$(mktemp)"
trap 'rm -f "$existing"' EXIT
vercel env ls production --json 2>/dev/null | jq -r '.envs[].key' > "$existing" || true

added=0
skipped=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  line="${line#export }"
  [[ "$line" == *=* ]] || continue
  key="${line%%=*}"
  value="${line#*=}"
  key="${key//[[:space:]]/}"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  if [[ ${#value} -ge 2 && ( "$value" == \"*\" || "$value" == \'*\' ) ]]; then
    value="${value:1:${#value}-2}"
  fi
  [[ "$key" == VERCEL_* ]] && continue
  if grep -Fxq "$key" "$existing"; then
    printf 'skip %s (already set)\n' "$key"
    skipped=$((skipped + 1))
    continue
  fi
  if [[ -z "$value" ]]; then
    printf 'skip %s (empty)\n' "$key"
    skipped=$((skipped + 1))
    continue
  fi
  if printf '%s' "$value" | vercel env add "$key" production >/dev/null 2>&1; then
    printf 'added %s\n' "$key"
    added=$((added + 1))
  else
    printf 'FAILED %s\n' "$key" >&2
  fi
done < "$ENV_FILE"

printf 'import complete: %d added, %d skipped\n' "$added" "$skipped"
