#!/usr/bin/env bash
#
# install.sh — Installer server fresh untuk OpenMAIC (Ubuntu / Debian).
#
# Menyiapkan semuanya dari nol sehingga perintah berikut bisa jalan:
#   npm run dev     (mode pengembangan)
#   npm run build   (build produksi)
#   npm run start   (jalankan hasil build)
# (Perintah padanannya via pnpm — `pnpm dev / pnpm build / pnpm start` — juga bisa.)
#
# Yang diinstal / disiapkan:
#   1. Paket sistem (apt): build tools untuk sharp & canvas, cairo/pango,
#      ffmpeg (ffprobe ikut di paket ffmpeg), git, curl, openssl.
#      PostgreSQL 18 (mayor stabil terbaru; 19 masih beta) dari repo resmi
#      PGDG (apt.postgresql.org) — bukan paket bawaan distro yang tertinggal
#      (Ubuntu 24.04 = PG 16).
#   2. Node.js 24 (>= 24.21, sesuai `engines` di package.json) via NodeSource.
#   3. pnpm 12.6.0 via corepack (sesuai `packageManager` di package.json).
#   4. PostgreSQL 18: database + user `openmaic` + password acak.
#   5. OpenCode CLI v2 via https://opencode.ai/v2/install (default terinstal;
#      dilewati bila sudah versi terbaru; bisa dilewati total dengan
#      --no-opencode). Ollama TIDAK diinstal lagi.
#   6. File `.env.local` (dibuat dari template bila belum ada; bila sudah ada
#      hanya dilengkapi variabel yang hilang — tidak menimpa isi user).
#      LLM default: opencode:muse-spark-1.3-contributor-free (provider `opencode` terdaftar di
#      lib/ai/providers.ts; gateway Zen https://opencode.ai/zen/v1).
#   7. Direktori `data/` untuk classroom store berbasis file.
#   8. Dependensi JS via `pnpm install --frozen-lockfile`
#      (postinstall otomatis build workspace packages + sync vendor importer).
#   9. Verifikasi: vendor bundle PPTX + kontrak Node engine.
#
# Cara pakai:
#   sudo ./install.sh [opsi]
#
# Opsi:
#   --yes               Non-interaktif (tanpa konfirmasi).
#   --no-postgres       Lewati instalasi & setup PostgreSQL
#                       (agent runtime + persistence tetap nonaktif).
#   --no-opencode       Lewati instalasi OpenCode CLI v2.
#   --with-opencode     Instal OpenCode CLI v2 (default sudah ON; flag ini
#                       no-op, disediakan agar eksplisit).
#   --no-install        Lewati `pnpm install` (hanya siapkan sistem + env).
#   --build             Jalankan `npm run build` di akhir sebagai pembuktian.
#   --with-playwright   Instal browser Chromium untuk e2e Playwright.
#   --pg-password=PASS  Paksa password Postgres (default: dibuat acak).
#   -h, --help          Tampilkan bantuan ini.
#
# Idempoten: aman dijalankan ulang. File .env.local yang sudah ada di-backup
# ke `.env.local.bak.<waktu>` sebelum dilengkapi.

set -euo pipefail

# ---------------------------------------------------------------- warna & log
if [[ -t 1 ]]; then
  HIJAU='\033[0;32m'; KUNING='\033[0;33m'; MERAH='\033[0;31m'; RESET='\033[0m'
else
  HIJAU=''; KUNING=''; MERAH=''; RESET=''
fi
info()  { echo -e "${HIJAU}[install]${RESET} $*"; }
warn()  { echo -e "${KUNING}[install] peringatan:${RESET} $*" >&2; }
fail()  { echo -e "${MERAH}[install] GAGAL:${RESET} $*" >&2; exit 1; }

# ------------------------------------------------- direktori repo (root proyek)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
[[ -f package.json && -f pnpm-lock.yaml ]] \
  || fail "install.sh harus dijalankan dari root repo OpenMAIC (tidak ada package.json / pnpm-lock.yaml di $ROOT_DIR)."

# ------------------------------------------------------------------ opsi CLI
ASSUME_YES=0
WITH_POSTGRES=1
WITH_INSTALL=1
WITH_BUILD=0
WITH_PLAYWRIGHT=0
WITH_OPENCODE=1
PG_PASSWORD="${PG_PASSWORD:-}"
# Mayor Postgres target: 18 = stabil terbaru (19 masih beta per Sep 2026).
PG_MAJOR="18"

for arg in "$@"; do
  case "$arg" in
    --yes)             ASSUME_YES=1 ;;
    --no-postgres)     WITH_POSTGRES=0 ;;
    --no-install)      WITH_INSTALL=0 ;;
    --build)           WITH_BUILD=1 ;;
    --with-playwright) WITH_PLAYWRIGHT=1 ;;
    --with-opencode)   WITH_OPENCODE=1 ;;
    --no-opencode)     WITH_OPENCODE=0 ;;
    --with-ollama)     fail "Opsi --with-ollama sudah dihapus: Ollama tidak lagi diinstal. OpenMAIC kini memakai OpenCode CLI v2 (opencode:muse-spark-1.3-contributor-free). Hapus flag tersebut dan ulangi." ;;
    --pg-password=*)   PG_PASSWORD="${arg#*=}" ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      echo "Contoh:"
      echo "  sudo ./install.sh --yes"
      echo "  sudo ./install.sh --yes --build --with-playwright"
      echo "  sudo ./install.sh --yes --no-postgres   # tanpa Postgres (fitur agent/persistence mati)"
      echo "  sudo ./install.sh --yes --no-opencode   # tanpa OpenCode CLI"
      exit 0 ;;
    *) fail "Opsi tidak dikenal: $arg (lihat --help)." ;;
  esac
done

# ---------------------------------------------------------------- sudo / root
if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "Jalankan sebagai root atau instal sudo dulu."
  SUDO="sudo"
fi

# Helper: jadi root untuk pipe installer (aman bila $SUDO kosong).
# Alasan: bentuk "| $SUDO -E bash -" rusak saat $SUDO="" (menjadi "| -E bash -"
# -> "-E: command not found", persis error Colab sebagai root).
run_pipe_as_root() {
  if [[ -n "${SUDO:-}" ]]; then
    $SUDO -E bash -
  else
    bash -
  fi
}

# Helper: jalankan perintah sebagai user postgres (bekerja baik sebagai
# root langsung maupun via sudo). Bentuk "$SUDO -u postgres ..." juga rusak
# saat $SUDO="" (menjadi "-u postgres ..." -> "-u: command not found").
pg_as_postgres() {
  if [[ -n "${SUDO:-}" ]]; then
    $SUDO -u postgres "$@"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- "$@"
  else
    # Fallback via su; bangun command line dengan quoting yang aman.
    local q=""
    local a
    for a in "$@"; do q="$q $(printf '%q' "$a")"; done
    su postgres -c "$q"
  fi
}

# ------------------------------------------------------- deteksi distro (apt)
if ! command -v apt-get >/dev/null 2>&1; then
  fail "Script ini untuk Ubuntu/Debian (butuh apt-get). Di distro lain, samakan manual: Node 24 + pnpm 12.6 + Postgres + paket build di Dockerfile."
fi

# ---------------------------------------------------------------- konfirmasi
if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo "Installer OpenMAIC akan:"
  echo "  - apt install: build tools, cairo/pango, ffmpeg, git, curl, openssl$( [[ "$WITH_POSTGRES" -eq 1 ]] && echo ", postgresql-${PG_MAJOR} (repo PGDG)" )"
  echo "  - instal Node.js 24 (bila belum memenuhi syarat) + pnpm 12.6.0"
  echo "  - instal OpenCode CLI v2 (bila --no-opencode tidak dipakai)"
  echo "  - setup database Postgres 'openmaic' di PG ${PG_MAJOR} (bila --no-postgres tidak dipakai)"
  echo "  - buat/lengkapi .env.local (DEFAULT_MODEL=opencode:muse-spark-1.3-contributor-free), direktori data/, pnpm install$( [[ "$WITH_BUILD" -eq 1 ]] && echo ", npm run build" )"
  read -rp "Lanjut? [y/N] " jawab
  [[ "$jawab" =~ ^[yY]$ ]] || { info "Dibatalkan."; exit 0; }
fi

# ============================================================ 1. Paket sistem
info "Menginstal paket sistem via apt..."
$SUDO apt-get update -y
APT_PKGS=(
  ca-certificates curl gnupg lsb-release git openssl
  python3 build-essential g++ pkg-config
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  ffmpeg
)
$SUDO apt-get install -y "${APT_PKGS[@]}"

# ------------------------------------------------- PostgreSQL 18 via PGDG
# Paket `postgresql` bawaan distro tertinggal jauh (Ubuntu 24.04 = PG 16).
# Target: PG ${PG_MAJOR} = mayor stabil terbaru (19 masih beta per Sep 2026).
# Sumber resmi: https://www.postgresql.org/download/linux/ubuntu/
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  if ! apt-cache policy 2>/dev/null | grep -q "apt.postgresql.org"; then
    info "Menambahkan repo PGDG (apt.postgresql.org)..."
    $SUDO install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | $SUDO gpg --dearmor -o /usr/share/keyrings/postgresql.gpg --yes
    $SUDO chmod 0644 /usr/share/keyrings/postgresql.gpg
    CODENAME="$(lsb_release -cs)"
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
      | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
    $SUDO apt-get update -y
  else
    info "Repo PGDG sudah ada — lewati."
  fi
  info "Menginstal PostgreSQL ${PG_MAJOR}..."
  $SUDO apt-get install -y "postgresql-${PG_MAJOR}" postgresql-contrib
fi

# ============================================================ 2. Node.js >= 24.21
# Syarat mengikuti `engines` di package.json (>= 24.21.0). Cek major saja
# tidak cukup: Node 24.0-24.20 lolos cek major tapi gagal kontrak engine.
NEED_NODE=1
NODE_MIN_WANT="24.21.0"
if command -v node >/dev/null 2>&1; then
  NODE_MIN_WANT="$(node -p "try{require('./package.json').engines.node.replace(/[^0-9.]/g,'')}catch(e){'24.21.0'}" 2>/dev/null || echo '24.21.0')"
  [[ "$NODE_MIN_WANT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || NODE_MIN_WANT="24.21.0"
fi
node_version_gte() {
  # node_version_gte <punya> <minimum>: true bila punya >= minimum (semver 3 angka).
  local have="$1" want="$2"
  local h1 h2 h3 w1 w2 w3
  IFS=. read -r h1 h2 h3 <<<"${have%%[^0-9.]*}"
  IFS=. read -r w1 w2 w3 <<<"$want"
  h1=${h1:-0}; h2=${h2:-0}; h3=${h3%%[^0-9]*}; h3=${h3:-0}
  w1=${w1:-0}; w2=${w2:-0}; w3=${w3:-0}
  if [[ "$h1" -gt "$w1" ]]; then return 0; fi
  if [[ "$h1" -lt "$w1" ]]; then return 1; fi
  if [[ "$h2" -gt "$w2" ]]; then return 0; fi
  if [[ "$h2" -lt "$w2" ]]; then return 1; fi
  [[ "$h3" -ge "$w3" ]]
}
if command -v node >/dev/null 2>&1; then
  NODE_V="$(node -v | sed 's/^v//')"
  if node_version_gte "$NODE_V" "$NODE_MIN_WANT"; then
    info "Node.js $NODE_V sudah memenuhi syarat (>= $NODE_MIN_WANT). Lewati instalasi Node."
    NEED_NODE=0
  else
    warn "Node.js $NODE_V terlalu tua (butuh >= $NODE_MIN_WANT). Akan upgrade ke Node 24."
  fi
fi

if [[ "$NEED_NODE" -eq 1 ]]; then
  info "Menginstal Node.js 24 via NodeSource..."
  # NodeSource setup (resmi): menambah repo nodesource untuk major 24.
  curl -fsSL https://deb.nodesource.com/setup_24.x | run_pipe_as_root
  $SUDO apt-get install -y nodejs
fi
node -v || fail "Instalasi Node.js gagal."
NPM_V="$(npm -v 2>/dev/null || echo "?")"
info "Node $(node -v), npm $NPM_V."

# ============================================================ 3. pnpm 12.6.0
# Versi dikunci mengikuti kolom `packageManager` di package.json (Dockerfile
# memakai cara yang sama: corepack prepare pnpm@12.6.0 --activate).
PNPM_WANT="$(node -p "require('./package.json').packageManager || ''" | sed 's/.*pnpm@//; s/+.*//')"
[[ -n "$PNPM_WANT" ]] || PNPM_WANT="12.6.0"
info "Menyiapkan pnpm@$PNPM_WANT via corepack..."
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
$SUDO corepack enable || corepack enable || true
corepack prepare "pnpm@$PNPM_WANT" --activate
command -v pnpm >/dev/null 2>&1 || fail "pnpm tidak ditemukan setelah corepack prepare."
info "pnpm $(pnpm -v)."

# ============================================================ 4. PostgreSQL 18
DATABASE_URL_VALUE=""
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  info "Menyiapkan PostgreSQL ${PG_MAJOR}..."

  # Nyalakan service (tahan terhadap lingkungan tanpa systemd).
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    $SUDO systemctl enable --now postgresql || warn "systemctl postgresql gagal; lanjutkan, cek manual."
  elif command -v service >/dev/null 2>&1; then
    $SUDO service postgresql start || warn "'service postgresql start' gagal; lanjutkan, cek manual."
  else
    $SUDO pg_ctlcluster "${PG_MAJOR}" main start \
      || warn "pg_ctlcluster ${PG_MAJOR} gagal; lanjutkan, cek manual."
  fi
  # Port cluster PG ${PG_MAJOR}/main (5432 bila bebas, atau 5433 bila 5432
  # masih dipakai cluster lama). Semua perintah psql di bawah memakai port ini.
  # Paket postgresql-${PG_MAJOR} biasanya membuat cluster main otomatis, tapi
  # cluster bisa hilang (pernah di-drop manual) sementara paketnya tetap
  # terinstal — pastikan ada sebelum lanjut.
  if ! pg_lsclusters 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main" {found=1} END {exit !found}'; then
    info "Cluster ${PG_MAJOR}/main belum ada — membuat via pg_createcluster..."
    $SUDO pg_createcluster "${PG_MAJOR}" main \
      && $SUDO pg_ctlcluster "${PG_MAJOR}" main start \
      || warn "pg_createcluster/pg_ctlcluster ${PG_MAJOR} gagal; setup role/DB dilewati, buat manual."
  fi
  PGPORT="$(pg_lsclusters 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main" {print $3}' | head -1)"
  if [[ "$PGPORT" =~ ^[0-9]+$ ]]; then
    info "Cluster PostgreSQL ${PG_MAJOR}/main di port ${PGPORT}."
    pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1 \
      || warn "Postgres belum merespons di localhost:${PGPORT} (pg_isready gagal). Setup role/DB mungkin perlu dijalankan manual."
  else
    warn "Cluster PostgreSQL ${PG_MAJOR}/main tidak ditemukan — lewati setup role/DB. Buat manual: sudo pg_createcluster ${PG_MAJOR} main && sudo pg_ctlcluster ${PG_MAJOR} main start"
    PGPORT=""
  fi

  if [[ -z "$PGPORT" ]]; then
    # Tanpa cluster yang jelas, jangan sentuh cluster versi lain.
    DATABASE_URL_VALUE=""
  else

  # Password: idempoten. Jangan putar password tiap run — itu merusak
  # DATABASE_URL di .env.local yang sudah ada (pastikan_var_env tidak menimpa,
  # tapi ALTER ROLE sudah mengganti password di DB -> auth gagal berikutnya).
  # Urutan: --pg-password / PG_PASSWORD dipaksa > pakai ulang password dari
  # .env.local yang ada > baru generate acak.
  PG_PASSWORD_FORCED=0
  [[ -n "$PG_PASSWORD" ]] && PG_PASSWORD_FORCED=1
  if [[ "$PG_PASSWORD_FORCED" -eq 0 && -f .env.local ]]; then
    EXISTING_PG_PASS="$(grep -E '^[[:space:]]*DATABASE_URL=' .env.local 2>/dev/null | tail -1 | sed -E 's/^[^=]*=//' | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//' | sed -E -n 's|^postgres(ql)?://openmaic:([^@]*)@.*|\2|p')"
    if [[ -n "${EXISTING_PG_PASS:-}" ]]; then
      PG_PASSWORD="$EXISTING_PG_PASS"
      info "Memakai ulang password Postgres dari .env.local yang ada (idempoten)."
    fi
  fi
  if [[ -z "$PG_PASSWORD" ]]; then
    PG_PASSWORD="$(openssl rand -hex 16)"
    PG_PASSWORD_GENERATED=1
  else
    PG_PASSWORD_GENERATED=0
  fi
  # Escape untuk SQL (gandakan kutip satu) dan untuk URL (encode khusus).
  PG_SQL_ESCAPED="${PG_PASSWORD//\'/\'\'}"
  PG_URL_ENCODED="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PG_PASSWORD")"

  # Buat role + database bila belum ada (idempoten). Semua via port cluster PG 18.
  if pg_as_postgres psql -p "$PGPORT" -tAc "SELECT 1 FROM pg_roles WHERE rolname='openmaic'" | grep -q 1; then
    info "Role Postgres 'openmaic' sudah ada."
  else
    pg_as_postgres psql -p "$PGPORT" -c "CREATE ROLE openmaic LOGIN PASSWORD '${PG_SQL_ESCAPED}'"
    info "Role Postgres 'openmaic' dibuat."
  fi
  # Selaraskan password HANYA bila password dipaksa (--pg-password/PG_PASSWORD)
  # atau baru digenerate untuk install pertama. Run ulang tanpa flag memakai
  # ulang password lama sehingga tidak ada ALTER yang merusak .env.local.
  if [[ "$PG_PASSWORD_FORCED" -eq 1 || "${PG_PASSWORD_GENERATED:-0}" -eq 1 ]]; then
    pg_as_postgres psql -p "$PGPORT" -c "ALTER ROLE openmaic LOGIN PASSWORD '${PG_SQL_ESCAPED}'"
  fi
  if pg_as_postgres psql -p "$PGPORT" -tAc "SELECT 1 FROM pg_database WHERE datname='openmaic'" | grep -q 1; then
    info "Database 'openmaic' sudah ada."
  else
    pg_as_postgres createdb -p "$PGPORT" -O openmaic openmaic
    info "Database 'openmaic' dibuat."
  fi
  pg_as_postgres psql -p "$PGPORT" -d openmaic -c "GRANT ALL PRIVILEGES ON SCHEMA public TO openmaic;" >/dev/null

  DATABASE_URL_VALUE="postgres://openmaic:${PG_URL_ENCODED}@localhost:${PGPORT}/openmaic"
  if [[ "${PG_PASSWORD_GENERATED:-0}" -eq 1 ]]; then
    info "Password Postgres dibuat acak dan disimpan di .env.local (DATABASE_URL)."
  fi
  fi # tutup: else dari "if [[ -z $PGPORT ]]" di atas
else
  info "Lewati PostgreSQL (--no-postgres): agent runtime + persistence tetap nonaktif."
fi

# ============================================================ 5. .env.local
# Template dev: LLM default via OpenCode CLI v2 / Zen (provider `opencode`
# terdaftar di lib/ai/providers.ts). Nilai rahasia dibuat acak per server.
ACCESS_CODE_NEW="$(openssl rand -hex 24)"      # 48 char, di atas minimum 16
DEV_TOKEN_NEW="$(openssl rand -hex 16)"

tulis_template_env() {
  local db_url="$1" access_code="$2" dev_token="$3" agent_runtime="$4" opencode_bin="$5"
  cat <<EOF
# =============================================================================
# OpenMAIC dev/prod lokal — dibuat oleh install.sh pada $(date -u +%Y-%m-%d)
# LLM default: OpenCode CLI v2 (provider 'opencode' terdaftar di
# lib/ai/providers.ts, dieksekusi lokal pola nexu-io/open-design).
# CLI diinstal via: curl -fsSL https://opencode.ai/v2/install | bash
# Model FREE (big-pickle, *-free) jalan server-side TANPA API key karena
# eksekusi terjadi di dalam klien opencode. Bila CLI menuntut login:
#   opencode auth login
# Dokumentasi semua variabel: lihat .env.example
# =============================================================================

# --- LLM default (OpenCode CLI v2) ---------------------------------------------
# Harus \`provider:model\` dengan provider terdaftar; tanpa ini resolveModel throw.
DEFAULT_MODEL=opencode:muse-spark-1.3-contributor-free
# Route eksplisit maic-agent-driver (wajib + \`api\` saat agent runtime aktif).
# CATATAN: driver (pi runner) memanggil HTTP OpenAI-compatible + function tools,
# yang tidak bisa dipenuhi eksekusi CLI. Untuk agent runtime pakai model
# berbayar via OPENCODE_API_KEY (mis. opencode:deepseek-v4-flash), atau
# matikan OPENMAIC_AGENT_RUNTIME_ENABLED bila hanya perlu generasi teks.
MODEL_ROUTES='{"maic-agent-driver":{"model":"opencode:muse-spark-1.3-contributor-free","api":"openai-completions"}}'

# --- OpenCode CLI (eksekusi lokal, tanpa API key untuk model FREE) -------------
# Server memanggil binary ini per request (prompt via stdin, JSON via stdout).
# Path absolut menghindari masalah PATH pada service. Kosong = auto-discovery
# (OPENCODE_BIN, PATH, ~/.opencode/bin). Timeout per panggilan CLI.
OPENCODE_BIN=${opencode_bin}
# OPENCODE_CLI_TIMEOUT_MS=600000
# Opsional (hanya untuk pemakaian HTTP/gateway langsung, bukan CLI):
# OPENCODE_API_KEY=
# OPENCODE_BASE_URL=https://opencode.ai/zen/v1
# OPENCODE_MODELS=muse-spark-1.3-contributor-free

# --- Feature Flags: client (NEXT_PUBLIC_*) ------------------------------------
# Nilai NEXT_PUBLIC_* dibaca saat start (dev) / saat build (produksi).
NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=true
NEXT_PUBLIC_MAIC_EDITOR_ENABLED=true
NEXT_PUBLIC_MAIC_EDITOR_RENDERER_ENABLED=true
NEXT_PUBLIC_MAIC_PLAYBACK_RENDERER_ENABLED=true
NEXT_PUBLIC_PI_CHAT_ENABLED=true
NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED=true
NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI=true
NEXT_PUBLIC_ENABLE_VIDEO_EXPORT=true
NEXT_PUBLIC_ENABLE_PPTX_IMPORT=true

# --- Feature Flags: server-only -------------------------------------------------
OPENMAIC_ENABLE_VOCATIONAL=true
OPENMAIC_ENABLE_PI_NATIVE_CHILD_RUNTIME=true
OPENMAIC_ENABLE_PI_NATIVE_CHILD_SPOTLIGHT=true
# Butuh DATABASE_URL (Postgres). Tanpa DB harus false, kalau true boot hanya
# warning [config] dan route /api/agent/* menjawab 404.
OPENMAIC_AGENT_RUNTIME_ENABLED=${agent_runtime}

# --- Local/self-hosted: jaringan lokal -----------------------------------------
# Tidak ada LLM lokal yang wajib jalan (Ollama sudah tidak dipakai).
# Aktifkan hanya bila butuh URL privat/loopback (mis. SearXNG lokal).
# ALLOW_LOCAL_NETWORKS=true

# --- Persistence / Agent runtime (PostgreSQL) -----------------------------------
DATABASE_URL=${db_url}
PERSISTENCE_DEV_TOKEN=${dev_token}
NEXT_PUBLIC_PERSISTENCE=1
NEXT_PUBLIC_PERSISTENCE_TOKEN=${dev_token}
PERSISTENCE_ALLOW_INSECURE_DEV_AUTH=true
COOKIE_SECURE=0

# --- Render service MP4 (opsional, butuh \`docker compose --profile video-export up\`)
# RENDER_SERVICE_URL=http://localhost:9000

# --- Access control --------------------------------------------------------------
# Password bersama pelindung deployment. Tanpa ini API fail-open (warning saat boot).
ACCESS_CODE=${access_code}

LOG_LEVEL=info
LOG_FORMAT=pretty
EOF
}

# Lengkapi satu variabel bila belum ada di file (tanpa menimpa nilai user).
pastikan_var_env() {
  local file="$1" key="$2" value="$3"
  grep -qE "^[[:space:]]*${key}=" "$file" || echo "${key}=${value}" >> "$file"
}

if [[ ! -f .env.local ]]; then
  info "Membuat .env.local baru dari template..."
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    # OPENCODE_BIN diisi belakangan (seksi 8, setelah CLI terinstal).
    tulis_template_env "$DATABASE_URL_VALUE" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "true" "" > .env.local
  else
    tulis_template_env "" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "false" "" > .env.local
    # Tanpa Postgres, baris persistence dikomentari agar tidak ada URL kosong.
    sed -i -e 's/^DATABASE_URL=$/# DATABASE_URL=/' \
           -e 's/^PERSISTENCE_DEV_TOKEN=$/# PERSISTENCE_DEV_TOKEN=/' \
           -e 's/^NEXT_PUBLIC_PERSISTENCE=1$/# NEXT_PUBLIC_PERSISTENCE=1/' \
           -e 's/^NEXT_PUBLIC_PERSISTENCE_TOKEN=$/# NEXT_PUBLIC_PERSISTENCE_TOKEN=/' .env.local
  fi
  chmod 600 .env.local
  info ".env.local dibuat (hak akses 600 karena berisi secret)."
else
  info ".env.local sudah ada — dilengkapi tanpa menimpa nilai Anda..."
  cp .env.local ".env.local.bak.$(date +%Y%m%d-%H%M%S)"
  # Migrasi ke default OpenCode CLI v2 (muse-spark-1.3-contributor-free):
  # - ollama:* (Ollama tidak lagi diinstal) -> default baru.
  # - opencode:big-pickle (default lama) -> default baru.
  # Nilai kustom milik user (provider/model lain) tidak disentuh.
  if grep -qE '^[[:space:]]*DEFAULT_MODEL=ollama:' .env.local; then
    sed -i -E 's|^[[:space:]]*DEFAULT_MODEL=ollama:.*|DEFAULT_MODEL=opencode:muse-spark-1.3-contributor-free|' .env.local
    info "DEFAULT_MODEL dimigrasi ollama -> opencode:muse-spark-1.3-contributor-free."
  elif grep -qE '^[[:space:]]*DEFAULT_MODEL=opencode:big-pickle[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*DEFAULT_MODEL=opencode:big-pickle[[:space:]]*$|DEFAULT_MODEL=opencode:muse-spark-1.3-contributor-free|' .env.local
    info "DEFAULT_MODEL dimigrasi opencode:big-pickle -> opencode:muse-spark-1.3-contributor-free."
  fi
  if grep -qE '^[[:space:]]*MODEL_ROUTES=.*ollama:' .env.local; then
    sed -i -E '/^[[:space:]]*MODEL_ROUTES=/ s|ollama:[^"\\} ]*|opencode:muse-spark-1.3-contributor-free|g' .env.local
    info "MODEL_ROUTES dimigrasi ollama -> opencode:muse-spark-1.3-contributor-free."
  elif grep -qE '^[[:space:]]*MODEL_ROUTES=.*opencode:big-pickle' .env.local; then
    sed -i -E '/^[[:space:]]*MODEL_ROUTES=/ s|opencode:big-pickle|opencode:muse-spark-1.3-contributor-free|g' .env.local
    info "MODEL_ROUTES dimigrasi opencode:big-pickle -> opencode:muse-spark-1.3-contributor-free."
  fi
  # OPENCODE_MODELS: pastikan_var_env di bawah tidak menimpa nilai yang sudah
  # ada, jadi pin default lama (big-pickle) harus dimigrasi eksplisit di sini.
  # Nilai kustom lain tidak disentuh.
  if grep -qE '^[[:space:]]*OPENCODE_MODELS=big-pickle[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*OPENCODE_MODELS=big-pickle[[:space:]]*$|OPENCODE_MODELS=muse-spark-1.3-contributor-free|' .env.local
    info "OPENCODE_MODELS dimigrasi big-pickle -> muse-spark-1.3-contributor-free."
  fi
  pastikan_var_env .env.local DEFAULT_MODEL "opencode:muse-spark-1.3-contributor-free"
  pastikan_var_env .env.local MODEL_ROUTES '{"maic-agent-driver":{"model":"opencode:muse-spark-1.3-contributor-free","api":"openai-completions"}}'
  pastikan_var_env .env.local OPENCODE_BIN ""
  # OPENCODE_API_KEY/BASE_URL opsional (hanya HTTP langsung); jangan buat key
  # kosong yang mengesankan wajib — cukup pastikan pin model tersedia.
  pastikan_var_env .env.local OPENCODE_MODELS "muse-spark-1.3-contributor-free"
  pastikan_var_env .env.local ACCESS_CODE "$ACCESS_CODE_NEW"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    if [[ "${PG_PASSWORD_FORCED:-0}" -eq 1 ]]; then
      # Password dipaksa via --pg-password/PG_PASSWORD: sinkronkan file agar
      # tidak stale (kasus satu-satunya DATABASE_URL boleh ditimpa).
      # Escape & dan | agar aman sebagai replacement sed (password sudah URL-encode,
      # jadi se Seharusnya tidak ada, tapi tetap amankan).
      DB_URL_SED_ESCAPED="${DATABASE_URL_VALUE//&/\\&}"
      DB_URL_SED_ESCAPED="${DB_URL_SED_ESCAPED//|/\\|}"
      if grep -qE '^[[:space:]]*DATABASE_URL=' .env.local; then
        sed -i -E "s|^[[:space:]]*DATABASE_URL=.*|DATABASE_URL=${DB_URL_SED_ESCAPED}|" .env.local
      else
        echo "DATABASE_URL=${DATABASE_URL_VALUE}" >> .env.local
      fi
      info "DATABASE_URL di .env.local disinkronkan dengan password yang dipaksa."
    else
      pastikan_var_env .env.local DATABASE_URL "$DATABASE_URL_VALUE"
    fi
    pastikan_var_env .env.local PERSISTENCE_DEV_TOKEN "$DEV_TOKEN_NEW"
    pastikan_var_env .env.local NEXT_PUBLIC_PERSISTENCE "1"
    # Samakan token publik dengan token server bila yang publik belum diset.
    if ! grep -qE '^[[:space:]]*NEXT_PUBLIC_PERSISTENCE_TOKEN=' .env.local; then
      SERVER_TOKEN="$(grep -E '^[[:space:]]*PERSISTENCE_DEV_TOKEN=' .env.local | tail -1 | cut -d= -f2-)"
      echo "NEXT_PUBLIC_PERSISTENCE_TOKEN=${SERVER_TOKEN}" >> .env.local
    fi
    pastikan_var_env .env.local PERSISTENCE_ALLOW_INSECURE_DEV_AUTH "true"
    pastikan_var_env .env.local COOKIE_SECURE "0"
    # Bila DB baru disiapkan di run ini dan flag masih mati, nyalakan.
    if grep -qE '^[[:space:]]*OPENMAIC_AGENT_RUNTIME_ENABLED=false' .env.local; then
      sed -i 's/^[[:space:]]*OPENMAIC_AGENT_RUNTIME_ENABLED=false/OPENMAIC_AGENT_RUNTIME_ENABLED=true/' .env.local
      info "OPENMAIC_AGENT_RUNTIME_ENABLED dinyalakan (DATABASE_URL tersedia)."
    fi
    pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "true"
  else
    warn "Postgres dilewati: OPENMAIC_AGENT_RUNTIME_ENABLED dibiarkan apa adanya (matikan bila warning [config] muncul)."
  fi
fi

# ============================================================ 6. Direktori data
info "Menyiapkan direktori data/..."
mkdir -p data/classrooms data/classroom-jobs

# ============================================================ 7. Dependensi JS
if [[ "$WITH_INSTALL" -eq 1 ]]; then
  info "Menjalankan pnpm install --frozen-lockfile (postinstall: build packages + sync vendor)..."
  # Batas heap eksplisit seperti Dockerfile agar predictable di server kecil.
  NODE_OPTIONS="--max-old-space-size=3072" pnpm install --frozen-lockfile

  info "Verifikasi vendor bundle PPTX..."
  node scripts/assert-vendor-maic-importer.mjs

  info "Verifikasi kontrak Node engine..."
  node scripts/check-node-engine-contract.mjs
else
  info "Lewati pnpm install (--no-install). Jalankan manual nanti: pnpm install"
fi

# ============================================================ 8. Opsional
if [[ "$WITH_OPENCODE" -eq 1 ]]; then
  # Instal sebagai user pemilik sesi (bukan root) agar binary + auth milik user
  # yang benar; installer v2 menaruhnya di ~/.opencode/bin.
  OPENCODE_TARGET_USER="${SUDO_USER:-$(id -un)}"
  OPENCODE_TARGET_HOME="$(eval echo "~${OPENCODE_TARGET_USER}")"
  # Lewati bila binary sudah versi terbaru (idempoten): bandingkan versi
  # terinstal dengan versi latest dari update API resmi — sumber yang sama
  # dipakai installer v2 (https://opencode.ai/update/api/latest/cli/npm).
  OPENCODE_NEED_INSTALL=1
  OPENCODE_BIN_EXISTING=""
  for cand in "${OPENCODE_TARGET_HOME}/.opencode/bin/opencode" "${OPENCODE_TARGET_HOME}/bin/opencode"; do
    if [[ -x "$cand" ]]; then OPENCODE_BIN_EXISTING="$cand"; break; fi
  done
  if [[ -z "$OPENCODE_BIN_EXISTING" ]] && command -v opencode >/dev/null 2>&1; then
    OPENCODE_BIN_EXISTING="$(command -v opencode)"
  fi
  if [[ -n "$OPENCODE_BIN_EXISTING" ]]; then
    OPENCODE_HAVE="$("$OPENCODE_BIN_EXISTING" --version 2>/dev/null | awk '{print $NF}' | sed 's/^v//')"
    OPENCODE_LATEST="$(curl -fsSL --max-time 20 https://opencode.ai/update/api/latest/cli/npm 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    if [[ -n "$OPENCODE_HAVE" && -n "$OPENCODE_LATEST" ]]; then
      if [[ "$OPENCODE_HAVE" == "$OPENCODE_LATEST" ]]; then
        info "OpenCode CLI ${OPENCODE_HAVE} sudah versi terbaru — lewati instalasi."
        OPENCODE_NEED_INSTALL=0
      else
        info "OpenCode CLI ${OPENCODE_HAVE} tertinggal (terbaru ${OPENCODE_LATEST}) — upgrade..."
      fi
    elif [[ -n "$OPENCODE_HAVE" ]]; then
      warn "Tidak bisa cek versi terbaru (offline?); binary ${OPENCODE_HAVE} sudah ada — lewati instalasi."
      OPENCODE_NEED_INSTALL=0
    fi
  fi
  if [[ "$OPENCODE_NEED_INSTALL" -eq 1 ]]; then
    # Instal sebagai user pemilik sesi (bukan root) agar binary + auth milik user
    # yang benar; installer v2 menaruhnya di ~/.opencode/bin.
    info "Menginstal OpenCode CLI v2 untuk user ${OPENCODE_TARGET_USER}..."
    # Sumber resmi v2: https://github.com/anomalyco/opencode/tree/v2
    if [[ "$(id -un)" == "${OPENCODE_TARGET_USER}" ]]; then
      curl -fsSL https://opencode.ai/v2/install | bash - \
        || warn "Instalasi OpenCode CLI gagal; jalankan manual: curl -fsSL https://opencode.ai/v2/install | bash"
    else
      curl -fsSL https://opencode.ai/v2/install | $SUDO -u "${OPENCODE_TARGET_USER}" bash - \
        || warn "Instalasi OpenCode CLI gagal; jalankan manual sebagai ${OPENCODE_TARGET_USER}: curl -fsSL https://opencode.ai/v2/install | bash"
    fi
  fi
  # Catat path absolut binary agar server menemukannya walau ~/.opencode/bin
  # tidak ada di PATH service (khususnya saat server jalan sebagai user lain).
  OPENCODE_BIN_DETECTED=""
  for cand in "${OPENCODE_TARGET_HOME}/.opencode/bin/opencode" "${OPENCODE_TARGET_HOME}/bin/opencode"; do
    if [[ -x "$cand" ]]; then OPENCODE_BIN_DETECTED="$cand"; break; fi
  done
  if [[ -z "$OPENCODE_BIN_DETECTED" ]] && command -v opencode >/dev/null 2>&1; then
    OPENCODE_BIN_DETECTED="$(command -v opencode)"
  fi
  if [[ -n "$OPENCODE_BIN_DETECTED" ]]; then
    info "OpenCode CLI: ${OPENCODE_BIN_DETECTED}"
    echo "  Model gratis: opencode auth login && opencode run -m opencode/muse-spark-1.3-contributor-free \"hi\""
  else
    warn "Binary opencode tidak ditemukan setelah instal; cek manual lalu set OPENCODE_BIN di .env.local."
  fi
  # Backfill OPENCODE_BIN ke .env.local (template seksi 5 dibuat sebelum
  # instalasi, sehingga nilainya masih kosong). Hanya isi bila kosong.
  if [[ -n "${OPENCODE_BIN_DETECTED:-}" && -f .env.local ]]; then
    if grep -qE '^[[:space:]]*OPENCODE_BIN=' .env.local; then
      if grep -qE '^[[:space:]]*OPENCODE_BIN=[[:space:]]*$' .env.local; then
        BIN_SED_ESCAPED="${OPENCODE_BIN_DETECTED//&/\\&}"
        BIN_SED_ESCAPED="${BIN_SED_ESCAPED//|/\\|}"
        sed -i -E "s|^[[:space:]]*OPENCODE_BIN=.*|OPENCODE_BIN=${BIN_SED_ESCAPED}|" .env.local
        info "OPENCODE_BIN dicatat di .env.local."
      fi
    else
      echo "OPENCODE_BIN=${OPENCODE_BIN_DETECTED}" >> .env.local
      info "OPENCODE_BIN dicatat di .env.local."
    fi
  fi
else
  info "Lewati OpenCode CLI (--no-opencode). Instal manual nanti: curl -fsSL https://opencode.ai/v2/install | bash"
fi

if [[ "$WITH_PLAYWRIGHT" -eq 1 ]]; then
  info "Menginstal browser Playwright (chromium + dependensi OS)..."
  pnpm exec playwright install --with-deps chromium \
    || npx --yes playwright install --with-deps chromium \
    || warn "Instalasi browser Playwright gagal; jalankan manual: pnpm exec playwright install --with-deps chromium"
fi

# ============================================================ 9. Build (opsional)
if [[ "$WITH_BUILD" -eq 1 ]]; then
  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    fail "--build butuh dependensi terinstal; ulangi tanpa --no-install."
  fi
  info "Menjalankan npm run build sebagai pembuktian..."
  npm run build
fi

# ============================================================ Selesai
echo ""
info "Instalasi selesai. Ringkasan:"
node -v; pnpm -v
if command -v opencode >/dev/null 2>&1; then
  info "OpenCode CLI: $(opencode --version 2>/dev/null || echo OK)"
fi
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  pg_lsclusters 2>/dev/null || true
  pg_isready -h localhost -p "${PGPORT:-5432}" && info "Postgres ${PG_MAJOR}: OK (port ${PGPORT:-5432})" || warn "Postgres tidak merespons — cek: sudo systemctl status postgresql"
fi
[[ -f public/vendor/maic-importer/index.js ]] \
  && info "Vendor PPTX: OK (public/vendor/maic-importer/index.js)" \
  || warn "Vendor PPTX hilang — jalankan: pnpm --filter @openmaic/importer build && pnpm run sync:maic-importer"
echo ""
# Tampilkan ACCESS_CODE agar user bisa login. Home menunda fetch library
# sampai modal selesai (pre-auth 401 ditelan diam-diam), jadi console bersih
# sejak buka pertama — tidak ada lagi "Failed to list ... HTTP 401".
if [[ -f .env.local ]]; then
  CURRENT_ACCESS_CODE="$(grep -E '^[[:space:]]*ACCESS_CODE=' .env.local 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
  if [[ -n "${CURRENT_ACCESS_CODE:-}" ]]; then
    echo "ACCESS_CODE Anda (untuk modal login di browser):"
    echo "  ${CURRENT_ACCESS_CODE}"
    echo ""
  else
    warn "ACCESS_CODE tidak diset di .env.local — API fail-open (tanpa proteksi). Set ACCESS_CODE sebelum expose ke jaringan."
  fi
fi
echo "Langkah berikutnya:"
echo "  cd $ROOT_DIR"
echo "  npm run dev     # pengembangan  -> http://localhost:3000"
echo "  npm run build   # build produksi"
echo "  npm run start   # jalankan hasil build -> http://localhost:3000"
echo ""
echo "Login akses (wajib bila ACCESS_CODE di atas ada):"
echo "  1. Buka http://localhost:3000, masukkan ACCESS_CODE di atas saat modal muncul."
echo "  2. Library dimuat otomatis setelah login (tanpa reload manual, tanpa error 401 di console)."
echo "  3. Restart dev server tiap ubah .env.local agar env terbaca ulang."
echo ""
echo "Catatan:"
echo "  - .env.local berisi secret (600). Jangan commit (sudah di .gitignore)."
echo "  - Ambil ACCESS_CODE kapan saja: grep '^ACCESS_CODE=' .env.local"
echo "  - Nilai NEXT_PUBLIC_* dibaca saat build: ubah nilainya lalu build ulang."
echo "  - LLM default: opencode:muse-spark-1.3-contributor-free (OpenCode CLI v2, eksekusi lokal)."
echo "    Tanpa API key untuk model FREE; OPENCODE_BIN menunjuk binary absolut."
echo "    Coba manual: opencode run -m opencode/muse-spark-1.3-contributor-free \"hi\""
echo "    (bila menuntut login: opencode auth login)."
echo "    Pengecualian: pi agent-driver (MODEL_ROUTES maic-agent-driver) memanggil"
echo "    HTTP + function tools — untuk runtime agen isi OPENCODE_API_KEY dan"
echo "    pakai model berbayar (mis. opencode:deepseek-v4-flash)."
echo "  - Agent runtime + workbench butuh Postgres ${PG_MAJOR} + MODEL_ROUTES maic-agent-driver."
echo "  - Video MP4 butuh: docker compose --profile video-export up (berat: Chromium+FFmpeg)."
echo "  - e2e: pnpm exec playwright install --with-deps chromium && pnpm test:e2e"
echo "  - Install ulang aman (idempoten): password Postgres dipakai ulang dari .env.local,"
echo "    kecuali dipaksa via --pg-password/PG_PASSWORD."
