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
#      ffmpeg (ffprobe ikut di paket ffmpeg), PostgreSQL, git, curl, openssl.
#   2. Node.js 24 (>= 24.21, sesuai `engines` di package.json) via NodeSource.
#   3. pnpm 12.6.0 via corepack (sesuai `packageManager` di package.json).
#   4. PostgreSQL: database + user `openmaic` + password acak.
#   5. File `.env.local` (dibuat dari template bila belum ada; bila sudah ada
#      hanya dilengkapi variabel yang hilang — tidak menimpa isi user).
#   6. Direktori `data/` untuk classroom store berbasis file.
#   7. Dependensi JS via `pnpm install --frozen-lockfile`
#      (postinstall otomatis build workspace packages + sync vendor importer).
#   8. Verifikasi: vendor bundle PPTX + kontrak Node engine.
#
# Cara pakai:
#   sudo ./install.sh [opsi]
#
# Opsi:
#   --yes               Non-interaktif (tanpa konfirmasi).
#   --no-postgres       Lewati instalasi & setup PostgreSQL
#                       (agent runtime + persistence tetap nonaktif).
#   --no-install        Lewati `pnpm install` (hanya siapkan sistem + env).
#   --build             Jalankan `npm run build` di akhir sebagai pembuktian.
#   --with-playwright   Instal browser Chromium untuk e2e Playwright.
#   --with-ollama       Instal Ollama (LLM lokal default di .env.local)
#                       + pull model llama3.3.
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
WITH_OLLAMA=0
PG_PASSWORD="${PG_PASSWORD:-}"

for arg in "$@"; do
  case "$arg" in
    --yes)             ASSUME_YES=1 ;;
    --no-postgres)     WITH_POSTGRES=0 ;;
    --no-install)      WITH_INSTALL=0 ;;
    --build)           WITH_BUILD=1 ;;
    --with-playwright) WITH_PLAYWRIGHT=1 ;;
    --with-ollama)     WITH_OLLAMA=1 ;;
    --pg-password=*)   PG_PASSWORD="${arg#*=}" ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      echo "Contoh:"
      echo "  sudo ./install.sh --yes"
      echo "  sudo ./install.sh --yes --build --with-ollama"
      echo "  sudo ./install.sh --yes --no-postgres   # tanpa Postgres (fitur agent/persistence mati)"
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

# ------------------------------------------------------- deteksi distro (apt)
if ! command -v apt-get >/dev/null 2>&1; then
  fail "Script ini untuk Ubuntu/Debian (butuh apt-get). Di distro lain, samakan manual: Node 24 + pnpm 12.6 + Postgres + paket build di Dockerfile."
fi

# ---------------------------------------------------------------- konfirmasi
if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo "Installer OpenMAIC akan:"
  echo "  - apt install: build tools, cairo/pango, ffmpeg, git, curl, openssl$( [[ "$WITH_POSTGRES" -eq 1 ]] && echo ", postgresql" )"
  echo "  - instal Node.js 24 (bila belum memenuhi syarat) + pnpm 12.6.0"
  echo "  - setup database Postgres 'openmaic' (bila --no-postgres tidak dipakai)"
  echo "  - buat/lengkapi .env.local, direktori data/, pnpm install$( [[ "$WITH_BUILD" -eq 1 ]] && echo ", npm run build" )"
  read -rp "Lanjut? [y/N] " jawab
  [[ "$jawab" =~ ^[yY]$ ]] || { info "Dibatalkan."; exit 0; }
fi

# ============================================================ 1. Paket sistem
info "Menginstal paket sistem via apt..."
$SUDO apt-get update -y
APT_PKGS=(
  ca-certificates curl gnupg git openssl
  python3 build-essential g++ pkg-config
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  ffmpeg
)
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  APT_PKGS+=(postgresql postgresql-contrib)
fi
$SUDO apt-get install -y "${APT_PKGS[@]}"

# ============================================================ 2. Node.js >= 24
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_V="$(node -v | sed 's/^v//')"
  NODE_MAJOR="${NODE_V%%.*}"
  if [[ "$NODE_MAJOR" -ge 24 ]]; then
    info "Node.js $NODE_V sudah memenuhi syarat (>= 24). Lewati instalasi Node."
    NEED_NODE=0
  else
    warn "Node.js $NODE_V terlalu tua (butuh >= 24.21). Akan upgrade ke Node 24."
  fi
fi

if [[ "$NEED_NODE" -eq 1 ]]; then
  info "Menginstal Node.js 24 via NodeSource..."
  # NodeSource setup (resmi): menambah repo nodesource untuk major 24.
  curl -fsSL https://deb.nodesource.com/setup_24.x | $SUDO -E bash -
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

# ============================================================ 4. PostgreSQL
DATABASE_URL_VALUE=""
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  info "Menyiapkan PostgreSQL..."

  # Nyalakan service (tahan terhadap lingkungan tanpa systemd).
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    $SUDO systemctl enable --now postgresql || warn "systemctl postgresql gagal; lanjutkan, cek manual."
  elif command -v service >/dev/null 2>&1; then
    $SUDO service postgresql start || warn "'service postgresql start' gagal; lanjutkan, cek manual."
  else
    $SUDO pg_ctlcluster "$(ls /etc/postgresql 2>/dev/null | head -1)" main start \
      || warn "pg_ctlcluster gagal; lanjutkan, cek manual."
  fi
  pg_isready -h localhost -p 5432 >/dev/null 2>&1 \
    || warn "Postgres belum merespons di localhost:5432 (pg_isready gagal). Setup role/DB mungkin perlu dijalankan manual."

  # Password: paksa via --pg-password / env PG_PASSWORD, atau dibuat acak (aman URL: hex).
  if [[ -z "$PG_PASSWORD" ]]; then
    PG_PASSWORD="$(openssl rand -hex 16)"
    PG_PASSWORD_GENERATED=1
  else
    PG_PASSWORD_GENERATED=0
  fi

  # Buat role + database bila belum ada (idempoten).
  if $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='openmaic'" | grep -q 1; then
    info "Role Postgres 'openmaic' sudah ada."
  else
    $SUDO -u postgres psql -c "CREATE ROLE openmaic LOGIN PASSWORD '${PG_PASSWORD}'"
    info "Role Postgres 'openmaic' dibuat."
  fi
  # Selaraskan password bila role sudah ada dan password dibuat/dipaksa di run ini.
  $SUDO -u postgres psql -c "ALTER ROLE openmaic LOGIN PASSWORD '${PG_PASSWORD}'"
  if $SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='openmaic'" | grep -q 1; then
    info "Database 'openmaic' sudah ada."
  else
    $SUDO -u postgres createdb -O openmaic openmaic
    info "Database 'openmaic' dibuat."
  fi
  $SUDO -u postgres psql -d openmaic -c "GRANT ALL PRIVILEGES ON SCHEMA public TO openmaic;" >/dev/null

  DATABASE_URL_VALUE="postgres://openmaic:${PG_PASSWORD}@localhost:5432/openmaic"
  if [[ "${PG_PASSWORD_GENERATED:-0}" -eq 1 ]]; then
    info "Password Postgres dibuat acak dan disimpan di .env.local (DATABASE_URL)."
  fi
else
  info "Lewati PostgreSQL (--no-postgres): agent runtime + persistence tetap nonaktif."
fi

# ============================================================ 5. .env.local
# Template dev yang sudah terbukti jalan (provider `ollama` keyless & terdaftar
# di lib/ai/providers.ts; tanpa API key). Nilai rahasia dibuat acak per server.
ACCESS_CODE_NEW="$(openssl rand -hex 24)"      # 48 char, di atas minimum 16
DEV_TOKEN_NEW="$(openssl rand -hex 16)"

tulis_template_env() {
  local db_url="$1" access_code="$2" dev_token="$3" agent_runtime="$4"
  cat <<EOF
# =============================================================================
# OpenMAIC dev/prod lokal — dibuat oleh install.sh pada $(date -u +%Y-%m-%d)
# LLM default: Ollama lokal (keyless, provider terdaftar di lib/ai/providers.ts).
# Pastikan \`ollama serve\` jalan di http://localhost:11434, atau instal via:
#   ./install.sh --with-ollama   (atau isi API key provider di bawah / server-providers.yml)
# Dokumentasi semua variabel: lihat .env.example
# =============================================================================

# --- LLM default (tanpa API key, keyless lokal) --------------------------------
# Harus \`provider:model\` dengan provider terdaftar; tanpa ini resolveModel throw.
DEFAULT_MODEL=ollama:llama3.3
# Route eksplisit maic-agent-driver (wajib + \`api\` saat agent runtime aktif).
MODEL_ROUTES='{"maic-agent-driver":{"model":"ollama:llama3.3","api":"openai-completions"}}'

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

# --- Local/self-hosted: izinkan Ollama & layanan lokal -------------------------
ALLOW_LOCAL_NETWORKS=true
OLLAMA_BASE_URL=http://localhost:11434/v1

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
    tulis_template_env "$DATABASE_URL_VALUE" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "true" > .env.local
  else
    tulis_template_env "" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "false" > .env.local
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
  pastikan_var_env .env.local DEFAULT_MODEL "ollama:llama3.3"
  pastikan_var_env .env.local MODEL_ROUTES '{"maic-agent-driver":{"model":"ollama:llama3.3","api":"openai-completions"}}'
  pastikan_var_env .env.local ACCESS_CODE "$ACCESS_CODE_NEW"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    pastikan_var_env .env.local DATABASE_URL "$DATABASE_URL_VALUE"
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
if [[ "$WITH_OLLAMA" -eq 1 ]]; then
  info "Menginstal Ollama..."
  curl -fsSL https://ollama.com/install.sh | $SUDO bash -
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    $SUDO systemctl enable --now ollama || warn "systemctl ollama gagal; jalankan manual: ollama serve"
  else
    warn "Tanpa systemd: jalankan manual di sesi terpisah: ollama serve"
  fi
  info "Menarik model llama3.3 (bisa lama, tergantung jaringan)..."
  ollama pull llama3.3 || warn "ollama pull llama3.3 gagal; jalankan manual nanti."
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
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  pg_isready -h localhost -p 5432 && info "Postgres: OK" || warn "Postgres tidak merespons — cek: sudo systemctl status postgresql"
fi
[[ -f public/vendor/maic-importer/index.js ]] \
  && info "Vendor PPTX: OK (public/vendor/maic-importer/index.js)" \
  || warn "Vendor PPTX hilang — jalankan: pnpm --filter @openmaic/importer build && pnpm run sync:maic-importer"
echo ""
echo "Langkah berikutnya:"
echo "  cd $ROOT_DIR"
echo "  npm run dev     # pengembangan  -> http://localhost:3000"
echo "  npm run build   # build produksi"
echo "  npm run start   # jalankan hasil build -> http://localhost:3000"
echo ""
echo "Catatan:"
echo "  - .env.local berisi secret (600). Jangan commit (sudah di .gitignore)."
echo "  - Nilai NEXT_PUBLIC_* dibaca saat build: ubah nilainya lalu build ulang."
echo "  - Agent runtime + workbench butuh Postgres + MODEL_ROUTES maic-agent-driver."
echo "  - Video MP4 butuh: docker compose --profile video-export up (berat: Chromium+FFmpeg)."
echo "  - e2e: pnpm exec playwright install --with-deps chromium && pnpm test:e2e"
