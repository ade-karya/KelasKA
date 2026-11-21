#!/usr/bin/env bash
#
# Import `.env.local` into a Vercel project with the Vercel CLI.
#
#   npx vercel login        # browser (web) login
#   npx vercel link         # link this directory to the project
#   bash deploy/scripts/vercel-env-import.sh .env.local
#
# Values are piped on stdin, so nothing is echoed and no secret lands in the
# shell history. Existing names have to be removed first (`vercel env rm`) or
# accept the CLI's overwrite prompt.
set -euo pipefail

ENV_FILE="${1:-.env.local}"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
command -v vercel >/dev/null 2>&1 || { echo "vercel CLI not found; use npx vercel" >&2; exit 1; }

count=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  line="${line#export }"
  [[ "$line" == *=* ]] || continue
  key="${line%%=*}"
  value="${line#*=}"
  key="${key//[[:space:]]/}"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  # A .env.local value may be wrapped in matching quotes.
  if [[ ${#value} -ge 2 && ( "$value" == \"*\" || "$value" == \'*\' ) ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value" | vercel env add "$key" production >/dev/null
  printf 'added %s\n' "$key"
  count=$((count + 1))
done < "$ENV_FILE"

printf 'imported %d variables into the Vercel production environment\n' "$count"
