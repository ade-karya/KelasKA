#!/usr/bin/env bash
#
# install.sh — Installer server fresh OpenMAIC dengan runtime Bun (Ubuntu/Debian).
#
# Versi ini menggantikan installer Node/pnpm lama. Salinan installer lama
# tersedia sebagai install-node.sh bila masih dibutuhkan.
#
# Yang disiapkan:
#   1. Paket sistem (apt): git, curl, unzip, build tools, header cairo/pango
#      untuk modul native, dan ffmpeg (bisa dilewati).
#   2. Bun di /usr/local/bin/bun (versi minimum 1.3.14; bisa dipin via
#      --bun-version=X). Node.js dan pnpm TIDAK diinstal.
#   3. PostgreSQL (default: otomatis) dari repo resmi PGDG: bila DATABASE_URL
#      belum ada di .env.local/environment, installer memasang PostgreSQL,
#      membuat database + user `openmaic`, dan menulis DATABASE_URL. Aplikasi
#      versi ini menolak start tanpa database. Lewati dengan --no-postgres bila
#      Anda memakai database eksternal (Supabase/Neon/dll.).
#   4. `.env.local` dasar: dibuat dari `.env.example` bila belum ada, lalu
#      dilengkapi ACCESS_CODE, OPENMAIC_SECRET_KEY, flag TTS browser-native,
#      ALLOW_LOCAL_NETWORKS, dan setelan persistence bila DATABASE_URL ada.
#      Nilai yang sudah diisi user tidak ditimpa (kecuali flag installer).
#   4b. `openmaic.yml` (model/provider/slot) dibuat dari DEFAULT_MODEL bila
#      providernya jelas; secret tetap di .env.local dan dirujuk ${VAR}.
#      File yang sudah ada tidak pernah ditimpa (lewati: --no-openmaic-yml).
#   5. Dependensi JS via `bun install`. Installer menambahkan `workspaces`
#      (dari pnpm-workspace.yaml) dan `trustedDependencies` ke package.json
#      agar monorepo + modul native bekerja di Bun, lalu menulis bun.lock.
#   6. Verifikasi vendor PPTX + kontrak engine, opsional build produksi,
#      opsional browser Playwright, dan opsional PM2.
#   7. PM2 (--with-pm2) dijalankan dengan Bun (tanpa Node). Aplikasi memakai
#      ecosystem.bun.config.cjs -> server standalone Next.js di Bun.
#
# Cara pakai:
#   sudo ./install.sh [opsi]
#
# Opsi:
#   --yes                 Non-interaktif (tanpa konfirmasi).
#   --with-postgres       Paksa instal & setup PostgreSQL lokal dari PGDG.
#   --no-postgres         Lewati PostgreSQL (pakai database eksternal).
#                         Default: otomatis — pasang lokal bila DATABASE_URL
#                         belum ada di .env.local / environment.
#   --pg-major=N          Mayor PostgreSQL (default: 18).
#   --pg-password=PASS    Paksa password Postgres (default: acak/idempoten).
#   --no-install          Lewati `bun install` (hanya sistem + env).
#   --no-openmaic-yml     Jangan buat openmaic.yml; konfigurasi model tetap
#                         legacy (DEFAULT_MODEL/MODEL_ROUTES + Settings).
#   --with-openmaic-yml   Paksa pembuatan openmaic.yml (default: otomatis bila
#                         DEFAULT_MODEL berbentuk provider:model dan providernya
#                         punya key/transport yang jelas).
#   --build               Jalankan `bun --bun run build` di akhir.
#   --with-pm2            Instal PM2 (via Bun) + build + jalankan aplikasi.
#   --with-playwright     Instal browser Chromium untuk e2e Playwright.
#   --full                Setara --build --with-playwright.
#   --fast                Build cepat untuk Colab/demo: lewati typecheck
#                         Next.js dan minifikasi artefak importer yang tidak
#                         dipakai browser. Build rilis normal tetap memeriksa
#                         tipe (pakai --no-fast untuk memaksa).
#   --no-fast             Paksa build penuh walau memakai preset --colab.
#   --colab               Preset Colab/ephemeral: --yes --with-pm2 --fast,
#                         tanpa Playwright; PostgreSQL mengikuti mode otomatis
#                         (bisa dioverride flag lain).
#   --dev                 Preset pengembangan: --yes, tanpa build produksi dan
#                         tanpa PM2, lalu menjalankan `bun --bun run dev` di
#                         latar belakang (log: data/dev-server.log, PID:
#                         data/dev-server.pid). Port dari PORT di .env.local
#                         (default 3000). Butuh Chromium e2e? Tambahkan
#                         --with-playwright.
#   --no-start            Jangan jalankan dev server otomatis (hanya relevan
#                         dengan --dev).
#   --with-ffmpeg         Instal ffmpeg (default ON; no-op).
#   --no-ffmpeg           Lewati ffmpeg (ekstraksi media lokal mati).
#   --with-browser-tts    TTS browser-native ON (default ON; no-op).
#   --no-browser-tts      TTS browser-native OFF (butuh provider TTS ber-key).
#   --bun-version=X       Pin versi Bun, mis. --bun-version=1.4.4.
#   --min-bun-version=X   Ubah versi minimum Bun (default: 1.3.14).
#   --no-model-refresh    Jangan segarkan OPENCODE_MODELS/CODEX_MODELS dari
#                         CLI lokal; daftar di .env.local dibiarkan apa adanya.
#   --no-antigravity      Lewati Google Antigravity SDK (venv .venv-antigravity
#                         + `pip install google-antigravity`).
#   --with-antigravity    Paksa instalasi Antigravity SDK (default ON).
#   -h, --help            Tampilkan bantuan ini.
#
# Catatan:
#   - Idempoten: aman dijalankan ulang. Password Postgres dipakai ulang dari
#     .env.local; .env.local yang ada hanya dilengkapi, bukan ditimpa.
#   - `bun install` memang menulis `workspaces` ke package.json dan membuat
#     bun.lock. Itu bagian dari migrasi workspace pnpm -> Bun dan aman
#     di-commit.
#   - Installer ini memisahkan konfigurasi: secret + runtime di .env.local,
#     provider/model/slot di openmaic.yml. Bila DEFAULT_MODEL sudah ada dan
#     providernya jelas (CLI tanpa key, atau key <PREFIX>_API_KEY tersedia),
#     installer membuat openmaic.yml lalu mengomentari DEFAULT_MODEL agar
#     tidak ada dua sumber kebenaran. File openmaic.yml milik user tidak
#     pernah ditimpa; blok models: milik installer disegarkan. Pakai
#     --no-openmaic-yml untuk tetap legacy.
#   - Setiap run menyegarkan katalog model dari CLI lokal: `opencode models`
#     mengisi OPENCODE_MODELS/OPENCODE_GO_MODELS, `codex app-server` mengisi
#     CODEX_MODELS, lalu blok models: di openmaic.yml (milik installer)
#     diperbarui. Discovery gagal/offline -> daftar lama dipertahankan.
#   - pgAdmin4 tidak termasuk di installer Bun ini; gunakan install-node.sh
#     bila membutuhkannya. OpenCode CLI juga tidak termasuk (install-node.sh).
#   - Codex CLI (@openai/codex) kini termasuk sebagai dependency dan akan
#     terpasang via `bun install`; autentikasinya (API key / device code)
#     dilakukan dari UI Pro Workbench (ikon kunci di header chat pane), bukan
#     dari terminal.
#   - Google Antigravity SDK dipasang ke venv lokal .venv-antigravity
#     (`pip install google-antigravity`) dan dipakai sebagai transport
#     antigravity-sdk. Autentikasi lewat GEMINI_API_KEY / GOOGLE_API_KEY atau
#     Vertex AI (GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT/LOCATION) di
#     .env.local. Lewati dengan --no-antigravity.

set -euo pipefail

# Debian-family installer (postgresql-common, tzdata, Playwright --with-deps)
# memicu debconf yang menggantung di server tanpa TTY.
export DEBIAN_FRONTEND=noninteractive
export NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- warna & log
if [[ -t 1 ]]; then
  HIJAU='\033[0;32m'; KUNING='\033[0;33m'; MERAH='\033[0;31m'; RESET='\033[0m'
else
  HIJAU=''; KUNING=''; MERAH=''; RESET=''
fi
info()  { echo -e "${HIJAU}[install]${RESET} $*"; }
warn()  { echo -e "${KUNING}[install] peringatan:${RESET} $*" >&2; }
fail()  { FAILED_BY_FAIL=1; echo -e "${MERAH}[install] GAGAL:${RESET} $*" >&2; exit 1; }

LANGKAH="startup"
FAILED_BY_FAIL=0
on_exit() {
  local rc=$?
  [[ "$rc" -eq 0 || "$rc" -eq 141 ]] && return 0
  if [[ "$FAILED_BY_FAIL" -eq 0 ]]; then
    echo -e "${MERAH}[install] GAGAL:${RESET} berhenti di langkah '${LANGKAH}' (exit ${rc})." >&2
    echo "  Perbaiki pesan di atas lalu jalankan ulang: sudo ./install.sh --yes" >&2
  fi
}
trap on_exit EXIT

# ------------------------------------------------- direktori repo (root proyek)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
[[ -f package.json ]] \
  || fail "install.sh harus dijalankan dari root repo OpenMAIC (package.json tidak ada di $ROOT_DIR)."

# ------------------------------------------------------------------ opsi CLI
ASSUME_YES=0
WITH_POSTGRES=auto
WITH_INSTALL=1
WITH_OPENMAIC_YML=1
WITH_MODEL_REFRESH=1
WITH_ANTIGRAVITY=1
WITH_BUILD=0
WITH_PLAYWRIGHT=0
WITH_PM2=0
WITH_COLAB=0
WITH_DEV=0
WITH_DEV_START=1
FAST_BUILD="auto"
WITH_FFMPEG=1
WITH_BROWSER_TTS=1
PG_MAJOR="${PG_MAJOR:-18}"
PG_PASSWORD="${PG_PASSWORD:-}"
BUN_VERSION="${BUN_VERSION:-}"
BUN_MIN_VERSION="${BUN_MIN_VERSION:-1.3.14}"
BUN_INSTALL_PREFIX="/usr/local"
BUN_BIN="$BUN_INSTALL_PREFIX/bin/bun"

tampilkan_help() {
  awk 'NR>1 { if ($0 ~ /^[[:space:]]*$/) exit; sub(/^# ?/, ""); print }' "$0"
  cat <<'EOF'
Contoh:
  sudo ./install.sh --yes
  sudo ./install.sh --yes --with-postgres
  sudo ./install.sh --yes --build
  sudo ./install.sh --yes --with-pm2
  sudo ./install.sh --with-postgres --with-pm2 --yes
  sudo ./install.sh --colab
  sudo ./install.sh --colab --no-fast
  sudo ./install.sh --dev
  sudo ./install.sh --dev --no-start
  sudo ./install.sh --yes --full
  sudo ./install.sh --yes --no-ffmpeg
  sudo ./install.sh --yes --no-browser-tts
  sudo ./install.sh --yes --bun-version=1.4.4
EOF
}

for arg in "$@"; do
  case "$arg" in
    --yes)               ASSUME_YES=1 ;;
    --with-postgres)     WITH_POSTGRES=1 ;;
    --no-postgres)       WITH_POSTGRES=0 ;;
    --no-install)        WITH_INSTALL=0 ;;
    --no-openmaic-yml)   WITH_OPENMAIC_YML=0 ;;
    --with-openmaic-yml) WITH_OPENMAIC_YML=1 ;;
    --no-model-refresh)  WITH_MODEL_REFRESH=0 ;;
    --no-antigravity)    WITH_ANTIGRAVITY=0 ;;
    --with-antigravity)  WITH_ANTIGRAVITY=1 ;;
    --build)             WITH_BUILD=1 ;;
    --with-pm2)          WITH_PM2=1 ;;
    --with-playwright)   WITH_PLAYWRIGHT=1 ;;
    --full|--with-dev-tools) WITH_BUILD=1; WITH_PLAYWRIGHT=1 ;;
    --fast)              FAST_BUILD=1 ;;
    --no-fast)           FAST_BUILD=0 ;;
    --colab)             WITH_COLAB=1; ASSUME_YES=1; WITH_PM2=1; WITH_PLAYWRIGHT=0 ;;
    --dev)               WITH_DEV=1; ASSUME_YES=1 ;;
    --no-start)          WITH_DEV_START=0 ;;
    --with-ffmpeg)       WITH_FFMPEG=1 ;;
    --no-ffmpeg)         WITH_FFMPEG=0 ;;
    --with-browser-tts)  WITH_BROWSER_TTS=1 ;;
    --no-browser-tts)    WITH_BROWSER_TTS=0 ;;
    --bun-version=*)     BUN_VERSION="${arg#*=}" ;;
    --min-bun-version=*) BUN_MIN_VERSION="${arg#*=}" ;;
    --pg-major=*)        PG_MAJOR="${arg#*=}" ;;
    --pg-password=*)     PG_PASSWORD="${arg#*=}" ;;
    --with-pgadmin)
      fail "pgAdmin4 tidak didukung installer Bun ini. Gunakan ./install-node.sh --with-pgadmin." ;;
    --no-pgadmin)
      info "pgAdmin4 tidak termasuk installer Bun ini — dilewati." ;;
    --with-opencode)
      fail "OpenCode CLI tidak diinstal oleh installer Bun ini. Gunakan ./install-node.sh bila membutuhkannya." ;;
    --no-opencode)
      info "OpenCode CLI tidak termasuk installer Bun ini — dilewati." ;;
    --no-upstream|--with-upstream|--upstream-url=*)
      info "Remote git upstream tidak diatur installer Bun ini — dilewati." ;;
    --with-ollama)
      fail "Opsi --with-ollama sudah dihapus. Hapus flag tersebut dan ulangi." ;;
    -h|--help)           tampilkan_help; exit 0 ;;
    *) fail "Opsi tidak dikenal: $arg (lihat --help)." ;;
  esac
done
[[ "$PG_MAJOR" =~ ^[0-9]+$ ]] || fail "--pg-major harus angka (contoh: --pg-major=18)."
[[ -z "$BUN_VERSION" || "$BUN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "--bun-version harus semver 3 angka (contoh: --bun-version=1.4.4)."
[[ "$BUN_MIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || fail "--min-bun-version harus semver 3 angka (contoh: --min-bun-version=1.3.14)."

# --colab mengaktifkan mode cepat secara default; --fast/--no-fast menang
# terlepas dari urutan argumen.
if [[ "$FAST_BUILD" == "auto" ]]; then
  if [[ "$WITH_COLAB" -eq 1 ]]; then FAST_BUILD=1; else FAST_BUILD=0; fi
fi
# Env build yang dipakai `bun install` (postinstall membangun packages) dan
# `bun run build`; selalu diteruskan eksplisit lewat `env` karena langkah berat
# dijalankan sebagai OWNER_USER (sudo/runuser tidak menjamin env ikut).
BUILD_ENV=()
if [[ "$FAST_BUILD" -eq 1 ]]; then
  BUILD_ENV+=(OPENMAIC_FAST_MINIFY=1 OPENMAIC_SKIP_TYPECHECK=1)
  info "Mode build cepat: typecheck Next.js dilewati; minifikasi UMD/CJS importer dilewati."
fi

# --dev dan PM2 sama-sama menjalankan server di PORT yang sama; jalankan salah
# satu agar tidak ada dua proses berebut port.
if [[ "$WITH_DEV" -eq 1 && "$WITH_PM2" -eq 1 ]]; then
  if [[ "$WITH_COLAB" -eq 1 ]]; then
    WITH_PM2=0
    info "Mode dev + Colab: PM2 dilewati, dev server yang dijalankan."
  else
    fail "--dev tidak bisa digabung dengan --with-pm2 (dua server di port yang sama). Pilih salah satu."
  fi
fi
if [[ "$WITH_DEV" -eq 1 && "$WITH_BUILD" -eq 1 ]]; then
  info "Mode dev: --build tetap dijalankan, tetapi dev server memakai next dev (build tidak wajib)."
fi

# Penanda waktu antar-langkah khusus --colab (best-effort, agar bottleneck
# terlihat di log; no-op bila bukan colab agar log server tetap bersih).
if [[ "$WITH_COLAB" -eq 1 ]]; then
  COLAB_T0="$(date +%s)"
  colab_mark() { local _now; _now="$(date +%s)"; info "waktu +$((_now - COLAB_T0))s: $*"; }
else
  colab_mark() { :; }
fi
# Default Postgres: otomatis. Aplikasi menolak start tanpa DATABASE_URL, jadi
# pasang lokal hanya bila belum ada URL (file atau environment).
if [[ "$WITH_POSTGRES" == "auto" ]]; then
  if [[ -n "${DATABASE_URL:-}" ]] \
    || { [[ -f .env.local ]] && grep -qE '^[[:space:]]*DATABASE_URL=[^[:space:]#]+' .env.local; }; then
    WITH_POSTGRES=0
    info "DATABASE_URL sudah ada — lewati PostgreSQL lokal (paksa dengan --with-postgres)."
  else
    WITH_POSTGRES=1
    info "DATABASE_URL belum ada — PostgreSQL lokal akan disiapkan (lewati dengan --no-postgres)."
  fi
fi

# ---------------------------------------------------------------- sudo / root
if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "Jalankan sebagai root atau instal sudo dulu."
  SUDO="sudo"
fi

run_as_root() {
  if [[ -n "${SUDO:-}" ]]; then
    $SUDO "$@"
    return
  fi
  # Sudah root: kupas flag gaya sudo di depan agar `-E`/`-H`/`-u` tidak
  # dieksekusi sebagai perintah.
  local want_home=0 target=""
  while [[ $# -gt 0 ]]; do
    case "${1:-}" in
      -E) shift ;;
      -H) want_home=1; shift ;;
      -u) target="${2:-}"; shift 2 ;;
      *) break ;;
    esac
  done
  if [[ -z "$target" || "$(id -un)" == "$target" ]]; then
    "$@"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    if [[ "$want_home" -eq 1 ]]; then sudo -H -u "$target" "$@"; else sudo -u "$target" "$@"; fi
    return
  fi
  local thome=""
  if [[ "$want_home" -eq 1 ]]; then
    thome="$(getent passwd "$target" 2>/dev/null | cut -d: -f6 || true)"
    [[ -n "$thome" ]] || thome="/home/$target"
  fi
  if command -v runuser >/dev/null 2>&1; then
    if [[ -n "$thome" ]]; then runuser -u "$target" -- env "HOME=$thome" "$@"; else runuser -u "$target" -- "$@"; fi
    return
  fi
  local q="" a
  if [[ -n "$thome" ]]; then q="export HOME=$(printf '%q' "$thome");"; fi
  for a in "$@"; do q="$q $(printf '%q' "$a")"; done
  su "$target" -c "$q"
}

OWNER_USER="${SUDO_USER:-$(id -un)}"
if ! id -u "$OWNER_USER" >/dev/null 2>&1; then OWNER_USER="$(id -un)"; fi
OWNER_HOME="$(getent passwd "$OWNER_USER" 2>/dev/null | cut -d: -f6 || true)"
[[ -n "$OWNER_HOME" ]] || OWNER_HOME="${HOME:-/root}"

as_owner() {
  if [[ "$(id -un)" == "$OWNER_USER" ]]; then
    "$@"
  else
    run_as_root -H -u "$OWNER_USER" "$@"
  fi
}

pg_as_postgres() {
  if [[ -n "${SUDO:-}" ]]; then
    $SUDO -u postgres "$@"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- "$@"
  else
    local q="" a
    for a in "$@"; do q="$q $(printf '%q' "$a")"; done
    su postgres -c "$q"
  fi
}

# ---------------------------------------------------------------- util kecil
env_get() {
  local file="$1" key="$2" line=""
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -1 || true)"
  line="${line#*=}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  if [[ "$line" == \"*\" || "$line" == \'*\' ]]; then line="${line:1:${#line}-2}"; fi
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

# Isi variabel hanya bila belum ada. Baris aktif kosong ikut diisi; nilai
# non-kosong milik user tidak pernah ditimpa.
pastikan_var_env() {
  local file="$1" key="$2" value="$3" escaped current
  [[ -f "$file" ]] || touch "$file"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    if [[ -n "$value" ]]; then
      current="$(env_get "$file" "$key")"
      if [[ -z "$current" ]]; then
        escaped="$(sed_escape_replacement "$value")"
        sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
      fi
    fi
    return 0
  fi
  if [[ -n "$value" ]] && grep -qE "^[[:space:]]*#[[:space:]]*${key}=" "$file"; then
    escaped="$(sed_escape_replacement "$value")"
    # Hanya placeholder komentar PERTAMA yang diaktifkan; .env.example bisa
    # memuat beberapa contoh DATABASE_URL dan semuanya tidak boleh aktif.
    sed -i -E "0,/^[[:space:]]*#[[:space:]]*${key}=/s|^[[:space:]]*#[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# Paksa nilai (dipakai untuk flag installer seperti TTS browser-native).
set_env_value() {
  local file="$1" key="$2" value="$3" escaped
  [[ -f "$file" ]] || touch "$file"
  escaped="$(sed_escape_replacement "$value")"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  elif grep -qE "^[[:space:]]*#[[:space:]]*${key}=" "$file"; then
    # Aktifkan hanya placeholder pertama (mis. dua contoh DATABASE_URL).
    sed -i -E "0,/^[[:space:]]*#[[:space:]]*${key}=/s|^[[:space:]]*#[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

version_gte() {
  local have="$1" want="$2" h1 h2 h3 w1 w2 w3
  IFS=. read -r h1 h2 h3 <<<"${have%%[^0-9.]*}"
  IFS=. read -r w1 w2 w3 <<<"$want"
  h1="${h1//[^0-9]/}"; h2="${h2//[^0-9]/}"; h3="${h3//[^0-9]/}"
  w1="${w1//[^0-9]/}"; w2="${w2//[^0-9]/}"; w3="${w3//[^0-9]/}"
  h1=${h1:-0}; h2=${h2:-0}; h3=${h3:-0}
  w1=${w1:-0}; w2=${w2:-0}; w3=${w3:-0}
  if [[ "$h1" -gt "$w1" ]]; then return 0; fi
  if [[ "$h1" -lt "$w1" ]]; then return 1; fi
  if [[ "$h2" -gt "$w2" ]]; then return 0; fi
  if [[ "$h2" -lt "$w2" ]]; then return 1; fi
  [[ "$h3" -ge "$w3" ]]
}

rand_hex() {
  "$BUN_BIN" -e 'process.stdout.write(require("node:crypto").randomBytes(Number(process.argv[1])).toString("hex"))' "$1"
}
url_encode() {
  "$BUN_BIN" -e 'process.stdout.write(encodeURIComponent(process.argv[1]).replace(/[!'"'"'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))' "$1"
}
url_decode() {
  "$BUN_BIN" -e 'process.stdout.write(decodeURIComponent(process.argv[1]))' "$1"
}

# ------------------------------------------------------- deteksi distro (apt)
if ! command -v apt-get >/dev/null 2>&1; then
  fail "Script ini untuk Ubuntu/Debian (butuh apt-get). Di distro lain, samakan manual: Bun >= ${BUN_MIN_VERSION} + paket build di Dockerfile."
fi

# ---------------------------------------------------------------- konfirmasi
if [[ "$ASSUME_YES" -ne 1 ]]; then
  echo "Installer OpenMAIC (runtime Bun) akan:"
  if [[ "$WITH_FFMPEG" -eq 1 ]]; then
    echo "  - apt install: build tools + cairo/pango, git, curl, unzip, ffmpeg"
  else
    echo "  - apt install: build tools + cairo/pango, git, curl, unzip"
  fi
  echo "  - instal Bun >= ${BUN_MIN_VERSION} ke ${BUN_INSTALL_PREFIX} (tanpa Node/pnpm)"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    echo "  - instal PostgreSQL ${PG_MAJOR} (PGDG) + database/user openmaic"
  else
    echo "  - tanpa PostgreSQL lokal (DATABASE_URL sudah ada / --no-postgres)"
  fi
  echo "  - siapkan .env.local + data/ + bun install (workspaces dimigrasikan)"
  if [[ "$WITH_ANTIGRAVITY" -eq 1 ]]; then
    echo "  - pasang Google Antigravity SDK di .venv-antigravity (pip)"
  else
    echo "  - tanpa Google Antigravity SDK (--no-antigravity)"
  fi
  if [[ "$WITH_PLAYWRIGHT" -eq 1 ]]; then echo "  - instal browser Chromium Playwright"; fi
  if [[ "$WITH_BUILD" -eq 1 ]]; then echo "  - jalankan build produksi Bun"; fi
  if [[ "$FAST_BUILD" -eq 1 ]]; then echo "  - mode cepat: typecheck Next.js + minifikasi UMD/CJS dilewati"; fi
  if [[ "$WITH_PM2" -eq 1 ]]; then echo "  - instal PM2 via Bun + jalankan aplikasi standalone"; fi
  if [[ "$WITH_COLAB" -eq 1 ]]; then echo "  - preset Colab: non-interaktif + PM2 (tanpa systemd)"; fi
  if [[ "$WITH_DEV" -eq 1 ]]; then
    if [[ "$WITH_DEV_START" -eq 1 ]]; then
      echo "  - preset dev: non-interaktif, tanpa build/PM2, dev server di latar belakang"
    else
      echo "  - preset dev: non-interaktif, tanpa build/PM2 (server tidak dijalankan)"
    fi
  fi
  [[ -t 0 ]] || fail "Tidak ada TTY untuk konfirmasi. Jalankan ulang dengan --yes."
  read -rp "Lanjut? [y/N] " jawab
  [[ "$jawab" =~ ^[yY]$ ]] || { info "Dibatalkan."; exit 0; }
fi

# ============================================================ 1. Paket sistem
LANGKAH="apt: paket sistem"
APT_PKGS=(
  ca-certificates curl git unzip
  python3 build-essential pkg-config
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev
)
if [[ "$WITH_POSTGRES" -eq 1 ]]; then APT_PKGS+=(gnupg); fi
# The Antigravity transport runs a Python SDK from a project-local venv.
if [[ "$WITH_ANTIGRAVITY" -eq 1 ]]; then APT_PKGS+=(python3-venv python3-pip python3.12-venv python3.13-venv); fi
# Colab/containers often ship an ffmpeg binary from a non-apt image; installing
# the distro package would only add a large download.
if [[ "$WITH_FFMPEG" -eq 1 ]] && ! command -v ffmpeg >/dev/null 2>&1; then
  APT_PKGS+=(ffmpeg)
fi

apt_semua_terpasang() {
  local p
  for p in "$@"; do
    dpkg -s "$p" >/dev/null 2>&1 || return 1
  done
  return 0
}

apt_update() {
  info "Memperbarui daftar paket (apt-get update)..."
  run_as_root apt-get update -o Acquire::Retries=3
}

apt_install() {
  run_as_root env DEBIAN_FRONTEND=noninteractive \
    apt-get install -y --no-install-recommends -o Acquire::Retries=3 "$@"
}

if apt_semua_terpasang "${APT_PKGS[@]}"; then
  info "Paket sistem sudah lengkap — lewati apt-get update/install."
  APT_PERLU_UPDATE=0
else
  # Lewati apt-get update bila cache lists masih segar (<24 jam) — penghemat
  # terbesar di run ulang Colab (install-node.sh pola yang sama).
  APT_PERLU_UPDATE=1
  if [[ -d /var/lib/apt/lists ]] \
    && [[ -n "$(find /var/lib/apt/lists -maxdepth 1 -name '*InRelease' -mmin -1440 2>/dev/null)" ]]; then
    info "Cache apt masih segar (<24 jam) — lewati apt-get update."
    APT_PERLU_UPDATE=0
  fi
  if [[ "$APT_PERLU_UPDATE" -eq 1 ]]; then
    apt_update
  fi
  info "Menginstal paket sistem: ${APT_PKGS[*]}"
  if ! apt_install "${APT_PKGS[@]}"; then
    warn "Daftar paket lama/tidak lengkap — memperbarui apt lalu mencoba lagi."
    apt_update
    apt_install "${APT_PKGS[@]}" || fail "Instalasi paket sistem gagal."
  fi
fi
colab_mark "paket sistem selesai"

# PGDG hanya bila Postgres diminta.
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  LANGKAH="apt: repo PGDG"
  PGDG_LIST=/etc/apt/sources.list.d/pgdg.list
  PGDG_KEYRING=/usr/share/keyrings/postgresql.gpg
  pgdg_sudah_terdaftar=1
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*; do
    [[ -f "$f" ]] || continue
    if grep -qs "apt.postgresql.org" "$f"; then pgdg_sudah_terdaftar=0; break; fi
  done
  if [[ "$pgdg_sudah_terdaftar" -eq 0 ]]; then
    info "Repo PGDG sudah terdaftar — lewati penambahan."
  else
    info "Menambahkan repo PGDG (apt.postgresql.org)..."
    run_as_root install -d -m 0755 /usr/share/keyrings
    KEY_TMP="$(mktemp)"
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$KEY_TMP"
    run_as_root gpg --batch --yes --dearmor -o "$PGDG_KEYRING" "$KEY_TMP"
    rm -f "$KEY_TMP"
    run_as_root chmod 0644 "$PGDG_KEYRING"
    # shellcheck disable=SC1091
    CODENAME="$(. /etc/os-release 2>/dev/null && printf '%s' "${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}")"
    [[ -n "$CODENAME" ]] || fail "Tidak bisa membaca VERSION_CODENAME dari /etc/os-release."
    echo "deb [signed-by=$PGDG_KEYRING] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
      | run_as_root tee "$PGDG_LIST" >/dev/null
    apt_update
  fi
fi

# ============================================================ 2. Bun
LANGKAH="bun: instalasi"
export PATH="$BUN_INSTALL_PREFIX/bin:$PATH"

bun_siap=0
if [[ -x "$BUN_BIN" ]]; then
  BUN_TERPASANG="$("$BUN_BIN" --version 2>/dev/null || echo '?')"
  if [[ -n "$BUN_VERSION" ]]; then
    if [[ "$BUN_TERPASANG" == "$BUN_VERSION" ]]; then
      info "Bun ${BUN_TERPASANG} sudah terpasang (sesuai pin)."
      bun_siap=1
    else
      info "Bun ${BUN_TERPASANG} terpasang; pin meminta ${BUN_VERSION} — memasang ulang."
    fi
  elif version_gte "$BUN_TERPASANG" "$BUN_MIN_VERSION"; then
    info "Bun ${BUN_TERPASANG} sudah memenuhi syarat (>= ${BUN_MIN_VERSION})."
    bun_siap=1
  else
    info "Bun ${BUN_TERPASANG} terlalu tua (butuh >= ${BUN_MIN_VERSION}) — memperbarui."
  fi
fi

if [[ "$bun_siap" -ne 1 ]]; then
  info "Menginstal Bun ke ${BUN_INSTALL_PREFIX}..."
  BUN_INSTALLER="$(mktemp)"
  curl -fsSL https://bun.sh/install -o "$BUN_INSTALLER"
  if [[ -n "$BUN_VERSION" ]]; then
    run_as_root env BUN_INSTALL="$BUN_INSTALL_PREFIX" bash "$BUN_INSTALLER" "bun-v${BUN_VERSION}"
  else
    run_as_root env BUN_INSTALL="$BUN_INSTALL_PREFIX" bash "$BUN_INSTALLER"
  fi
  rm -f "$BUN_INSTALLER"
  hash -r 2>/dev/null || true
fi

[[ -x "$BUN_BIN" ]] || fail "Bun tidak ditemukan di ${BUN_BIN} setelah instalasi."
BUN_TERPASANG="$("$BUN_BIN" --version)"
version_gte "$BUN_TERPASANG" "$BUN_MIN_VERSION" \
  || fail "Bun ${BUN_TERPASANG} masih di bawah minimum ${BUN_MIN_VERSION}."
info "Bun ${BUN_TERPASANG} siap di ${BUN_BIN}."

# ============================================================ 3. PostgreSQL
LANGKAH="postgresql: layanan"
DATABASE_URL_VALUE=""
PGPORT=""
PG_PASSWORD_FORCED=0
PG_PASSWORD_GENERATED=0

if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  info "Menginstal PostgreSQL ${PG_MAJOR} dari PGDG..."
  if ! apt_install "postgresql-${PG_MAJOR}"; then
    apt_update
    apt_install "postgresql-${PG_MAJOR}" || fail "Instalasi PostgreSQL ${PG_MAJOR} gagal."
  fi

  PG_ONLINE="$(pg_lsclusters 2>/dev/null \
    | awk -v v="${PG_MAJOR}" '$1==v && $2=="main" && $4=="online" {print 1; exit}' || true)"
  if [[ "$PG_ONLINE" == "1" ]]; then
    info "Cluster PostgreSQL ${PG_MAJOR}/main sudah berjalan."
    if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
      run_as_root systemctl enable postgresql >/dev/null 2>&1 || true
    fi
  elif command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    run_as_root systemctl enable --now postgresql || warn "systemctl postgresql gagal; lanjutkan, cek manual."
  elif command -v service >/dev/null 2>&1; then
    run_as_root service postgresql start || warn "'service postgresql start' gagal; lanjutkan, cek manual."
  else
    run_as_root pg_ctlcluster "${PG_MAJOR}" main start || warn "pg_ctlcluster ${PG_MAJOR} main start gagal."
  fi

  if ! pg_lsclusters 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main" {found=1} END {exit !found}'; then
    info "Cluster ${PG_MAJOR}/main belum ada — membuat..."
    if run_as_root pg_createcluster "${PG_MAJOR}" main; then
      run_as_root pg_ctlcluster "${PG_MAJOR}" main start \
        || warn "pg_ctlcluster ${PG_MAJOR} main start gagal setelah createcluster."
    else
      warn "pg_createcluster ${PG_MAJOR} gagal; setup role/DB dilewati."
    fi
  fi

  PGPORT="$(pg_lsclusters 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main" {print $3}' | head -1 || true)"
  if [[ "$PGPORT" =~ ^[0-9]+$ ]]; then
    info "Cluster PostgreSQL ${PG_MAJOR}/main di port ${PGPORT}."
    PG_SIAP=0
    for _ in {1..30}; do
      if pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1; then PG_SIAP=1; break; fi
      sleep 1
    done
    if [[ "$PG_SIAP" -ne 1 ]]; then
      warn "Postgres belum merespons di localhost:${PGPORT} setelah 30 detik; role/DB mungkin perlu dibuat manual."
    fi
  else
    warn "Cluster ${PG_MAJOR}/main tidak ditemukan — lewati setup role/DB."
    PGPORT=""
  fi

  if [[ -n "$PGPORT" ]]; then
    if [[ -n "$PG_PASSWORD" ]]; then PG_PASSWORD_FORCED=1; fi
    if [[ "$PG_PASSWORD_FORCED" -eq 0 && -f .env.local ]]; then
      EXISTING_PG_PASS_RAW="$(env_get .env.local DATABASE_URL \
        | sed -E -n 's|^postgres(ql)?://openmaic:(.*)@.*|\2|p')"
      EXISTING_PG_PASS=""
      if [[ -n "$EXISTING_PG_PASS_RAW" ]]; then
        EXISTING_PG_PASS="$(url_decode "$EXISTING_PG_PASS_RAW" 2>/dev/null || printf '%s' "$EXISTING_PG_PASS_RAW")"
      fi
      if [[ -n "$EXISTING_PG_PASS" ]]; then
        PG_PASSWORD="$EXISTING_PG_PASS"
        info "Memakai ulang password Postgres dari .env.local (idempoten)."
      fi
    fi
    if [[ -z "$PG_PASSWORD" ]]; then
      PG_PASSWORD="$(rand_hex 16)"
      PG_PASSWORD_GENERATED=1
    fi
    PG_SQL_ESCAPED="${PG_PASSWORD//\'/\'\'}"
    PG_URL_ENCODED="$(url_encode "$PG_PASSWORD")"

    if pg_as_postgres psql -p "$PGPORT" -tAc "SELECT 1 FROM pg_roles WHERE rolname='openmaic'" | grep -qx 1; then
      info "Role Postgres 'openmaic' sudah ada."
    else
      pg_as_postgres psql -p "$PGPORT" -c "CREATE ROLE openmaic LOGIN PASSWORD '${PG_SQL_ESCAPED}'"
      info "Role Postgres 'openmaic' dibuat."
    fi
    if [[ "$PG_PASSWORD_FORCED" -eq 1 || "$PG_PASSWORD_GENERATED" -eq 1 ]]; then
      pg_as_postgres psql -p "$PGPORT" -c "ALTER ROLE openmaic LOGIN PASSWORD '${PG_SQL_ESCAPED}'"
    fi
    if pg_as_postgres psql -p "$PGPORT" -tAc "SELECT 1 FROM pg_database WHERE datname='openmaic'" | grep -qx 1; then
      info "Database 'openmaic' sudah ada."
    else
      pg_as_postgres createdb -p "$PGPORT" -O openmaic openmaic
      info "Database 'openmaic' dibuat."
    fi
    pg_as_postgres psql -p "$PGPORT" -d openmaic -c "GRANT ALL PRIVILEGES ON SCHEMA public TO openmaic;" >/dev/null \
      || warn "GRANT ON SCHEMA public gagal; cek manual sebagai postgres."

    DATABASE_URL_VALUE="postgres://openmaic:${PG_URL_ENCODED}@localhost:${PGPORT}/openmaic"
    info "DATABASE_URL lokal disiapkan (password ${PG_PASSWORD_GENERATED:+acak }tersimpan di .env.local)."
  fi
else
  info "Lewati PostgreSQL lokal (DATABASE_URL sudah ada atau --no-postgres)."
fi

# ============================================================ 4. .env.local
LANGKAH=".env.local"
if [[ -f .env.local && ! -s .env.local ]]; then
  warn ".env.local kosong (0 byte) — dibuat ulang dari template."
  rm -f .env.local
fi
rm -f .env.local.tmp.*
if [[ ! -f .env.local ]]; then
  if [[ -f .env.example ]]; then
    info "Membuat .env.local dari .env.example..."
    cp .env.example .env.local
  else
    info "Membuat .env.local baru..."
    {
      echo "# OpenMAIC local environment — dibuat oleh install.sh"
      echo "ACCESS_CODE="
      echo "OPENMAIC_SECRET_KEY="
    } > .env.local
  fi
fi

ACCESS_CODE_NEW="$(rand_hex 24)"
DEV_TOKEN_NEW="$(rand_hex 16)"

pastikan_instance_secret() {
  local file="${1:-.env.local}" cur="" adopsi="" kandidat=""
  cur="$(env_get "$file" OPENMAIC_SECRET_KEY)"
  if [[ -n "$cur" ]]; then return 0; fi
  if [[ -n "${OPENMAIC_SECRET_KEY:-}" ]]; then
    pastikan_var_env "$file" OPENMAIC_SECRET_KEY "$OPENMAIC_SECRET_KEY"
    info "OPENMAIC_SECRET_KEY diisi dari environment."
    return 0
  fi
  for kandidat in .next/standalone/data/instance-secret.key data/instance-secret.key; do
    if [[ -f "$kandidat" ]]; then
      adopsi="$(tr -d '[:space:]' < "$kandidat" 2>/dev/null || true)"
      if [[ "$adopsi" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
        pastikan_var_env "$file" OPENMAIC_SECRET_KEY "$adopsi"
        info "OPENMAIC_SECRET_KEY diadopsi dari ${kandidat}."
        return 0
      fi
    fi
  done
  adopsi="$(head -c 32 /dev/urandom 2>/dev/null | base64 | tr -d '\n' || true)"
  if [[ "$adopsi" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    pastikan_var_env "$file" OPENMAIC_SECRET_KEY "$adopsi"
    info "OPENMAIC_SECRET_KEY dibuat acak (jangan hapus; provider key di DB bergantung padanya)."
  else
    warn "Gagal membuat OPENMAIC_SECRET_KEY acak; isi manual 32 byte base64."
  fi
}
pastikan_instance_secret .env.local

if [[ -n "$DATABASE_URL_VALUE" ]]; then
  if [[ "$PG_PASSWORD_FORCED" -eq 1 ]]; then
    set_env_value .env.local DATABASE_URL "$DATABASE_URL_VALUE"
    info "DATABASE_URL disinkronkan dengan password yang dipaksa."
  else
    pastikan_var_env .env.local DATABASE_URL "$DATABASE_URL_VALUE"
  fi
fi
if [[ -z "$(env_get .env.local DATABASE_URL)" && -n "${DATABASE_URL:-}" ]]; then
  pastikan_var_env .env.local DATABASE_URL "$DATABASE_URL"
fi

pastikan_var_env .env.local ACCESS_CODE "$ACCESS_CODE_NEW"
pastikan_var_env .env.local ALLOW_LOCAL_NETWORKS "true"
pastikan_var_env .env.local PARALLEL_SCENE_CONCURRENCY "5"
if [[ "$WITH_BROWSER_TTS" -eq 1 ]]; then
  set_env_value .env.local TTS_BROWSER_NATIVE_ENABLED "true"
else
  set_env_value .env.local TTS_BROWSER_NATIVE_ENABLED "false"
fi

DB_URL_EFEKTIF="$(env_get .env.local DATABASE_URL)"
if [[ -n "$DB_URL_EFEKTIF" ]]; then
  SERVER_TOKEN="$(env_get .env.local PERSISTENCE_DEV_TOKEN)"
  if [[ -z "$SERVER_TOKEN" ]]; then
    # Bila token publik sudah ada, pakai nilainya juga di server: tidak perlu
    # build ulang dan client/server tetap cocok. Baru buat acak bila keduanya
    # belum ada.
    SERVER_TOKEN="$(env_get .env.local NEXT_PUBLIC_PERSISTENCE_TOKEN)"
    if [[ -n "$SERVER_TOKEN" ]]; then
      pastikan_var_env .env.local PERSISTENCE_DEV_TOKEN "$SERVER_TOKEN"
      info "PERSISTENCE_DEV_TOKEN diisi dari token publik yang sudah ada."
    else
      SERVER_TOKEN="$DEV_TOKEN_NEW"
      pastikan_var_env .env.local PERSISTENCE_DEV_TOKEN "$SERVER_TOKEN"
    fi
  fi
  pastikan_var_env .env.local NEXT_PUBLIC_PERSISTENCE "1"
  # Isi bila belum ada/kosong; nilai non-kosong milik user dipertahankan.
  pastikan_var_env .env.local NEXT_PUBLIC_PERSISTENCE_TOKEN "$SERVER_TOKEN"
  TOKEN_PUBLIK="$(env_get .env.local NEXT_PUBLIC_PERSISTENCE_TOKEN)"
  if [[ -n "$TOKEN_PUBLIK" && "$TOKEN_PUBLIK" != "$SERVER_TOKEN" ]]; then
    warn "NEXT_PUBLIC_PERSISTENCE_TOKEN berbeda dari PERSISTENCE_DEV_TOKEN; request persistence bisa 401. Samakan bila perlu."
  fi
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    pastikan_var_env .env.local PERSISTENCE_ALLOW_INSECURE_DEV_AUTH "true"
    pastikan_var_env .env.local COOKIE_SECURE "0"
  fi
  set_env_value .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "true"
  info "Persistence + agent runtime diaktifkan (DATABASE_URL terisi)."
else
  pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "false"
  warn "DATABASE_URL kosong: persistence/agent runtime nonaktif. Pasang --with-postgres atau isi DATABASE_URL."
fi

if [[ "$WITH_POSTGRES" -eq 1 && -n "$PGPORT" && -f .env.local ]]; then
  _DB_URL_AKTIF="$(env_get .env.local DATABASE_URL)"
  _DB_PORT_AKTIF="$(printf '%s' "$_DB_URL_AKTIF" | sed -E -n 's#^postgres(ql)?://[^@]*@(localhost|127\.0\.0\.1|\[::1\]):([0-9]+)/.*#\3#p')"
  if [[ -n "$_DB_PORT_AKTIF" && "$_DB_PORT_AKTIF" != "$PGPORT" ]]; then
    warn "DATABASE_URL menunjuk localhost:${_DB_PORT_AKTIF}, tetapi cluster ${PG_MAJOR}/main ada di port ${PGPORT}. Nilai tidak ditimpa — perbaiki manual bila koneksi gagal."
  fi
fi
chmod 600 .env.local 2>/dev/null || true

# ============================================== 4b. Konfigurasi model (openmaic.yml)
# Pembagian tugas: .env.local menyimpan secret + runtime, openmaic.yml menyimpan
# provider/allowlist model/slot. Server MENGABAIKAN DEFAULT_MODEL/MODEL_ROUTES
# begitu openmaic.yml ada, jadi installer memindahkan model default ke file itu
# sekali. File yang sudah ada tidak pernah ditimpa.
komentari_env_model() {
  local key="$1" catatan="$2"
  [[ -f .env.local ]] || return 0
  # Aktif maupun komentar lama dari run sebelumnya disegarkan, supaya tidak
  # menyisakan nilai model yang sudah usang.
  sed -i -E "s|^([[:space:]]*)${key}=(.*)$|# ${key} (${catatan})|" .env.local
  sed -i -E "s|^([[:space:]]*)# ${key} \\([^)]*\\).*$|# ${key} (${catatan})|" .env.local
}

siapkan_openmaic_yml() {
  if [[ "$WITH_OPENMAIC_YML" -ne 1 ]]; then
    info "openmaic.yml dilewati (--no-openmaic-yml); konfigurasi model tetap legacy."
    return 0
  fi
  if [[ -f openmaic.yml ]]; then
    info "openmaic.yml sudah ada — dipertahankan; blok models disegarkan dari katalog."
    return 0
  fi

  local model provider model_id prefix key_var="" models_csv api_line
  model="$(env_get .env.local DEFAULT_MODEL)"
  [[ -n "$model" ]] || model="${DEFAULT_MODEL:-}"
  if [[ -z "$model" ]]; then
    if [[ "$WITH_MODEL_REFRESH" -eq 1 ]]; then
      info "DEFAULT_MODEL kosong — openmaic.yml akan dibuat dari katalog OpenCode setelah dependensi."
    else
      info "DEFAULT_MODEL kosong — openmaic.yml tidak dibuat (model diatur di Settings)."
    fi
    return 0
  fi
  if [[ "$model" != *:* ]]; then
    warn "DEFAULT_MODEL '${model}' bukan bentuk provider:model — openmaic.yml dilewati."
    return 0
  fi
  provider="${model%%:*}"
  model_id="${model#*:}"
  prefix="${provider^^}"
  prefix="${prefix//-/_}"

  # Transport lokal (CLI) tidak butuh key. Provider HTTP butuh <PREFIX>_API_KEY
  # yang sudah ada; tanpa key file tidak dibuat supaya server tidak menolak start.
  case "$provider" in
    opencode|opencode-go) api_line="    api: opencode-cli" ;;
    codex)                api_line="    api: codex-sdk" ;;
    antigravity)          api_line="    api: antigravity-sdk" ;;
    *)
      key_var="${prefix}_API_KEY"
      if [[ -n "$(env_get .env.local "$key_var")" || -n "${!key_var:-}" ]]; then
        api_line="    api: openai-completions"
      else
        info "openmaic.yml tidak dibuat: provider '${provider}' butuh ${key_var} (atau pakai Settings)."
        return 0
      fi
      ;;
  esac

  # Allowlist model dari <PREFIX>_MODELS bila ada (mis. OPENCODE_MODELS).
  models_csv="$(env_get .env.local "${prefix}_MODELS")"
  [[ -n "$models_csv" ]] || models_csv="$model_id"
  local IFS=',' m models_yaml=""
  for m in $models_csv; do
    m="${m#"${m%%[![:space:]]*}"}"
    m="${m%"${m##*[![:space:]]}"}"
    [[ -n "$m" ]] && models_yaml+="      - ${m}"$'\n'
  done

  local key_yaml=""
  if [[ -n "$key_var" ]]; then key_yaml="    apiKey: \${${key_var}}"$'\n'; fi

  cat > openmaic.yml <<EOF
# =============================================================================
# openmaic.yml — konfigurasi model/provider deployment (dibuat oleh install.sh).
# Secret tetap di .env.local dan dirujuk \${VAR}; file ini hanya provider/slot.
# Dibaca sekali saat start — setelah mengubah:
#   pm2 startOrReload ecosystem.bun.config.cjs --update-env
# =============================================================================
providers:
  ${provider}:
    preset: ${provider}
${key_yaml}    models:
      # >>> models:${provider} (dikelola install.sh)
${models_yaml}      # <<< models:${provider}
slots:
  llm: ${model}
  agent:
    model: ${model}
${api_line}
EOF
  info "openmaic.yml dibuat: provider '${provider}', slot llm+agent = ${model}."
  komentari_env_model DEFAULT_MODEL "dipindah ke openmaic.yml -> slots.llm"
  komentari_env_model MODEL_ROUTES "tidak dibaca server; pakai slots di openmaic.yml"
  komentari_env_model MODEL_FALLBACK "dipindah ke openmaic.yml -> slots.llm.fallback"
}
siapkan_openmaic_yml

# ======================================= 4c. Katalog model dari CLI lokal
# Setiap run installer menyegarkan daftar model agar model baru dari OpenCode
# dan Codex langsung muncul di pemilih Pro Workbench:
#   OPENCODE_MODELS / OPENCODE_GO_MODELS  <- `opencode models`
#   CODEX_MODELS                          <- `codex app-server` (model/list)
# Kegagalan (offline, belum login, binary absen) tidak menghapus daftar lama.
# Blok `models:` di openmaic.yml yang dibuat installer ikut diperbarui; file
# milik user tidak disentuh. Matikan dengan --no-model-refresh.
OPENCODE_DEAD_IDS=(exo-free ling-3.0-flash-fin-free fledge-alpha-free)

cari_opencode_bin() {
  local bin cand
  bin="$(env_get .env.local OPENCODE_BIN)"
  if [[ -n "$bin" && -x "$bin" ]]; then printf '%s' "$bin"; return 0; fi
  if command -v opencode >/dev/null 2>&1; then command -v opencode; return 0; fi
  for cand in "${OWNER_HOME}/.opencode/bin/opencode" "${OWNER_HOME}/bin/opencode" /usr/local/bin/opencode; do
    if [[ -x "$cand" ]]; then printf '%s' "$cand"; return 0; fi
  done
  return 1
}

# Bare id unik satu provider dari output `opencode models`.
# $1=output mentah, $2=provider (opencode|opencode-go).
parse_opencode_models() {
  printf '%s\n' "$1" | awk -v p="$2" '
    {
      line=$0
      sub(/\r$/, "", line)
      gsub(/^[ \t]+|[ \t]+$/, "", line)
      if (line ~ ("^" p "[/:]")) {
        sub(("^" p "[/:]"), "", line)
        split(line, a, /[ \t]/)
        id=a[1]
        if (id != "" && !seen[id]++) out = out (out == "" ? "" : ",") id
      }
    }
    END { printf "%s", out }'
}

# Buang id yang sudah mati meski masih muncul di `opencode models`.
buang_model_mati() {
  local csv="${1:-}" id out="" mati
  local -a ids
  [[ -n "$csv" ]] || { printf ''; return 0; }
  IFS=',' read -r -a ids <<< "$csv"
  for id in "${ids[@]}"; do
    id="${id//[[:space:]]/}"
    [[ -n "$id" ]] || continue
    for mati in "${OPENCODE_DEAD_IDS[@]}"; do
      if [[ "$id" == "$mati" ]]; then continue 2; fi
    done
    out+="${out:+,}$id"
  done
  printf '%s' "$out"
}

# Probe Codex: `codex app-server` + JSON-RPC model/list. Dijalankan lewat Bun
# (installer ini tidak memasang Node); binary Codex tetap dari node_modules.
tulis_probe_codex() {
  cat > "$1" <<'PROBE'
import { spawn } from 'node:child_process';
const [runner, js] = process.argv.slice(2);
const child = spawn(runner, [js, 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let done = false;
const finish = (code) => {
  if (done) return;
  done = true;
  try { child.kill(); } catch {}
  process.exit(code);
};
child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2 && msg.result && Array.isArray(msg.result.data)) {
        const ids = msg.result.data
          .filter((m) => !m.hidden)
          .map((m) => String(m.id ?? m.model ?? ''))
          .filter(Boolean);
        console.log([...new Set(ids)].join(','));
        finish(0);
      }
    } catch {}
  }
});
child.stderr.on('data', () => {});
child.on('error', () => finish(1));
child.on('close', () => finish(1));
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'openmaic', version: '1.0' }, capabilities: {} } });
setTimeout(() => send({ jsonrpc: '2.0', method: 'initialized', params: {} }), 300);
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} }), 600);
setTimeout(() => finish(2), 12000);
PROBE
}

# $1=dir kerja. Menulis opencode.list/opencode-go.list + penanda .ok.
kumpulkan_model_opencode() {
  local dir="$1" bin raw ids go
  bin="$(cari_opencode_bin)" || return 1
  raw="$(as_owner env HOME="$OWNER_HOME" \
    PATH="${OWNER_HOME}/.opencode/bin:/usr/local/bin:/usr/bin:/bin" \
    timeout "${MODEL_DISCOVERY_TIMEOUT:-45}" "$bin" models 2>/dev/null)" || raw=""
  if [[ -z "$raw" ]]; then
    raw="$(env HOME="$OWNER_HOME" PATH="${OWNER_HOME}/.opencode/bin:/usr/local/bin:/usr/bin:/bin" \
      timeout "${MODEL_DISCOVERY_TIMEOUT:-45}" "$bin" models 2>/dev/null)" || true
  fi
  [[ -n "$raw" ]] || return 1
  ids="$(parse_opencode_models "$raw" opencode)"
  ids="$(buang_model_mati "$ids")"
  [[ -n "$ids" ]] || return 1
  go="$(parse_opencode_models "$raw" opencode-go)"
  printf '%s' "$ids" > "${dir}/opencode.list"
  printf '%s' "$go" > "${dir}/opencode-go.list"
  : > "${dir}/opencode.ok"
}

# $1=dir kerja. Menulis codex.list + penanda .ok.
kumpulkan_model_codex() {
  local dir="$1" js="${ROOT_DIR}/node_modules/@openai/codex/bin/codex.js" ids
  [[ -f "$js" ]] || return 1
  ids="$(as_owner env HOME="$OWNER_HOME" "$BUN_BIN" "${dir}/codex-probe.mjs" "$BUN_BIN" "$js" 2>/dev/null)" || return 1
  ids="$(printf '%s' "$ids" | tr -d '\r\n' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [[ -n "$ids" ]] || return 1
  printf '%s' "$ids" > "${dir}/codex.list"
  : > "${dir}/codex.ok"
}

# Tulis daftar model ke .env.local hanya bila berubah.
sinkron_env_model() {
  local key="$1" value="$2" cur
  cur="$(env_get .env.local "$key")"
  if [[ "$cur" == "$value" ]]; then return 0; fi
  set_env_value .env.local "$key" "$value"
  info "  ${key} diperbarui (${value:-<kosong>})."
}

model_ada() {
  local csv="${1:-}" id="$2"
  [[ ",${csv}," == *",${id},"* ]]
}

# Default yang stabil bila model lama hilang dari katalog.
pilih_default_opencode() {
  local csv="${1:-}" id
  for id in big-pickle deepseek-v4.1-flash-free glm-5.3-flash-free; do
    if model_ada "$csv" "$id"; then printf '%s' "$id"; return 0; fi
  done
  printf '%s' "${csv%%,*}"
}

# Blok provider YAML dengan marker model (dipakai saat membuat/menambah blok).
blok_provider_yml() {
  local provider="$1" preset="$2" csv="${3:-}" id
  local -a ids
  printf '  %s:\n    preset: %s\n    models:\n' "$provider" "$preset"
  printf '      # >>> models:%s (dikelola install.sh)\n' "$provider"
  if [[ -n "$csv" ]]; then
    IFS=',' read -r -a ids <<< "$csv"
    for id in "${ids[@]}"; do
      id="${id//[[:space:]]/}"
      if [[ -n "$id" ]]; then printf '      - %s\n' "$id"; fi
    done
  fi
  printf '      # <<< models:%s\n\n' "$provider"
}

# Tambah blok provider baru sebelum `slots:` bila belum ada.
tambah_provider_yml() {
  local file="$1" provider="$2" preset="$3" csv="${4:-}" tmp block
  [[ -n "$csv" ]] || return 0
  if grep -qE "^  ${provider}:" "$file"; then return 0; fi
  tmp="$(mktemp)"
  block="$(mktemp)"
  blok_provider_yml "$provider" "$preset" "$csv" > "$block"
  awk -v block="$block" '
    BEGIN { while ((getline l < block) > 0) b = b l "\n" }
    !done && /^slots:[[:space:]]*$/ { printf "%s", b; done=1 }
    { print }
    END { if (!done) printf "\n%s", b }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  rm -f "$block"
}

# Pastikan provider punya marker `# >>> models:<provider>` / `# <<<`.
# File lama (dibuat versi installer sebelumnya) dimigrasikan di tempat tanpa
# menyentuh komentar/slot lain. Return 1 bila blok provider tidak ada.
pastikan_marker_yml() {
  local file="$1" provider="$2" tmp
  if grep -qE "^[[:space:]]*# >>> models:${provider}([[:space:]]|$)" "$file"; then return 0; fi
  grep -qE "^  ${provider}:" "$file" || return 1
  tmp="$(mktemp)"
  awk -v prov="$provider" '
    function tutup() { if (inlist) { print "      # <<< models:" prov; inlist=0 } }
    function model_kurang() {
      if (inprov && !punya_models) {
        print "    models:"
        print "      # >>> models:" prov " (dikelola install.sh)"
        print "      # <<< models:" prov
        punya_models=1
      }
    }
    $0 ~ ("^  " prov ":[[:space:]]*$") { tutup(); model_kurang(); inprov=1; punya_models=0; print; next }
    inprov && $0 ~ /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { tutup(); model_kurang(); inprov=0 }
    inprov && $0 ~ /^    models:[[:space:]]*$/ {
      punya_models=1
      print
      print "      # >>> models:" prov " (dikelola install.sh)"
      inlist=1
      next
    }
    inlist {
      if ($0 ~ /^      - /) { print; next }
      tutup()
    }
    { print }
    END { tutup(); if (inprov) model_kurang() }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# Ganti isi blok marker dengan daftar baru (marker harus sudah ada).
ganti_blok_model() {
  local file="$1" provider="$2" csv="${3:-}" tmp items id
  local -a ids
  tmp="$(mktemp)"
  items="$(mktemp)"
  if [[ -n "$csv" ]]; then
    IFS=',' read -r -a ids <<< "$csv"
    for id in "${ids[@]}"; do
      id="${id//[[:space:]]/}"
      if [[ -n "$id" ]]; then printf '      - %s\n' "$id" >> "$items"; fi
    done
  fi
  awk -v prov="$provider" -v items="$items" '
    BEGIN { while ((getline l < items) > 0) b = b l "\n" }
    $0 ~ ("^[[:space:]]*# >>> models:" prov "([[:space:]]|$)") {
      print; printf "%s", b; skip=1; next
    }
    skip && $0 ~ ("^[[:space:]]*# <<< models:" prov "([[:space:]]|$)") {
      skip=0; print; next
    }
    skip { next }
    { print }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
  rm -f "$items"
}

baca_slot_llm() {
  awk '
    /^  llm:[[:space:]]*/ {
      line=$0
      sub(/^  llm:[[:space:]]*/, "", line)
      sub(/[[:space:]]*#.*/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      print line
      exit
    }
  ' "$1"
}

baca_slot_agent_model() {
  awk '
    /^  agent:[[:space:]]*$/ { inagent=1; next }
    inagent && /^  [A-Za-z0-9_-]+:/ { exit }
    inagent && /^    model:[[:space:]]*/ {
      line=$0
      sub(/^    model:[[:space:]]*/, "", line)
      sub(/[[:space:]]*#.*/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      print line
      exit
    }
  ' "$1"
}

ganti_slot_llm() {
  local file="$1" model="$2" tmp
  tmp="$(mktemp)"
  awk -v m="$model" '
    !done && /^  llm:[[:space:]]*/ { print "  llm: " m; done=1; next }
    { print }
    END { if (!done) print "  llm: " m }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# Set model agent + api transport-nya, membuat baris yang belum ada.
set_slot_agent() {
  local file="$1" model="$2" api="${3:-}" tmp
  tmp="$(mktemp)"
  awk -v m="$model" -v api="$api" '
    function ensure_model() { if (!gotmodel) { print "    model: " m; gotmodel=1 } }
    function ensure_api() { if (api != "" && !gotapi) { print "    api: " api; gotapi=1 } }
    /^  agent:[[:space:]]*$/ { inagent=1; print; next }
    inagent && /^  [A-Za-z0-9_-]+:/ { ensure_model(); ensure_api(); inagent=0 }
    inagent && /^    model:[[:space:]]*/ { print "    model: " m; gotmodel=1; next }
    inagent && api != "" && /^    api:[[:space:]]*/ { print "    api: " api; gotapi=1; next }
    { print }
    END { if (inagent) { ensure_model(); ensure_api() } }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# Buat openmaic.yml installer-owned dari hasil discovery (belum ada file).
buat_openmaic_yml() {
  local op_list="$1" go_list="$2" cx_list="$3" ag_list="${4:-}" default_model
  default_model="opencode:$(pilih_default_opencode "$op_list")"
  {
    cat <<'EOF'
# =============================================================================
# openmaic.yml — konfigurasi model/provider deployment (dibuat oleh install.sh)
#
# Pembagian tugas:
#   .env.local   : secret (API key, DATABASE_URL, ACCESS_CODE), path runtime
#                  (OPENCODE_BIN) dan feature flag.
#   openmaic.yml : provider, allowlist model, dan slot (llm, agent, tts, ...).
#                  Secret dirujuk ${VAR}; nilainya tetap di .env.local.
#
# Blok `models:` bertanda `# >>> models:<provider>` dikelola install.sh dan
# disegarkan setiap run (termasuk model terbaru dari OpenCode/Codex). Edit di
# luar blok itu untuk kustomisasi; file ini dibaca SEKALI saat server start:
#   pm2 startOrReload ecosystem.bun.config.cjs --update-env
# =============================================================================
providers:
EOF
    blok_provider_yml opencode opencode "$op_list"
    if [[ -n "$go_list" ]]; then
      printf '  # OpenCode Go (butuh `opencode auth login`).\n'
      blok_provider_yml opencode-go opencode-go "$go_list"
    fi
    if [[ -n "$cx_list" ]]; then
      printf '  # Codex SDK (auth lewat `codex login` / CODEX_API_KEY).\n'
      blok_provider_yml codex codex "$cx_list"
    fi
    if [[ -n "$ag_list" ]]; then
      printf '  # Google Antigravity SDK (auth lewat GEMINI_API_KEY / Vertex AI).\n'
      blok_provider_yml antigravity antigravity "$ag_list"
    fi
    cat <<EOF

slots:
  # Default chat: chat classic + seluruh slot course/classroom yang mengikutinya.
  llm: ${default_model}

  # Pro Workbench / agent runtime (butuh tool calling).
  agent:
    model: ${default_model}
    api: opencode-cli
EOF
  } > openmaic.yml
  info "openmaic.yml dibuat dari katalog: slot llm+agent = ${default_model}."
  komentari_env_model DEFAULT_MODEL "dipindah ke openmaic.yml -> slots.llm"
  komentari_env_model MODEL_ROUTES "tidak dibaca server; pakai slots di openmaic.yml"
  komentari_env_model MODEL_FALLBACK "dipindah ke openmaic.yml -> slots.llm.fallback"
}

# Inti: discovery paralel + tulis .env.local + segarkan openmaic.yml.
sinkron_model() {
  local dir op_ok=0 cx_ok=0 pid_op pid_cx
  local op_list="" go_list="" cx_list="" ag_list="" llm_cur agent_cur default_id dm

  if [[ "$WITH_MODEL_REFRESH" -ne 1 ]]; then
    info "Sinkron katalog model dilewati (--no-model-refresh)."
    return 0
  fi

  LANGKAH="sinkron katalog model"
  # Antigravity's catalogue is static (the SDK has no model-list command).
  ag_list="$(env_get .env.local ANTIGRAVITY_MODELS)"
  dir="$(mktemp -d)"
  chmod 0755 "$dir"
  tulis_probe_codex "${dir}/codex-probe.mjs"
  chmod 0644 "${dir}/codex-probe.mjs"

  # Paralel: `opencode models` bisa puluhan detik; Codex hanya ~1 detik.
  ( kumpulkan_model_opencode "$dir" ) &
  pid_op=$!
  ( kumpulkan_model_codex "$dir" ) &
  pid_cx=$!
  wait "$pid_op" 2>/dev/null || true
  wait "$pid_cx" 2>/dev/null || true

  if [[ -f "${dir}/opencode.ok" ]]; then op_ok=1; fi
  if [[ -f "${dir}/codex.ok" ]]; then cx_ok=1; fi
  if [[ "$op_ok" -eq 1 ]]; then op_list="$(cat "${dir}/opencode.list")"; fi
  if [[ "$op_ok" -eq 1 ]]; then go_list="$(cat "${dir}/opencode-go.list")"; fi
  if [[ "$cx_ok" -eq 1 ]]; then cx_list="$(cat "${dir}/codex.list")"; fi

  if [[ "$op_ok" -eq 1 ]]; then
    sinkron_env_model OPENCODE_MODELS "$op_list"
    sinkron_env_model OPENCODE_GO_MODELS "$go_list"
    info "Katalog opencode: ${op_list//,/, }"
  else
    info "Katalog opencode tidak tersedia — OPENCODE_MODELS dipertahankan."
  fi
  if [[ "$cx_ok" -eq 1 ]]; then
    sinkron_env_model CODEX_MODELS "$cx_list"
    info "Katalog codex: ${cx_list//,/, }"
  else
    info "Katalog codex tidak tersedia — CODEX_MODELS dipertahankan."
  fi

  if [[ "$WITH_OPENMAIC_YML" -ne 1 ]]; then
    rm -rf "$dir"
    return 0
  fi

  if [[ ! -f openmaic.yml ]]; then
    dm="$(env_get .env.local DEFAULT_MODEL)"
    if [[ -n "$dm" && "$dm" != opencode:* && "$dm" != opencode-go:* && "$dm" != codex:* && "$dm" != antigravity:* ]]; then
      info "openmaic.yml belum ada; DEFAULT_MODEL=${dm} bukan transport CLI — tidak dibuat otomatis."
    elif [[ "$op_ok" -eq 1 && -n "$op_list" ]]; then
      buat_openmaic_yml "$op_list" "$go_list" "$cx_list" "$ag_list"
    else
      info "openmaic.yml belum ada dan katalog opencode tidak tersedia — tidak dibuat."
    fi
    rm -rf "$dir"
    return 0
  fi

  if ! grep -q "dibuat oleh install.sh" openmaic.yml; then
    info "openmaic.yml ada tetapi bukan milik installer — tidak diubah."
    rm -rf "$dir"
    return 0
  fi

  # Segarkan blok model tiap provider yang berhasil didiscovery.
  if [[ "$op_ok" -eq 1 ]]; then
    pastikan_marker_yml openmaic.yml opencode || tambah_provider_yml openmaic.yml opencode opencode "$op_list"
    ganti_blok_model openmaic.yml opencode "$op_list"
  fi
  if [[ "$op_ok" -eq 1 && -n "$go_list" ]]; then
    pastikan_marker_yml openmaic.yml opencode-go || tambah_provider_yml openmaic.yml opencode-go opencode-go "$go_list"
    ganti_blok_model openmaic.yml opencode-go "$go_list"
  fi
  if [[ "$cx_ok" -eq 1 ]]; then
    pastikan_marker_yml openmaic.yml codex || tambah_provider_yml openmaic.yml codex codex "$cx_list"
    ganti_blok_model openmaic.yml codex "$cx_list"
  fi
  if [[ -n "$ag_list" ]]; then
    pastikan_marker_yml openmaic.yml antigravity || tambah_provider_yml openmaic.yml antigravity antigravity "$ag_list"
    ganti_blok_model openmaic.yml antigravity "$ag_list"
  fi

  # Bila model default lama hilang dari katalog, pindahkan slot ke model yang
  # masih ada. Pilihan user yang masih valid tidak pernah ditimpa.
  if [[ "$op_ok" -eq 1 ]]; then
    default_id="$(pilih_default_opencode "$op_list")"
    llm_cur="$(baca_slot_llm openmaic.yml)"
    if [[ "$llm_cur" == opencode:* ]] && ! model_ada "$op_list" "${llm_cur#opencode:}"; then
      ganti_slot_llm openmaic.yml "opencode:${default_id}"
      info "slots.llm: ${llm_cur} hilang dari katalog -> opencode:${default_id}."
    fi
    agent_cur="$(baca_slot_agent_model openmaic.yml)"
    if [[ "$agent_cur" == opencode:* ]] && ! model_ada "$op_list" "${agent_cur#opencode:}"; then
      set_slot_agent openmaic.yml "opencode:${default_id}" opencode-cli
      info "slots.agent: ${agent_cur} hilang dari katalog -> opencode:${default_id}."
    fi
  fi

  info "Katalog model disinkronkan ke .env.local dan openmaic.yml."
  rm -rf "$dir"
}

# ============================================================ 5. Direktori data
LANGKAH="direktori data/"
info "Menyiapkan direktori data/..."
mkdir -p data/classrooms data/classroom-jobs

# ============================================================ 6. Dependensi JS
if [[ "$WITH_INSTALL" -eq 1 ]]; then
  LANGKAH="bun: manifest workspace"
  info "Menyiapkan package.json untuk Bun (workspaces + trustedDependencies)..."
  # Bun membaca workspaces dari package.json, bukan pnpm-workspace.yaml.
  # Blok ini idempoten dan hanya menulis bila ada yang berubah.
  as_owner "$BUN_BIN" -e '
const fs = require("node:fs");
const root = process.cwd();
const pkgPath = `${root}/package.json`;
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
let changed = false;

function bacaWorkspacePnpm() {
  const file = `${root}/pnpm-workspace.yaml`;
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const hasil = [];
  let dalamPackages = false;
  for (const line of lines) {
    if (/^\s*packages\s*:/.test(line)) { dalamPackages = true; continue; }
    if (dalamPackages && /^\S/.test(line) && !/^\s*#/.test(line)) dalamPackages = false;
    if (!dalamPackages) continue;
    const m = line.match(/^\s*-\s*["\x27]?([^"\x27#]+?)["\x27]?\s*(?:#.*)?$/);
    if (m) hasil.push(m[1].trim());
  }
  return hasil.length ? hasil : null;
}

if (!Array.isArray(pkg.workspaces) || pkg.workspaces.length === 0) {
  pkg.workspaces = bacaWorkspacePnpm() || [
    "packages/*",
    "packages/@openmaic/*",
    "!packages/docs",
  ];
  changed = true;
}

const perluTrust = [
  "@alicloud/openapi-core",
  "@biomejs/biome",
  "@google/genai",
  "canvas",
  "esbuild",
  "onnxruntime-node",
  "protobufjs",
  "sharp",
  "unrs-resolver",
];
const trust = new Set(pkg.trustedDependencies || []);
for (const nama of perluTrust) trust.add(nama);
const trustBaru = [...trust].sort();
if (JSON.stringify(trustBaru) !== JSON.stringify(pkg.trustedDependencies || [])) {
  pkg.trustedDependencies = trustBaru;
  changed = true;
}

if (changed) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("package.json: workspaces/trustedDependencies disiapkan");
} else {
  console.log("package.json: sudah siap untuk Bun");
}
'
  as_owner "$BUN_BIN" -e 'const p=require("./package.json"); console.log("workspaces:", JSON.stringify(p.workspaces)); console.log("trustedDependencies:", (p.trustedDependencies||[]).length + " paket");'

  LANGKAH="bun install"
  info "Menjalankan bun install (postinstall membangun packages + sync vendor)..."
  BUN_INSTALL_ARGS=(--no-progress)
  if [[ -f bun.lock ]]; then BUN_INSTALL_ARGS+=(--frozen-lockfile); fi
  BUN_CACHE="$(as_owner "$BUN_BIN" pm cache 2>/dev/null || true)"
  if [[ -n "$BUN_CACHE" && -d "$BUN_CACHE" ]] && [[ -n "$(ls -A "$BUN_CACHE" 2>/dev/null)" ]]; then
    BUN_INSTALL_ARGS+=(--prefer-offline)
    info "Cache Bun terisi — memakai --prefer-offline."
  fi

  bun_install() {
    as_owner env "${BUILD_ENV[@]}" "$BUN_BIN" install "$@"
  }

  if ! bun_install "${BUN_INSTALL_ARGS[@]}"; then
    warn "bun install gagal — mencoba ulang tanpa --frozen-lockfile..."
    BUN_INSTALL_ARGS_RETRY=(--no-progress)
    if [[ " ${BUN_INSTALL_ARGS[*]} " == *" --prefer-offline "* ]]; then
      BUN_INSTALL_ARGS_RETRY+=(--prefer-offline)
    fi
    if ! bun_install "${BUN_INSTALL_ARGS_RETRY[@]}"; then
      warn "bun install masih gagal — mengulang tanpa lifecycle script lalu build manual..."
      bun_install --no-progress --ignore-scripts
      as_owner env "${BUILD_ENV[@]}" "$BUN_BIN" run build:packages
    fi
  fi

  LANGKAH="verifikasi dependensi"
  info "Verifikasi vendor bundle PPTX..."
  as_owner "$BUN_BIN" scripts/assert-vendor-maic-importer.mjs
  info "Verifikasi kontrak engine..."
  as_owner "$BUN_BIN" scripts/check-node-engine-contract.mjs
  colab_mark "bun install selesai"

  if [[ -n "$DB_URL_EFEKTIF" && -f scripts/bootstrap-db-schema.mts ]]; then
    LANGKAH="bootstrap skema database"
    info "Bootstrap skema database (eager)..."
    if as_owner env DATABASE_URL="$DB_URL_EFEKTIF" "$BUN_BIN" scripts/bootstrap-db-schema.mts; then
      info "Skema database: OK."
    else
      warn "Bootstrap skema database gagal; skema dibuat lazy saat server jalan."
    fi
  colab_mark "bootstrap skema database selesai"
  fi
else
  info "Lewati bun install (--no-install). Jalankan manual nanti: bun install"
fi

# ================================= 6a. Google Antigravity SDK (venv Python)
# The Antigravity transport runs a Python SDK (lib/ai/antigravity_bridge.py).
# Install it into a project-local venv so the host Python stays untouched, then
# point the server at that interpreter. Failures are warnings: the rest of
# OpenMAIC still works and the workbench reports the missing transport.
ANTIGRAVITY_MODELS_DEFAULT="gemini-3.8-flash,gemini-4-argon,gemini-3.7-flash,gemini-3.6-flash,gemini-3.1-pro"
if [[ "$WITH_ANTIGRAVITY" -eq 1 ]]; then
  LANGKAH="antigravity: venv + pip"
  ANTIGRAVITY_VENV="${ROOT_DIR}/.venv-antigravity"
  ANTIGRAVITY_PY="${ANTIGRAVITY_VENV}/bin/python"
  ag_venv_ok=0
  ag_installed=0
  # Prefer an interpreter whose venv module actually works. The system
  # `python3` may be newer than the installed python3-venv package (e.g. 3.13
  # vs 3.12 on some Colab images), so probe candidates explicitly.
  AG_PYTHON_BIN=""
  for cand in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import venv, ensurepip' >/dev/null 2>&1; then
      AG_PYTHON_BIN="$cand"
      break
    fi
  done
  if [[ -x "$ANTIGRAVITY_PY" ]]; then
    ag_venv_ok=1
    info "Venv Antigravity sudah ada — memakai ${ANTIGRAVITY_PY}."
  elif [[ -n "$AG_PYTHON_BIN" ]]; then
    info "Membuat venv Antigravity (${ANTIGRAVITY_VENV}) dengan ${AG_PYTHON_BIN}..."
    if as_owner "$AG_PYTHON_BIN" -m venv "$ANTIGRAVITY_VENV"; then
      ag_venv_ok=1
    else
      warn "Gagal membuat venv Antigravity (butuh paket ${AG_PYTHON_BIN}-venv)."
    fi
  elif command -v uv >/dev/null 2>&1; then
    info "Membuat venv Antigravity (${ANTIGRAVITY_VENV}) dengan uv..."
    if as_owner uv venv "$ANTIGRAVITY_VENV" --python 3.12; then
      ag_venv_ok=1
    else
      warn "Gagal membuat venv Antigravity dengan uv."
    fi
  else
    warn "Tidak ada Python dengan modul venv — Google Antigravity SDK dilewati."
  fi
  if [[ "$ag_venv_ok" -eq 1 ]]; then
    # Keep pip current enough for wheels built for Python 3.10+.
    as_owner "$ANTIGRAVITY_PY" -m pip install --quiet --upgrade pip setuptools wheel \
      || warn "Pembaruan pip di venv Antigravity gagal; melanjutkan."
    info "Memasang Google Antigravity SDK (pip install google-antigravity)..."
    if as_owner "$ANTIGRAVITY_PY" -m pip install --quiet --upgrade google-antigravity; then
      ag_installed=1
    else
      warn "Instalasi google-antigravity gagal — transport antigravity-sdk tidak akan jalan."
    fi
  fi
  if [[ "$ag_installed" -eq 1 ]]; then
    set_env_value .env.local ANTIGRAVITY_PYTHON "$ANTIGRAVITY_PY"
    pastikan_var_env .env.local ANTIGRAVITY_MODELS "$ANTIGRAVITY_MODELS_DEFAULT"
    info "Antigravity SDK: OK (${ANTIGRAVITY_PY}); isi GEMINI_API_KEY untuk mengaktifkan run."
  else
    # Hide the provider group unless the operator already wrote their own list.
    if ! grep -qE "^[[:space:]]*ANTIGRAVITY_MODELS=.+" .env.local 2>/dev/null; then
      set_env_value .env.local ANTIGRAVITY_MODELS ""
    fi
    warn "Antigravity SDK tidak terpasang; grup 'Antigravity SDK' disembunyikan dari pemilih model."
  fi
else
  set_env_value .env.local ANTIGRAVITY_MODELS ""
  info "Google Antigravity SDK dilewati (--no-antigravity)."
fi

# ================================= 6a2. Google Antigravity CLI (agy)
# Opsional: binary `agy` untuk penggunaan interaktif di terminal. OpenMAIC tidak
# memakainya sebagai transport (SDK yang menangani turn agar tool-loop tetap
# milik harness), tetapi CLI ini berguna untuk login browser dan eksplorasi.
if [[ "$WITH_ANTIGRAVITY" -eq 1 ]]; then
  if command -v agy >/dev/null 2>&1; then
    info "Antigravity CLI (agy) sudah terpasang."
  else
    info "Memasang Google Antigravity CLI (agy)..."
    if curl -fsSL https://antigravity.google/cli/install.sh | bash >/tmp/opencode/agy-install.log 2>&1; then
      info "Antigravity CLI (agy) terpasang di ~/.local/bin (jalankan 'agy' untuk login browser)."
    else
      warn "Gagal memasang Antigravity CLI (agy); lihat /tmp/opencode/agy-install.log."
    fi
  fi
  # Pastikan ~/.local/bin masuk PATH untuk proses server (PM2).
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
fi
colab_mark "antigravity selesai"

# ======================================= 6b. Sinkron katalog model (OpenCode/Codex)
# Dijalankan setelah dependensi agar binary Codex sudah tersedia. Menulis
# .env.local + openmaic.yml sebelum build/PM2 menyalin konfigurasi.
sinkron_model
colab_mark "sinkron katalog model selesai"

# ============================================================ 7. Playwright
if [[ "$WITH_PLAYWRIGHT" -eq 1 ]]; then
  LANGKAH="playwright: chromium"
  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    warn "--with-playwright butuh dependensi terpasang; dilewati. Jalankan: bun install && bun x playwright install --with-deps chromium"
  else
    info "Menginstal dependensi OS Chromium (apt) ..."
    run_as_root env PATH="$BUN_INSTALL_PREFIX/bin:$PATH" "$BUN_BIN" x playwright install-deps chromium \
      || warn "install-deps Playwright gagal; coba manual: sudo bun x playwright install-deps chromium"
    info "Mengunduh browser Chromium untuk user ${OWNER_USER}..."
    as_owner env PATH="$BUN_INSTALL_PREFIX/bin:$PATH" "$BUN_BIN" x playwright install chromium \
      || warn "Instalasi browser Playwright gagal; jalankan manual sebagai ${OWNER_USER}: bun x playwright install chromium"
  fi
fi

# ============================================================ 8. Build
BUILD_DONE=0
jalankan_build() {
  LANGKAH="bun: build produksi"
  # Heap adaptif untuk tsc/esbuild yang dijalankan bun saat build (pola
  # install-node.sh). Mencegah OOM di runtime Colab kecil tanpa memperlambat
  # runtime besar.
  if [[ -z "${NODE_OPTIONS:-}" ]]; then
    BUILD_HEAP=3072
    _ram_mb="$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || true)"
    if [[ "$_ram_mb" =~ ^[0-9]+$ ]]; then
      _heap_ram=$((_ram_mb - 512))
      if [[ "$_heap_ram" -lt 1024 ]]; then _heap_ram=1024; fi
      if [[ "$_heap_ram" -lt "$BUILD_HEAP" ]]; then BUILD_HEAP="$_heap_ram"; fi
    fi
    unset _ram_mb _heap_ram
    export NODE_OPTIONS="--max-old-space-size=${BUILD_HEAP}"
  fi
  info "Menjalankan build produksi Bun (bun --bun run build)..."
  as_owner env NEXT_TELEMETRY_DISABLED=1 "${BUILD_ENV[@]}" "$BUN_BIN" --bun run build
  BUILD_DONE=1
  colab_mark "build produksi selesai"
}

if [[ "$WITH_BUILD" -eq 1 ]]; then
  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    fail "--build butuh dependensi terinstal; ulangi tanpa --no-install."
  fi
  jalankan_build
fi

# ============================================================ 9. Kepemilikan
LANGKAH="kepemilikan file"
if [[ "$(id -u)" -eq 0 && "$OWNER_USER" != "root" ]]; then
  # Hanya chown path yang masih milik root. Semua langkah berat (bun install,
  # build) dijalankan sebagai OWNER_USER, jadi rerun biasanya tidak perlu
  # menyentuh node_modules/.next yang berukuran GB.
  chown_path() {
    local path="$1" owner
    [[ -e "$path" ]] || return 0
    owner="$(stat -c %U "$path" 2>/dev/null || true)"
    [[ "$owner" == "$OWNER_USER" ]] && return 0
    chown -R "$OWNER_USER" "$path" 2>/dev/null \
      || warn "Gagal chown $path ke ${OWNER_USER}; jalankan manual: sudo chown -R ${OWNER_USER} $path"
  }
  info "Menyerahkan kepemilikan artefak ke user ${OWNER_USER}..."
  for path in .env.local data node_modules public/vendor .next bun.lock package.json; do
    chown_path "$path"
  done
  for bak in .env.local.bak.*; do
    [[ -e "$bak" ]] || continue
    chown "$OWNER_USER" "$bak" 2>/dev/null || true
  done
  if [[ -d packages ]]; then
    while IFS= read -r -d '' dir; do
      chown_path "$dir"
    done < <(find packages -maxdepth 3 -name node_modules -type d -print0 2>/dev/null)
  fi
fi

# ============================================================ 10. PM2 (opsional)
if [[ "$WITH_PM2" -eq 1 ]]; then
  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    fail "--with-pm2 butuh dependensi terinstal; ulangi tanpa --no-install."
  fi
  PM2_USER="$OWNER_USER"

  LANGKAH="pm2: instalasi"
  if /usr/local/bin/pm2 --version >/dev/null 2>&1; then
    info "PM2 sudah tersedia via Bun."
  else
    info "Menginstal PM2 global via Bun (tanpa Node)..."
    run_as_root env BUN_INSTALL="$BUN_INSTALL_PREFIX" "$BUN_BIN" add -g pm2 --no-progress \
      || fail "Instalasi PM2 via Bun gagal. Coba manual: sudo BUN_INSTALL=/usr/local bun add -g pm2"
  fi

  # Binari PM2 dari Bun masih memakai shebang `#!/usr/bin/env node`. Bila Node
  # tidak ada, bungkus dengan skrip kecil yang menjalankan Bun.
  PM2_JS="${BUN_INSTALL_PREFIX}/install/global/node_modules/pm2/bin/pm2"
  if [[ -f "$PM2_JS" ]] && { [[ -L /usr/local/bin/pm2 ]] || ! /usr/local/bin/pm2 --version >/dev/null 2>&1; }; then
    PM2_WRAPPER="$(mktemp)"
    {
      echo '#!/bin/sh'
      printf 'exec "%s" "%s" "$@"\n' "$BUN_BIN" "$PM2_JS"
    } > "$PM2_WRAPPER"
    run_as_root install -m 0755 "$PM2_WRAPPER" /usr/local/bin/pm2
    rm -f "$PM2_WRAPPER"
    hash -r 2>/dev/null || true
  fi
  /usr/local/bin/pm2 --version >/dev/null 2>&1 \
    || fail "PM2 tidak bisa dijalankan. Cek: /usr/local/bin/pm2 --version"

  pm2_as_owner() {
    as_owner env PATH="/usr/local/bin:/usr/bin:/bin" /usr/local/bin/pm2 "$@"
  }

  if [[ ! -f .next/standalone/server.js ]]; then
    if [[ "$WITH_BUILD" -eq 1 && "$BUILD_DONE" -eq 1 ]]; then
      fail "Build selesai tetapi .next/standalone/server.js tidak ada; cek output Next.js."
    fi
    info "Build standalone belum ada — menjalankan build untuk PM2..."
    jalankan_build
  else
    info "Memakai build standalone yang sudah ada."
    warn "Bila NEXT_PUBLIC_* berubah, build ulang: bun --bun run build"
  fi
  [[ -f .next/standalone/server.js ]] \
    || fail "server.js standalone tidak ada; PM2 tidak bisa dijalankan."

  # Wrapper PM2 (run-server.sh) memaksa HOSTNAME=0.0.0.0; pastikan executable.
  if [[ -f run-server.sh ]]; then
    run_as_root chmod +x run-server.sh 2>/dev/null || chmod +x run-server.sh
  fi

  LANGKAH="pm2: sinkron aset standalone"
  mkdir -p .next/standalone/.next
  rm -rf .next/standalone/.next/static .next/standalone/public
  cp -a .next/static .next/standalone/.next/static
  cp -a public .next/standalone/public
  # Codex CLI (binary) harus ikut ke standalone agar resolveCodexBinary()
  # menemukannya tanpa bergantung pada parent node_modules.
  if [[ -d node_modules/@openai ]]; then
    mkdir -p .next/standalone/node_modules
    cp -aL node_modules/@openai .next/standalone/node_modules/ 2>/dev/null \
      || warn "Gagal menyalin @openai ke standalone."
  fi
  if [[ -f openmaic.yml ]]; then
    cp -f openmaic.yml .next/standalone/openmaic.yml
  fi
  if [[ ! -f .next/standalone/packages/@openmaic/generation/prompts-pbl/planner-single-call-system.md ]]; then
    warn "prompts-pbl PBL tidak ada di standalone — scene PBL akan gagal ENOENT. Pastikan outputFileTracingIncludes di next.config.ts lalu build ulang."
  fi
  info "Aset standalone disinkronkan (.next/static + public)."

  if [[ "$(id -u)" -eq 0 && "$PM2_USER" != "root" ]]; then
    chown -R "$PM2_USER" .next 2>/dev/null \
      || warn "Gagal chown .next ke ${PM2_USER}."
  fi

  LANGKAH="pm2: start/reload"
  [[ -f ecosystem.bun.config.cjs ]] \
    || fail "ecosystem.bun.config.cjs tidak ditemukan; file ini dibutuhkan PM2 Bun."
  # --update-env agar perubahan .env.local/openmaic.yml ikut terpakai saat
  # installer dijalankan ulang (PM2 menyimpan env proses lama tanpa flag ini).
  # `restart` (bukan `startOrReload`) dipakai agar aset statis yang baru
  # disalin benar-benar dimuat ulang (reload graceful bisa mempertahankan
  # file descriptor lama dan menyebabkan 404 pada chunk CSS/JS).
  if pm2_as_owner pid kelaska 2>/dev/null | grep -qE '^[1-9][0-9]*$'; then
    pm2_as_owner restart kelaska --update-env
  else
    pm2_as_owner start ecosystem.bun.config.cjs --update-env
  fi
  pm2_as_owner save || warn "pm2 save gagal; jalankan manual: pm2 save"
  info "Aplikasi berjalan via PM2 (proses: kelaska, runtime Bun)."
  colab_mark "PM2 start selesai"
  LANGKAH="pm2: startup systemd"
  if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
    PM2_HOME_USER="${OWNER_HOME}/.pm2"
    PM2_UNIT="/etc/systemd/system/pm2-${PM2_USER}.service"
    PM2_UNIT_TMP="$(mktemp)"
    cat > "$PM2_UNIT_TMP" <<EOF
[Unit]
Description=PM2 process manager for ${PM2_USER} (OpenMAIC/Bun)
After=network.target

[Service]
Type=forking
User=${PM2_USER}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=PM2_HOME=${PM2_HOME_USER}
PIDFile=${PM2_HOME_USER}/pm2.pid
ExecStart=/usr/local/bin/pm2 resurrect
ExecReload=/usr/local/bin/pm2 reload all
ExecStop=/usr/local/bin/pm2 kill
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    run_as_root install -m 0644 "$PM2_UNIT_TMP" "$PM2_UNIT"
    rm -f "$PM2_UNIT_TMP"
    run_as_root systemctl daemon-reload
    run_as_root systemctl enable "pm2-${PM2_USER}.service" >/dev/null 2>&1 \
      || warn "systemctl enable pm2-${PM2_USER} gagal."
    run_as_root systemctl restart "pm2-${PM2_USER}.service" \
      || warn "systemctl restart pm2-${PM2_USER} gagal; cek: systemctl status pm2-${PM2_USER}"
    info "Unit systemd pm2-${PM2_USER}.service aktif (hidup lagi setelah reboot)."
  else
    info "Tanpa systemd — lewati startup otomatis (setelah reboot: pm2 resurrect sebagai ${PM2_USER})."
  fi
else
  info "Lewati PM2 (pakai --with-pm2 untuk produksi via PM2)."
fi

# ============================================================ 11. Dev server (opsional)
DEV_PORT=""
DEV_STARTED=0
DEV_PID_FILE="$ROOT_DIR/data/dev-server.pid"
DEV_LOG_FILE="$ROOT_DIR/data/dev-server.log"
DEV_WRAPPER="$ROOT_DIR/data/dev-server.sh"

if [[ "$WITH_DEV" -eq 1 ]]; then
  DEV_PORT="$(env_get .env.local PORT)"
  DEV_PORT="${DEV_PORT:-3000}"
  [[ "$DEV_PORT" =~ ^[0-9]+$ ]] || DEV_PORT=3000

  dev_pid() {
    [[ -f "$DEV_PID_FILE" ]] || return 0
    tr -dc '0-9' < "$DEV_PID_FILE" 2>/dev/null || true
  }
  dev_pid_hidup() {
    local pid
    pid="$(dev_pid)"
    # PID file berisi pemimpin grup proses (setsid), bukan hanya proses Bun:
    # Bun bisa spawn `next dev` sebagai anak, jadi periksa seluruh grup.
    [[ -n "$pid" ]] && kill -0 -- "-$pid" 2>/dev/null
  }
  dev_health() {
    curl -fsS --max-time 5 "http://127.0.0.1:${DEV_PORT}/api/health" >/dev/null 2>&1
  }

  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    warn "Mode dev butuh dependensi terpasang; dev server tidak dijalankan. Jalankan manual: bun --bun run dev"
  elif [[ "$WITH_DEV_START" -ne 1 ]]; then
    info "Mode dev: dev server tidak dijalankan (--no-start). Jalankan manual: bun --bun run dev"
  elif dev_pid_hidup && dev_health; then
    DEV_STARTED=1
    info "Dev server sudah berjalan (PID $(dev_pid)) di http://localhost:${DEV_PORT}."
  elif dev_health; then
    DEV_STARTED=1
    info "Sudah ada server OpenMAIC di http://localhost:${DEV_PORT} — dev server tidak dijalankan ulang."
  else
    LANGKAH="dev: server"
    mkdir -p data
    info "Menjalankan dev server (bun --bun run dev) di latar belakang..."
    # Wrapper mencatat PID-nya sendiri lalu exec Bun, jadi isi PID file tetap
    # valid untuk `kill $(cat data/dev-server.pid)`.
    {
      echo '#!/usr/bin/env bash'
      echo "echo \$\$ > $(printf '%q' "$DEV_PID_FILE")"
      printf 'exec env NEXT_TELEMETRY_DISABLED=1 PORT=%q %q --bun run dev\n' \
        "$DEV_PORT" "$BUN_BIN"
    } > "$DEV_WRAPPER"
    chmod 0755 "$DEV_WRAPPER"
    if [[ "$(id -u)" -eq 0 && "$OWNER_USER" != "root" ]]; then
      chown "$OWNER_USER" "$DEV_WRAPPER" data 2>/dev/null || true
    fi
    # setsid melepas dev server dari sesi installer, sehingga tetap hidup
    # setelah skrip selesai (pola yang sama dengan PM2, tanpa systemd).
    as_owner setsid "$DEV_WRAPPER" >>"$DEV_LOG_FILE" 2>&1 < /dev/null &
    info "Menunggu dev server siap di port ${DEV_PORT} (maks 300 detik)..."
    DEV_OK=0
    for i in {1..300}; do
      if dev_health; then DEV_OK=1; break; fi
      # Beri waktu wrapper menulis PID file; setelah itu berhenti bila seluruh
      # grup proses sudah mati (bukan sekadar health check belum siap).
      if [[ "$i" -gt 5 && -f "$DEV_PID_FILE" ]] && ! dev_pid_hidup; then break; fi
      sleep 1
    done
    if [[ "$(id -u)" -eq 0 && "$OWNER_USER" != "root" ]]; then
      for f in "$DEV_LOG_FILE" "$DEV_PID_FILE"; do
        [[ -e "$f" ]] && chown "$OWNER_USER" "$f" 2>/dev/null || true
      done
    fi
    if [[ "$DEV_OK" -eq 1 ]]; then
      DEV_STARTED=1
      info "Dev server siap: http://localhost:${DEV_PORT} (log: data/dev-server.log)"
    else
      warn "Dev server belum merespons di port ${DEV_PORT}. Lihat: tail -n 40 data/dev-server.log"
      [[ -f "$DEV_LOG_FILE" ]] && tail -n 20 "$DEV_LOG_FILE" >&2 || true
    fi
  fi
fi

# ============================================================ Selesai
LANGKAH="ringkasan"
echo ""
info "Instalasi selesai. Ringkasan:"
info "  Bun ${BUN_TERPASANG} (${BUN_BIN})"
if command -v node >/dev/null 2>&1; then
  info "  Node: $(node -v 2>/dev/null) (tidak dipakai installer; runtime Bun)"
else
  info "  Node: tidak diinstal (Bun-only)"
fi
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  if [[ -n "$PGPORT" ]] && pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1; then
    info "  Postgres ${PG_MAJOR}: OK (localhost:${PGPORT})"
  else
    warn "Postgres ${PG_MAJOR} tidak merespons — cek: sudo systemctl status postgresql"
  fi
fi
if [[ -f public/vendor/maic-importer/index.js ]]; then
  info "  Vendor PPTX: OK"
else
  warn "Vendor PPTX hilang — jalankan: bun run build:packages"
fi
if command -v ffmpeg >/dev/null 2>&1; then
  info "  ffmpeg: OK"
else
  info "  ffmpeg: tidak ada (--no-ffmpeg)"
fi
if [[ -d node_modules/@openai/codex ]]; then
  info "  Codex CLI: OK (auth via UI Pro Workbench: ikon kunci)"
else
  warn "Codex CLI tidak terdeteksi — fitur transport codex-sdk tidak akan jalan."
fi
if [[ "$WITH_ANTIGRAVITY" -eq 1 ]]; then
  if [[ -x "${ROOT_DIR}/.venv-antigravity/bin/python" ]] \
    && "${ROOT_DIR}/.venv-antigravity/bin/python" -c 'import google.antigravity' >/dev/null 2>&1; then
    info "  Antigravity SDK: OK (.venv-antigravity; isi GEMINI_API_KEY)"
  else
    warn "Antigravity SDK tidak terdeteksi — transport antigravity-sdk tidak akan jalan."
  fi
fi
if [[ "$WITH_PLAYWRIGHT" -eq 1 ]]; then
  if [[ -d "${OWNER_HOME}/.cache/ms-playwright" ]]; then
    info "  Playwright Chromium: OK (e2e: bun x playwright test)"
  else
    warn "Playwright Chromium tidak terdeteksi."
  fi
fi
if [[ "$WITH_BUILD" -eq 1 || "$WITH_PM2" -eq 1 ]]; then
  if [[ -d .next ]]; then
    info "  Build produksi: OK (jalankan: bun --bun run start)"
    if [[ "$FAST_BUILD" -eq 1 ]]; then
      info "  Mode cepat: typecheck dilewati (build penuh: ./install.sh --build --no-fast)"
    fi
  else
    warn "Build produksi tidak menghasilkan .next — ulangi: bun --bun run build"
  fi
fi
if [[ "$WITH_DEV" -eq 1 ]]; then
  if [[ "$DEV_STARTED" -eq 1 ]]; then
    info "  Dev server: OK (http://localhost:${DEV_PORT}, log: data/dev-server.log)"
  else
    info "  Dev server: tidak berjalan (mulai manual: bun --bun run dev)"
  fi
fi
if [[ "$WITH_PM2" -eq 1 ]]; then
  if pm2_as_owner pid kelaska 2>/dev/null | grep -qE '^[1-9][0-9]*$'; then
    info "  PM2: OK (proses kelaska; kelola: pm2 logs kelaska | pm2 reload kelaska)"
  else
    warn "PM2 tidak menjalankan kelaska — cek sebagai ${PM2_USER}: pm2 list && pm2 logs kelaska"
  fi
fi
if [[ -f openmaic.yml ]]; then
  info "  Model config: openmaic.yml (secret tetap di .env.local, dirujuk \${VAR})"
else
  info "  Model config: legacy (.env.local/Settings) — buat openmaic.yml untuk default deployment"
fi
echo ""
if [[ -f .env.local ]]; then
  CURRENT_ACCESS_CODE="$(env_get .env.local ACCESS_CODE)"
  if [[ -n "$CURRENT_ACCESS_CODE" ]]; then
    echo "ACCESS_CODE Anda (untuk modal login di browser):"
    echo "  ${CURRENT_ACCESS_CODE}"
    echo ""
  else
    warn "ACCESS_CODE tidak diset — API fail-open (tanpa proteksi)."
  fi
fi
echo "Langkah berikutnya:"
echo "  cd $ROOT_DIR"
echo "  bun --bun run dev     # pengembangan  -> http://localhost:3000"
echo "  bun --bun run build   # build produksi"
echo "  bun --bun run start   # jalankan hasil build -> http://localhost:3000"
if [[ "$WITH_PM2" -eq 1 ]]; then
  echo ""
  echo "PM2 (produksi, runtime Bun):"
  echo "  pm2 logs kelaska    # lihat log"
  echo "  pm2 reload kelaska  # reload tanpa downtime"
  echo "  pm2 stop kelaska    # hentikan"
  echo "  Config: ecosystem.bun.config.cjs"
fi
if [[ "$WITH_DEV" -eq 1 ]]; then
  echo ""
  echo "Mode pengembangan (dev):"
  echo "  curl http://localhost:${DEV_PORT}/api/health    # cek status server"
  echo "  tail -f data/dev-server.log                     # ikuti log"
  echo "  kill -- -\$(cat data/dev-server.pid)             # hentikan dev server"
  echo "  bun --bun run dev                               # jalankan manual (foreground)"
fi
if [[ "$WITH_COLAB" -eq 1 ]]; then
  echo ""
  echo "Colab: ekspos port 3000 ke browser dengan sel Python:"
  echo "  from google.colab import output"
  echo "  output.serve_kernel_port_as_window(3000)"
  echo ""
  echo "Colab: autentikasi Codex (jika pakai transport codex-sdk) dilakukan di"
  echo "  UI Pro Workbench (ikon kunci di header chat pane) via device code —"
  echo "  tidak perlu terminal."
  echo ""
  echo "Colab: jaga runtime tetap hidup (anti-idle) dengan sel Python looping:"
  echo "  from IPython.display import display, Javascript"
  echo "  import threading, time"
  echo "  display(Javascript(\"(function(){if(window.__openmaicKeepAlive)return;window.__openmaicKeepAlive=true;function tick(){try{const x=Math.floor(Math.random()*window.innerWidth),y=Math.floor(Math.random()*window.innerHeight);['mousemove','mousedown','mouseup','click'].forEach(function(t){document.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:x,clientY:y}));window.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:x,clientY:y}));});window.scrollBy(0,1);window.scrollBy(0,-1);document.querySelectorAll('colab-connect-button,colab-toolbar-button,button[aria-label*=\"Connect\" i],button[aria-label*=\"Reconnect\" i]').forEach(function(el){if(el&&!el.disabled)try{el.click();}catch(e){}});fetch('http://localhost:3000/api/health',{mode:'no-cors'}).catch(function(){});console.log('[keep-alive] tick',new Date().toISOString());}catch(e){console.warn('[keep-alive] err',e);}} tick();setInterval(tick,30000);})()\")"
  echo "  def _hb():"
  echo "      while True:"
  echo "          print('[keep-alive] kernel heartbeat', time.strftime('%H:%M:%S'), flush=True); time.sleep(120)"
  echo "  threading.Thread(target=_hb, daemon=True).start()"
fi
echo ""
echo "Catatan:"
echo "  - Installer ini menambahkan 'workspaces' + 'trustedDependencies' ke"
echo "    package.json dan membuat bun.lock. Itu bagian migrasi ke Bun."
echo "  - .env.local berisi secret (600); jangan commit."
echo "  - Isi API key LLM di .env.local; provider/model/slot ada di openmaic.yml"
echo "    (dibuat otomatis dari DEFAULT_MODEL atau katalog OpenCode)."
echo "  - Blok models: di openmaic.yml disegarkan setiap run dari katalog"
echo "    OpenCode/Codex; edit di luar blok itu untuk kustomisasi, lalu:"
echo "    pm2 startOrReload ecosystem.bun.config.cjs --update-env"
echo "  - Ambil ACCESS_CODE kapan saja: grep '^ACCESS_CODE=' .env.local"
echo "  - Node.js/pnpm tidak dipakai. Installer Node lama: ./install-node.sh"
