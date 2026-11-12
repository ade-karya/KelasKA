#!/usr/bin/env bash
#
# git-credential-github.sh — helper kredensial git untuk github.com.
#
# Dipanggil oleh git sendiri (bukan oleh manusia):
#
#   git config --local 'credential.https://github.com.helper' \
#     '!bash /path/ke/repo/scripts/git-credential-github.sh'
#
# `scripts/github-credentials.sh` memasang entri di atas otomatis.
#
# Urutan pencarian token (yang pertama menang):
#   1. KELASKA_GITHUB_TOKEN (escape hatch untuk sesi sekali pakai)
#   2. GITHUB_TOKEN lalu GH_TOKEN dari environment
#   3. file seed  $KELASKA_GITHUB_SEED, default ~/.config/kelaska/github.env
#   4. .env.local di root repo
#   5. `gh auth token` bila GitHub CLI login
#
# Token tidak pernah dicetak ke stderr/log; hanya dikembalikan ke git lewat
# stdout pada operasi `get`. Operasi `store`/`erase` diabaikan (tidak ada
# salinan plaintext yang ditulis helper ini).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Nilai dari file .env: ambil kemunculan terakhir, buang kutip, buang spasi.
env_file_value() {
  local file="$1" key="$2" line=""
  [[ -f "$file" && -r "$file" ]] || return 1
  line="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -1)" || return 1
  line="${line#*=}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  if [[ "$line" == \"*\" || "$line" == \'*\' ]]; then line="${line:1:${#line}-2}"; fi
  [[ -n "$line" ]] || return 1
  printf '%s' "$line"
}

resolve_token() {
  local token="" seed="${KELASKA_GITHUB_SEED:-${XDG_CONFIG_HOME:-$HOME/.config}/kelaska/github.env}"

  token="${KELASKA_GITHUB_TOKEN:-}"
  [[ -n "$token" ]] || token="${GITHUB_TOKEN:-}"
  [[ -n "$token" ]] || token="${GH_TOKEN:-}"
  if [[ -z "$token" ]]; then token="$(env_file_value "$seed" GITHUB_TOKEN || true)"; fi
  if [[ -z "$token" ]]; then token="$(env_file_value "$seed" GH_TOKEN || true)"; fi
  if [[ -z "$token" ]]; then token="$(env_file_value "$REPO_ROOT/.env.local" GITHUB_TOKEN || true)"; fi
  if [[ -z "$token" ]]; then token="$(env_file_value "$REPO_ROOT/.env.local" GH_TOKEN || true)"; fi
  if [[ -z "$token" ]] && command -v gh >/dev/null 2>&1; then
    token="$(gh auth token 2>/dev/null || true)"
  fi

  printf '%s' "$token"
}

operation="${1:-get}"
# `store`/`erase` tidak perlu jawaban; jangan pernah menghalangi git.
case "$operation" in
  get) ;;
  *) exit 0 ;;
esac

# Permintaan git datang lewat stdin: host=github.com, protocol=https, path=…
# Bila stdin bukan pipe (dijalankan manual), lewati pembacaan.
host=""
if [[ ! -t 0 ]]; then
  while IFS= read -r line; do
    case "$line" in
      host=*) host="${line#host=}" ;;
    esac
  done || true
fi

# Bila helper dipasang global, jawab hanya untuk GitHub.
if [[ -n "$host" && "$host" != "github.com" && "$host" != "www.github.com" && "$host" != "api.github.com" ]]; then
  exit 0
fi

token="$(resolve_token)"
[[ -n "$token" ]] || exit 0

printf 'username=x-access-token\npassword=%s\n' "$token"
