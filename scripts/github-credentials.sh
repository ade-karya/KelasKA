#!/usr/bin/env bash
#
# github-credentials.sh — siapkan kredensial GitHub untuk satu host.
#
# Menulis token ke `.env.local` (GITHUB_TOKEN untuk API server, GH_TOKEN untuk
# gh CLI/skrip lokal), menyimpannya ke file seed portabel, dan memasang helper
# kredensial git sehingga `git push/pull` tidak pernah meminta password.
#
# Token TIDAK pernah dicetak: ringkasan hanya menampilkan sidik jari
# sha256 (12 karakter pertama).
#
# Contoh:
#   scripts/github-credentials.sh --token=gho_xxx --write-seed
#   scripts/github-credentials.sh --write-seed          # token dari gh/env/seed
#   scripts/github-credentials.sh --check
#
# Host baru: salin ~/.config/kelaska/github.env (mode 600) lalu jalankan
# skrip ini tanpa argumen, atau langsung `install.sh --github-token=gho_xxx`.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_FILE="$REPO_ROOT/.env.local"
SEED_FILE="${KELASKA_GITHUB_SEED:-${XDG_CONFIG_HOME:-$HOME/.config}/kelaska/github.env}"
TOKEN_ARG=""
WRITE_SEED=0
FORCE=0
NO_GIT=0
CHECK_ONLY=0
VERIFY=0
QUIET=0

usage() {
  cat <<'EOF'
github-credentials.sh — siapkan kredensial GitHub untuk satu host.

Menulis token ke .env.local (GITHUB_TOKEN untuk API server, GH_TOKEN untuk gh
CLI/skrip lokal), menyimpannya ke file seed portabel, dan memasang helper
kredensial git sehingga git push/pull tidak pernah meminta password. Token
tidak pernah dicetak: ringkasan hanya memakai sidik jari sha256.

Contoh:
  scripts/github-credentials.sh --token=gho_xxx --write-seed
  scripts/github-credentials.sh --write-seed
  scripts/github-credentials.sh --check

Opsi:
  --token=TOKEN     Token eksplisit; selalu menimpa nilai lama di .env.local.
  --seed[=PATH]     Baca token dari file seed (default: ~/.config/kelaska/github.env).
  --env-file=PATH   File tujuan (default: <repo>/.env.local).
  --write-seed      Simpan token ke file seed (mode 600) agar bisa dibawa ke host lain.
  --force           Timpa token lama walau berbeda (tanpa --token=).
  --no-git          Jangan pasang helper kredensial git.
  --check           Hanya laporkan status; tidak menulis apa pun.
  --verify          Uji token ke api.github.com (butuh jaringan, tidak mencetak token).
  --quiet           Satu baris ringkasan saja.
  -h, --help        Tampilkan bantuan ini.

Urutan sumber token: --token=, GITHUB_TOKEN, GH_TOKEN, file seed, .env.local,
lalu `gh auth token`. Tanpa token, skrip ini tidak gagal (installer tetap
bisa berjalan) kecuali dengan --check.
EOF
}

say()  { [[ "$QUIET" -eq 1 ]] || printf '[github] %s\n' "$*"; }
warn() { printf '[github] peringatan: %s\n' "$*" >&2; }
die()  { printf '[github] GAGAL: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- argumen
while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --token=*)     TOKEN_ARG="${arg#*=}" ;;
    --token)       die "--token butuh nilai: --token=gho_xxx (jangan dipisah spasi)." ;;
    --seed)        SEED_FILE="${KELASKA_GITHUB_SEED:-${XDG_CONFIG_HOME:-$HOME/.config}/kelaska/github.env}" ;;
    --seed=*)      SEED_FILE="${arg#*=}" ;;
    --env-file=*)  ENV_FILE="${arg#*=}" ;;
    --write-seed)  WRITE_SEED=1 ;;
    --force)       FORCE=1 ;;
    --no-git)      NO_GIT=1 ;;
    --check)       CHECK_ONLY=1 ;;
    --verify)      VERIFY=1 ;;
    --quiet)       QUIET=1 ;;
    -h|--help)     usage; exit 0 ;;
    *) die "argumen tidak dikenal: $arg (lihat --help)." ;;
  esac
  shift
done

# ---------------------------------------------------------------- util file
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

sed_escape_replacement() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//&/\\&}"
  s="${s//|/\\|}"
  s="${s//\//\\/}"
  printf '%s' "$s"
}

# Isi key: nilai kosong selalu diisi; nilai terisi hanya ditimpa saat force.
upsert_env() {
  local file="$1" key="$2" value="$3" force="$4" escaped current
  escaped="$(sed_escape_replacement "$value")"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    current="$(env_file_value "$file" "$key" || true)"
    if [[ "$force" -eq 1 || -z "$current" || "$current" == "$value" ]]; then
      if [[ "$current" != "$value" ]]; then
        sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
      fi
    fi
    return 0
  fi
  if grep -qE "^[[:space:]]*#[[:space:]]*${key}=" "$file"; then
    sed -i -E "0,/^[[:space:]]*#[[:space:]]*${key}=/s|^[[:space:]]*#[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

fingerprint() {
  local sum
  sum="$(printf '%s' "$1" | sha256sum 2>/dev/null | cut -c1-12)"
  [[ -n "$sum" ]] || sum="(tak bisa dihitung)"
  printf 'sha256:%s' "$sum"
}

tooltip_seed() { printf '%s' "$SEED_FILE"; }

# ---------------------------------------------------------------- sumber token
TOKEN=""
TOKEN_SOURCE=""
if [[ -n "$TOKEN_ARG" ]]; then
  TOKEN="$TOKEN_ARG"; TOKEN_SOURCE="--token"
else
  for pair in "GITHUB_TOKEN:env GITHUB_TOKEN" "GH_TOKEN:env GH_TOKEN"; do
    key="${pair%%:*}"
    if [[ -n "${!key:-}" ]]; then TOKEN="${!key}"; TOKEN_SOURCE="${pair#*:}"; break; fi
  done
fi
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(env_file_value "$SEED_FILE" GITHUB_TOKEN || true)"
  [[ -n "$TOKEN" ]] && TOKEN_SOURCE="seed"
fi
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(env_file_value "$SEED_FILE" GH_TOKEN || true)"
  [[ -n "$TOKEN" ]] && TOKEN_SOURCE="seed"
fi
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(env_file_value "$ENV_FILE" GITHUB_TOKEN || true)"
  [[ -n "$TOKEN" ]] && TOKEN_SOURCE="$(basename "$ENV_FILE") GITHUB_TOKEN"
fi
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(env_file_value "$ENV_FILE" GH_TOKEN || true)"
  [[ -n "$TOKEN" ]] && TOKEN_SOURCE="$(basename "$ENV_FILE") GH_TOKEN"
fi
if [[ -z "$TOKEN" ]] && command -v gh >/dev/null 2>&1; then
  TOKEN="$(gh auth token 2>/dev/null || true)"
  [[ -n "$TOKEN" ]] && TOKEN_SOURCE="gh auth token"
fi

# Token dibuang dari environment agar tidak bocor ke proses anak (git/curl).
if [[ -n "$TOKEN" ]]; then
  unset GITHUB_TOKEN GH_TOKEN KELASKA_GITHUB_TOKEN 2>/dev/null || true
fi

mask_desc() { [[ -n "$1" ]] && printf 'terpasang (%s)' "$(fingerprint "$1")" || printf 'kosong'; }

# ---------------------------------------------------------------- verifikasi
VERIFY_USER=""
VERIFY_FAILED=0
if [[ "$VERIFY" -eq 1 && -n "$TOKEN" ]]; then
  if command -v curl >/dev/null 2>&1; then
    body="$(curl -fsS --max-time 15 \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'User-Agent: KelasKA-credentials' \
      https://api.github.com/user 2>/dev/null || true)"
    VERIFY_USER="$(printf '%s' "$body" | sed -n 's/.*"login"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    if [[ -z "$VERIFY_USER" ]]; then
      VERIFY_FAILED=1
      VERIFY_USER="token ditolak/tidak bisa diverifikasi"
    fi
  else
    warn "curl tidak tersedia — --verify dilewati."
  fi
fi

# ---------------------------------------------------------------- --check
if [[ "$CHECK_ONLY" -eq 1 ]]; then
  gh_login=""
  if command -v gh >/dev/null 2>&1; then
    gh_login="$(gh api user -q .login 2>/dev/null || true)"
    [[ -n "$gh_login" ]] || gh_login="tidak login"
  else
    gh_login="gh tidak terpasang"
  fi
  helper=""
  if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    helper="$(git -C "$REPO_ROOT" config --local --get 'credential.https://github.com.helper' 2>/dev/null || true)"
  fi
  printf '[github] env file      : %s\n' "$ENV_FILE"
  printf '[github] GITHUB_TOKEN  : %s\n' "$(mask_desc "$(env_file_value "$ENV_FILE" GITHUB_TOKEN || true)")"
  printf '[github] GH_TOKEN      : %s\n' "$(mask_desc "$(env_file_value "$ENV_FILE" GH_TOKEN || true)")"
  printf '[github] seed          : %s %s\n' "$SEED_FILE" "$(mask_desc "$(env_file_value "$SEED_FILE" GITHUB_TOKEN || true)")"
  printf '[github] gh CLI        : %s\n' "$gh_login"
  printf '[github] git helper    : %s\n' "${helper:-belum terpasang}"
  if [[ "$VERIFY" -eq 1 ]]; then
    printf '[github] api.github.com: %s\n' "${VERIFY_USER:-tidak diuji}"
  fi
  if [[ -n "$TOKEN" && "$VERIFY_FAILED" -eq 0 ]]; then exit 0; fi
  [[ -n "$TOKEN" ]] && exit 1
  exit 1
fi

# ---------------------------------------------------------------- tanpa token
if [[ -z "$TOKEN" ]]; then
  say "Tidak ada token GitHub (--token=, GITHUB_TOKEN, GH_TOKEN, seed, atau gh login)."
  say "Lewati penulisan .env.local; git tetap memakai kredensial yang sudah ada."
  exit 0
fi

if [[ "${#TOKEN}" -lt 20 ]]; then
  warn "token hanya ${#TOKEN} karakter — sepertinya salah tempel."
fi
if [[ ! "$TOKEN" =~ ^(gh[pousr]_|github_pat_|[0-9a-f]{40}) ]]; then
  warn "format token tidak dikenali (gho_/ghp_/github_pat_/40-hex) — tetap ditulis."
fi
if [[ "$VERIFY_FAILED" -eq 1 ]]; then
  die "token ditolak api.github.com — periksa kedaluwarsa/scope, lalu ulangi."
fi

# ---------------------------------------------------------------- .env.local
if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ "$ENV_FILE" == "$REPO_ROOT/.env.local" && -f "$REPO_ROOT/.env.example" ]]; then
    cp "$REPO_ROOT/.env.example" "$ENV_FILE"
    say ".env.local dibuat dari .env.example."
  else
    {
      echo "# OpenMAIC local environment — dibuat oleh scripts/github-credentials.sh"
      echo "ACCESS_CODE="
      echo "OPENMAIC_SECRET_KEY="
    } > "$ENV_FILE"
    say "$(basename "$ENV_FILE") dibuat baru."
  fi
fi

force_env=0
[[ -n "$TOKEN_ARG" || "$FORCE" -eq 1 ]] && force_env=1
upsert_env "$ENV_FILE" GITHUB_TOKEN "$TOKEN" "$force_env"
upsert_env "$ENV_FILE" GH_TOKEN "$TOKEN" "$force_env"
chmod 600 "$ENV_FILE" 2>/dev/null || true

written=0
for key in GITHUB_TOKEN GH_TOKEN; do
  [[ "$(env_file_value "$ENV_FILE" "$key" || true)" == "$TOKEN" ]] && written=$((written + 1))
done
if [[ "$written" -eq 2 ]]; then
  say ".env.local: GITHUB_TOKEN + GH_TOKEN = $(fingerprint "$TOKEN") (sumber: ${TOKEN_SOURCE})."
else
  warn ".env.local masih memuat token lain untuk sebagian key; pakai --force untuk menimpa."
fi

# ---------------------------------------------------------------- file seed
if [[ "$WRITE_SEED" -eq 1 ]]; then
  seed_current="$(env_file_value "$SEED_FILE" GITHUB_TOKEN || true)"
  seed_force=0
  [[ -n "$TOKEN_ARG" || "$FORCE" -eq 1 ]] && seed_force=1
  if [[ -z "$seed_current" || "$seed_current" == "$TOKEN" ]]; then
    mkdir -p "$(dirname "$SEED_FILE")"
    chmod 700 "$(dirname "$SEED_FILE")" 2>/dev/null || true
    (
      umask 077
      {
        echo "# Kredensial GitHub KelasKA — dibaca scripts/git-credential-github.sh."
        echo "# Salin file ini ke host baru (mode 600), atau jalankan install.sh --github-token=..."
        echo "GITHUB_TOKEN=$TOKEN"
        echo "GH_TOKEN=$TOKEN"
      } > "$SEED_FILE"
    )
    chmod 600 "$SEED_FILE" 2>/dev/null || true
    say "seed: $(tooltip_seed) = $(fingerprint "$TOKEN")."
  elif [[ "$seed_force" -eq 1 ]]; then
    (
      umask 077
      { grep -vE '^[[:space:]]*(GITHUB_TOKEN|GH_TOKEN)=' "$SEED_FILE" 2>/dev/null || true; } > "$SEED_FILE.tmp.$$"
      printf 'GITHUB_TOKEN=%s\nGH_TOKEN=%s\n' "$TOKEN" "$TOKEN" >> "$SEED_FILE.tmp.$$"
      mv "$SEED_FILE.tmp.$$" "$SEED_FILE"
    )
    chmod 600 "$SEED_FILE" 2>/dev/null || true
    say "seed: $(tooltip_seed) diperbarui = $(fingerprint "$TOKEN")."
  else
    warn "seed $(tooltip_seed) memuat token lain; biarkan (pakai --force untuk menimpa)."
  fi
fi

# ---------------------------------------------------------------- git helper
if [[ "$NO_GIT" -eq 0 ]]; then
  if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    helper_script="$REPO_ROOT/scripts/git-credential-github.sh"
    chmod +x "$helper_script" 2>/dev/null || true
    quoted="$(printf '%q' "$helper_script")"
    git -C "$REPO_ROOT" config --local 'credential.https://github.com.helper' "!bash ${quoted}"
    say "git helper: credential.https://github.com.helper dipasang (repo-local)."
  else
    warn "$REPO_ROOT bukan repo git — helper kredensial dilewati."
  fi
fi

if [[ "$VERIFY" -eq 1 ]]; then
  say "api.github.com: ${VERIFY_USER}."
elif [[ -n "$TOKEN" ]]; then
  say "Selesai. Token $(fingerprint "$TOKEN"); jalankan ulang dengan --verify untuk menguji jaringan."
fi

exit 0
