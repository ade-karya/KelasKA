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
#   1. Paket sistem (apt): hanya yang dipakai installer, Node, dan build native
#      `canvas` (opsi jsdom) — rincian + alasannya di blok APT_PKGS. ffmpeg
#      TIDAK dipasang default (lihat --with-ffmpeg). PostgreSQL 18 dari repo
#      resmi PGDG (apt.postgresql.org) — bukan paket bawaan distro yang
#      tertinggal (Ubuntu 24.04 = PG 16); ganti mayor dengan --pg-major=N.
#   2. Node.js 24 (>= 24.21, sesuai `engines` di package.json) via NodeSource.
#   3. pnpm 12.6.0 via corepack (sesuai `packageManager` di package.json).
#   4. PostgreSQL 18: database + user `openmaic` + password acak.
#   5. OpenCode CLI v2 via https://opencode.ai/v2/install (default terinstal;
#      dilewati bila sudah versi terbaru; bisa dilewati total dengan
#      --no-opencode). Ollama TIDAK diinstal lagi.
#   6. File `.env.local` (dibuat dari template bila belum ada; bila sudah ada
#      hanya dilengkapi variabel yang hilang — tidak menimpa isi user).
#      LLM default: opencode:space-bunny-free (provider `opencode` terdaftar di
#      lib/ai/providers.ts; gateway Zen https://opencode.ai/zen/v1).
#   7. Direktori `data/` untuk classroom store berbasis file.
#   8. Dependensi JS via `pnpm install --frozen-lockfile`
#      (postinstall otomatis build workspace packages + sync vendor importer).
#   9. Verifikasi: vendor bundle PPTX + kontrak Node engine.
#
# Yang SENGAJA tidak dipasang (agar server tetap ringan):
#   - postgresql-contrib: tidak ada `CREATE EXTENSION` di seluruh repo, jadi
#     paket ekstensi hanya menambah bobot tanpa dipakai.
#   - ffmpeg: hanya perlu untuk ekstraksi media lokal (provider `local-ffmpeg`).
#     README menyatakan ffmpeg tidak diperlukan untuk start/menggunakan
#     OpenMAIC. Pasang bila perlu: `./install.sh --with-ffmpeg`.
#   - librsvg2-dev: dukungan SVG di `canvas` (node-canvas) tidak dipakai —
#     render SVG ditangani @napi-rs/canvas yang membawa binary prebuilt-nya.
#   - g++ (sudah ikut build-essential), openssl & python3 untuk generator
#     angka acak (sekarang pakai `node:crypto` + `encodeURIComponent`), dan
#     lsb-release (codename distro dibaca dari /etc/os-release).
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
#   --with-ffmpeg       Instal ffmpeg (ekstraksi material audio/video lokal).
#   --pg-major=N        Mayor PostgreSQL dari PGDG (default: 18, mayor stabil
#                       terbaru — 19 masih beta per Sep 2026).
#   --pg-password=PASS  Paksa password Postgres (default: dibuat acak).
#   -h, --help          Tampilkan bantuan ini.
#
# Idempoten: aman dijalankan ulang. Repo PGDG, paket apt, cluster, role, dan
# database dideteksi lebih dulu; file .env.local yang sudah ada di-backup ke
# `.env.local.bak.<waktu>` sebelum dilengkapi.

set -euo pipefail

# Installer Debian-family (postgresql-common, tzdata, ...) memicu dialog
# debconf yang menggantung di server tanpa TTY. Set sekali di sini, termasuk
# untuk `playwright install --with-deps` yang memanggil apt sendiri.
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- warna & log
if [[ -t 1 ]]; then
  HIJAU='\033[0;32m'; KUNING='\033[0;33m'; MERAH='\033[0;31m'; RESET='\033[0m'
else
  HIJAU=''; KUNING=''; MERAH=''; RESET=''
fi
info()  { echo -e "${HIJAU}[install]${RESET} $*"; }
warn()  { echo -e "${KUNING}[install] peringatan:${RESET} $*" >&2; }
fail()  { FAILED_BY_FAIL=1; echo -e "${MERAH}[install] GAGAL:${RESET} $*" >&2; exit 1; }

# Nama langkah berjalan, supaya kegagalan dari `set -e` (bukan dari fail())
# tetap bisa dicatat. Diperbarui sebelum tiap seksi.
LANGKAH="startup"
FAILED_BY_FAIL=0
on_exit() {
  local rc=$?
  [[ "$rc" -eq 0 ]] && return 0
  if [[ "$FAILED_BY_FAIL" -eq 0 ]]; then
    echo -e "${MERAH}[install] GAGAL:${RESET} berhenti di langkah '${LANGKAH}' (exit ${rc})." >&2
    echo "  Pesan error ada di baris atas. Setelah memperbaikinya, jalankan ulang:" >&2
    echo "    sudo ./install.sh --yes" >&2
  fi
}
trap on_exit EXIT

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
WITH_FFMPEG=0
WITH_OPENCODE=1
PG_PASSWORD="${PG_PASSWORD:-}"
# Mayor Postgres target: 18 = stabil terbaru (19 masih beta per Sep 2026).
PG_MAJOR="${PG_MAJOR:-18}"

tampilkan_help() {
  # Cetak blok komentar header (baris 2 .. baris kosong pertama).
  awk 'NR>1 { if ($0 ~ /^[[:space:]]*$/) exit; sub(/^# ?/, ""); print }' "$0"
  cat <<'EOF'
Contoh:
  sudo ./install.sh --yes
  sudo ./install.sh --yes --build --with-playwright
  sudo ./install.sh --yes --with-ffmpeg          # + ekstraksi media lokal
  sudo ./install.sh --yes --no-postgres          # tanpa Postgres (agent/persistence mati)
  sudo ./install.sh --yes --no-opencode          # tanpa OpenCode CLI
EOF
}

for arg in "$@"; do
  case "$arg" in
    --yes)             ASSUME_YES=1 ;;
    --no-postgres)     WITH_POSTGRES=0 ;;
    --no-install)      WITH_INSTALL=0 ;;
    --build)           WITH_BUILD=1 ;;
    --with-playwright) WITH_PLAYWRIGHT=1 ;;
    --with-ffmpeg)     WITH_FFMPEG=1 ;;
    --with-opencode)   WITH_OPENCODE=1 ;;
    --no-opencode)     WITH_OPENCODE=0 ;;
    --pg-major=*)      PG_MAJOR="${arg#*=}" ;;
    --with-ollama)     fail "Opsi --with-ollama sudah dihapus: Ollama tidak lagi diinstal. OpenMAIC kini memakai OpenCode CLI v2 (opencode:space-bunny-free). Hapus flag tersebut dan ulangi." ;;
    --pg-password=*)   PG_PASSWORD="${arg#*=}" ;;
    -h|--help)         tampilkan_help; exit 0 ;;
    *) fail "Opsi tidak dikenal: $arg (lihat --help)." ;;
  esac
done
[[ "$PG_MAJOR" =~ ^[0-9]+$ ]] || fail "--pg-major harus angka (contoh: --pg-major=18), bukan '$PG_MAJOR'."

# ---------------------------------------------------------------- sudo / root
if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "Jalankan sebagai root atau instal sudo dulu."
  SUDO="sudo"
fi

# Helper: jalankan perintah sebagai root, toleran bila $SUDO kosong (dipakai
# dari pipe installer). Bentuk "| $SUDO -E bash -" rusak saat $SUDO=""
# (menjadi "| -E bash -" -> "-E: command not found").
run_as_root() {
  if [[ -n "${SUDO:-}" ]]; then
    $SUDO "$@"
  else
    "$@"
  fi
}
run_pipe_as_root() { run_as_root -E bash -; }

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

# ---------------------------------------------------------------- util kecil
# Hex acak sepanjang <n> byte. Pakai `node:crypto`, bukan openssl/python3,
# supaya script tidak perlu paket CLI tambahan (Node sudah wajib di step 2).
rand_hex() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(Number(process.argv[1])).toString("hex"))' "$1"
}

# Percent-encode untuk userinfo DATABASE_URL. Setara urllib.parse.quote(safe="")
# yang dipakai versi lama script ini.
url_encode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]).replace(/[!'"'"'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))' "$1"
}

# Nilai terakhir suatu var dari file env; "" bila tidak ada, dikomentari, atau
# kosong. Baris BERKOMENTAR ikut diabaikan supaya nilainya tidak dipakai diam-diam.
env_get() {
  local file="$1" key="$2" line=""
  [[ -f "$file" ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -1 || true)"
  line="${line#*=}"
  line="${line#"${line%%[![:space:]]*}"}"   # trim kiri
  line="${line%"${line##*[![:space:]]}"}"   # trim kanan
  # buang satu pasang tanda kutip pembungkus
  if [[ "$line" == \"*\" || "$line" == \'*\' ]]; then line="${line:1:${#line}-2}"; fi
  printf '%s' "$line"
}

# Cek versi semver 3 angka: true bila <punya> >= <minimum>.
node_version_gte() {
  local have="$1" want="$2" h1 h2 h3 w1 w2 w3
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

# ------------------------------------------------------- deteksi distro (apt)
if ! command -v apt-get >/dev/null 2>&1; then
  fail "Script ini untuk Ubuntu/Debian (butuh apt-get). Di distro lain, samakan manual: Node 24 + pnpm 12.6 + Postgres + paket build di Dockerfile."
fi

# ---------------------------------------------------------------- konfirmasi
if [[ "$ASSUME_YES" -ne 1 ]]; then
  # Catatan: pakai `if`, bukan `[[ ... ]] && echo` — perintah `&&`/`||` di
  # tingkat atas yang berakhir false akan membuat `set -e` mematikan script.
  APT_RINGKAS="build tools + cairo/pango (build canvas), git, curl, ca-certificates"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then APT_RINGKAS+=", gnupg"; fi
  if [[ "$WITH_FFMPEG" -eq 1 ]]; then APT_RINGKAS+=", ffmpeg"; fi
  echo "Installer OpenMAIC akan:"
  echo "  - apt install: ${APT_RINGKAS}"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    echo "  - setup database Postgres 'openmaic' di PG ${PG_MAJOR} (repo PGDG)"
  else
    echo "  - tanpa PostgreSQL (--no-postgres): agent runtime + persistence mati"
  fi
  echo "  - instal Node.js 24 (bila belum memenuhi syarat) + pnpm 12.6.0"
  if [[ "$WITH_OPENCODE" -eq 1 ]]; then
    echo "  - instal OpenCode CLI v2"
  fi
  if [[ "$WITH_BUILD" -eq 1 ]]; then
    echo "  - jalankan npm run build sebagai pembuktian"
  fi
  echo "  - buat/lengkapi .env.local (DEFAULT_MODEL=opencode:space-bunny-free), direktori data/, pnpm install"
  # Tanpa TTY, `read` langsung gagal dan `set -e` mematikan script tanpa pesan
  # yang berguna — lebih baik gagal dengan instruksi yang jelas.
  [[ -t 0 ]] || fail "Tidak ada TTY untuk konfirmasi. Jalankan ulang dengan --yes (non-interaktif)."
  read -rp "Lanjut? [y/N] " jawab
  [[ "$jawab" =~ ^[yY]$ ]] || { info "Dibatalkan."; exit 0; }
fi

# ============================================================ 1. Paket sistem
LANGKAH="apt: paket sistem"
# Rincian singkat alasan tiap paket (lihat juga blok header).
#   ca-certificates  TLS untuk curl/Node/pnpm
#   curl             unduh installer NodeSource/OpenCode/PGDG
#   git              update repo di server (npm install tidak butuh)
#   python3          bahasa node-gyp untuk build `canvas`
#   build-essential  gcc/make untuk build `canvas` (sudah termasuk g++)
#   pkg-config       cari cairo/pango saat build `canvas`
#   lib*-dev         header cairo/pango/jpeg/gif untuk build `canvas`
#   gnupg            dearmor kunci PGDG (hanya saat --no-postgres tidak dipakai)
APT_PKGS=(
  ca-certificates curl git
  python3 build-essential pkg-config
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev
)
if [[ "$WITH_POSTGRES" -eq 1 ]]; then APT_PKGS+=(gnupg); fi

info "Memperbarui daftar paket (apt-get update)..."
run_as_root apt-get update -o Acquire::Retries=3
info "Menginstal paket sistem via apt: ${APT_PKGS[*]}"
run_as_root apt-get install -y -o Acquire::Retries=3 "${APT_PKGS[@]}"

# ffmpeg hanya untuk provider `local-ffmpeg` (ekstraksi transcript audio/video).
# README: tidak diperlukan untuk start/menggunakan OpenMAIC → opt-in.
if [[ "$WITH_FFMPEG" -eq 1 ]]; then
  info "Menginstal ffmpeg (ffprobe ikut dalam paket ffmpeg)..."
  run_as_root apt-get install -y -o Acquire::Retries=3 ffmpeg
fi

# ------------------------------------------------- PostgreSQL via PGDG
# Paket `postgresql` bawaan distro tertinggal jauh (Ubuntu 24.04 = PG 16).
# Target: PG ${PG_MAJOR} = mayor stabil terbaru (19 masih beta per Sep 2026).
# Sumber resmi: https://www.postgresql.org/download/linux/ubuntu/
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  LANGKAH="apt: repo PGDG"
  # Deteksi via isi file sumber, bukan `apt-cache policy | grep -q`: dengan
  # `set -o pipefail`, grep -q keluar saat match pertama dan membuat apt-cache
  # kena SIGPIPE (status 141) sehingga pipeline dianggap gagal — repo yang
  # sudah ada lalu ditambahkan ulang tiap run.
  PGDG_LIST=/etc/apt/sources.list.d/pgdg.list
  PGDG_KEYRING=/usr/share/keyrings/postgresql.gpg
  # Loop eksplisit (bukan `grep -rqs ... /etc/apt/sources.list /etc/apt/...`):
  # bila /etc/apt/sources.list tidak ada (minimal image), grep -r keluar dengan
  # status 2 dan repo yang sudah terdaftar dianggap belum ada.
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
    # Unduh kunci ke file sementara dulu: `curl | gpg -o` yang gagal di tengah
    # jalan pernah meninggalkan keyring 0 byte yang menggagalkan apt selamanya.
    KEY_TMP="$(mktemp)"
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$KEY_TMP"
    run_as_root gpg --batch --yes --dearmor -o "$PGDG_KEYRING" "$KEY_TMP"
    rm -f "$KEY_TMP"
    run_as_root chmod 0644 "$PGDG_KEYRING"
    # Codename distro dari /etc/os-release (paket lsb-release tidak dipakai).
    # shellcheck disable=SC1091  # /etc/os-release selalu ada di Ubuntu/Debian
    CODENAME="$(. /etc/os-release 2>/dev/null && printf '%s' "${VERSION_CODENAME:-$UBUNTU_CODENAME}")"
    [[ -n "$CODENAME" ]] || fail "Tidak bisa membaca VERSION_CODENAME dari /etc/os-release (Paket lsb-release sengaja tidak dipakai)."
    echo "deb [signed-by=$PGDG_KEYRING] https://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
      | run_as_root tee "$PGDG_LIST" >/dev/null
    run_as_root apt-get update -o Acquire::Retries=3
  fi
  LANGKAH="apt: PostgreSQL ${PG_MAJOR}"
  info "Menginstal PostgreSQL ${PG_MAJOR} (postgresql-contrib sengaja tidak: tidak ada CREATE EXTENSION di repo)..."
  run_as_root apt-get install -y -o Acquire::Retries=3 "postgresql-${PG_MAJOR}"
fi

# ============================================================ 2. Node.js >= 24.21
# Syarat mengikuti `engines` di package.json (>= 24.21.0). Cek major saja
# tidak cukup: Node 24.0-24.20 lolos cek major tapi gagal kontrak engine.
LANGKAH="Node.js"
NEED_NODE=1
NODE_MIN_WANT="24.21.0"
if command -v node >/dev/null 2>&1; then
  NODE_MIN_WANT="$(node -p "try{require('./package.json').engines.node.replace(/[^0-9.]/g,'')}catch(e){'24.21.0'}" 2>/dev/null || echo '24.21.0')"
  [[ "$NODE_MIN_WANT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || NODE_MIN_WANT="24.21.0"
fi
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
  run_as_root apt-get install -y -o Acquire::Retries=3 nodejs
  # `command -v node` bisa masih menunjuk node lama di PATH user (mis. nvm),
  # jadi verifikasi ulang versi efektif — `command -v node` saja tak cukup.
  node -v >/dev/null 2>&1 || fail "Instalasi Node.js gagal: 'node' tidak ada di PATH."
  NODE_V="$(node -v | sed 's/^v//')"
  node_version_gte "$NODE_V" "$NODE_MIN_WANT" \
    || fail "Node.js yang dipakai PATH masih $NODE_V (butuh >= $NODE_MIN_WANT). Perbaiki PATH (mis. unset nvm) lalu ulangi."
fi
NPM_V="$(npm -v 2>/dev/null || echo '?')"
info "Node $(node -v), npm $NPM_V."

# ============================================================ 3. pnpm 12.6.0
# Versi dikunci mengikuti kolom `packageManager` di package.json (Dockerfile
# memakai cara yang sama lewat corepack).
LANGKAH="pnpm via corepack"
PNPM_WANT="$(node -p "require('./package.json').packageManager || ''" | sed 's/.*pnpm@//; s/+.*//')"
[[ -n "$PNPM_WANT" ]] || PNPM_WANT="12.6.0"
info "Menyiapkan pnpm@$PNPM_WANT via corepack..."
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
run_as_root corepack enable >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 \
  || warn "corepack enable gagal;=pnpm mungkin tetap tersedia lewat npm."
# corepack baru lebih suka `install --global`; `prepare --activate` dipakai
# sebagai fallback untuk corepack lama.
corepack install --global "pnpm@$PNPM_WANT" >/dev/null 2>&1 \
  || corepack prepare "pnpm@$PNPM_WANT" --activate \
  || fail "corepack gagal menyiapkan pnpm@$PNPM_WANT."
hash -r 2>/dev/null || true
command -v pnpm >/dev/null 2>&1 \
  || fail "pnpm tidak ditemukan setelah corepack. Pasang manual: npm i -g pnpm@$PNPM_WANT"
info "pnpm $(pnpm -v)."

# ============================================================ 4. PostgreSQL
LANGKAH="PostgreSQL ${PG_MAJOR}"
DATABASE_URL_VALUE=""
PGPORT=""
PG_PASSWORD_FORCED=0
PG_PASSWORD_GENERATED=0
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  info "Menyiapkan PostgreSQL ${PG_MAJOR}..."

  # Nyalakan service (tahan terhadap lingkungan tanpa systemd).
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    run_as_root systemctl enable --now postgresql || warn "systemctl postgresql gagal; lanjutkan, cek manual."
  elif command -v service >/dev/null 2>&1; then
    run_as_root service postgresql start || warn "'service postgresql start' gagal; lanjutkan, cek manual."
  else
    run_as_root pg_ctlcluster "${PG_MAJOR}" main start \
      || warn "pg_ctlcluster ${PG_MAJOR} gagal; lanjutkan, cek manual."
  fi
  # Port cluster PG ${PG_MAJOR}/main (5432 bila bebas, atau 5433 bila 5432
  # masih dipakai cluster lama). Semua perintah psql di bawah memakai port ini.
  # Paket postgresql-${PG_MAJOR} biasanya membuat cluster main otomatis, tapi
  # cluster bisa hilang (pernah di-drop manual) sementara paketnya tetap
  # terinstal — pastikan ada sebelum lanjut.
  if ! pg_lsclusters 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main" {found=1} END {exit !found}'; then
    info "Cluster ${PG_MAJOR}/main belum ada — membuat via pg_createcluster..."
    if run_as_root pg_createcluster "${PG_MAJOR}" main; then
      run_as_root pg_ctlcluster "${PG_MAJOR}" main start \
        || warn "pg_ctlcluster ${PG_MAJOR} gagal; setup role/DB mungkin perlu dijalankan manual."
    else
      warn "pg_createcluster ${PG_MAJOR} gagal; setup role/DB dilewati, buat manual."
    fi
  fi
  PGPORT="$(pg_lsclusters 2>/dev/null | awk -v v="${PG_MAJOR}" '$1==v && $2=="main" {print $3}' | head -1 || true)"
  if [[ "$PGPORT" =~ ^[0-9]+$ ]]; then
    info "Cluster PostgreSQL ${PG_MAJOR}/main di port ${PGPORT}."
    pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1 \
      || warn "Postgres belum merespons di localhost:${PGPORT} (pg_isready gagal). Setup role/DB mungkin perlu dijalankan manual."
  else
    warn "Cluster PostgreSQL ${PG_MAJOR}/main tidak ditemukan — lewati setup role/DB. Buat manual: sudo pg_createcluster ${PG_MAJOR} main && sudo pg_ctlcluster ${PG_MAJOR} main start"
    PGPORT=""
  fi

  if [[ -n "$PGPORT" ]]; then
  # Password: idempoten. Jangan putar password tiap run — itu merusak
  # DATABASE_URL di .env.local yang sudah ada (pastikan_var_env tidak menimpa,
  # tapi ALTER ROLE sudah mengganti password di DB -> auth gagal berikutnya).
  # Urutan: --pg-password / PG_PASSWORD dipaksa > pakai ulang password dari
  # .env.local yang ada > baru generate acak.
  if [[ -n "$PG_PASSWORD" ]]; then PG_PASSWORD_FORCED=1; fi
  if [[ "$PG_PASSWORD_FORCED" -eq 0 && -f .env.local ]]; then
    EXISTING_PG_PASS="$(env_get .env.local DATABASE_URL \
      | sed -E -n 's|^postgres(ql)?://openmaic:([^@]*)@.*|\2|p')"
    if [[ -n "$EXISTING_PG_PASS" ]]; then
      PG_PASSWORD="$EXISTING_PG_PASS"
      info "Memakai ulang password Postgres dari .env.local yang ada (idempoten)."
    fi
  fi
  if [[ -z "$PG_PASSWORD" ]]; then
    PG_PASSWORD="$(rand_hex 16)"
    PG_PASSWORD_GENERATED=1
  fi
  # Escape untuk SQL (gandakan kutip satu) dan untuk URL (percent-encode).
  PG_SQL_ESCAPED="${PG_PASSWORD//\'/\'\'}"
  PG_URL_ENCODED="$(url_encode "$PG_PASSWORD")"

  # Buat role + database bila belum ada (idempoten). Semua via port cluster aktif.
  if pg_as_postgres psql -p "$PGPORT" -tAc "SELECT 1 FROM pg_roles WHERE rolname='openmaic'" | grep -qx 1; then
    info "Role Postgres 'openmaic' sudah ada."
  else
    pg_as_postgres psql -p "$PGPORT" -c "CREATE ROLE openmaic LOGIN PASSWORD '${PG_SQL_ESCAPED}'"
    info "Role Postgres 'openmaic' dibuat."
  fi
  # Selaraskan password HANYA bila password dipaksa (--pg-password/PG_PASSWORD)
  # atau baru digenerate untuk install pertama. Run ulang tanpa flag memakai
  # ulang password lama sehingga tidak ada ALTER yang merusak .env.local.
  if [[ "$PG_PASSWORD_FORCED" -eq 1 || "$PG_PASSWORD_GENERATED" -eq 1 ]]; then
    pg_as_postgres psql -p "$PGPORT" -c "ALTER ROLE openmaic LOGIN PASSWORD '${PG_SQL_ESCAPED}'"
  fi
  if pg_as_postgres psql -p "$PGPORT" -tAc "SELECT 1 FROM pg_database WHERE datname='openmaic'" | grep -qx 1; then
    info "Database 'openmaic' sudah ada."
  else
    pg_as_postgres createdb -p "$PGPORT" -O openmaic openmaic
    info "Database 'openmaic' dibuat."
  fi
  pg_as_postgres psql -p "$PGPORT" -d openmaic -c "GRANT ALL PRIVILEGES ON SCHEMA public TO openmaic;" >/dev/null

  DATABASE_URL_VALUE="postgres://openmaic:${PG_URL_ENCODED}@localhost:${PGPORT}/openmaic"
  if [[ "$PG_PASSWORD_GENERATED" -eq 1 ]]; then
    info "Password Postgres dibuat acak dan disimpan di .env.local (DATABASE_URL)."
  fi
  fi # tutup: if [[ -n "$PGPORT" ]]
else
  info "Lewati PostgreSQL (--no-postgres): agent runtime + persistence tetap nonaktif."
fi

# ============================================================ 5. .env.local
LANGKAH=".env.local"
# Template dev: LLM default via OpenCode CLI v2 / Zen (provider `opencode`
# terdaftar di lib/ai/providers.ts). Nilai rahasia dibuat acak per server.
# OPENCODE_BIN diisi belakangan (step 8, setelah CLI terinstal) lalu di-backfill.
ACCESS_CODE_NEW="$(rand_hex 24)"      # 48 char, di atas minimum 16
DEV_TOKEN_NEW="$(rand_hex 16)"

tulis_template_env() {
  local db_url="$1" access_code="$2" dev_token="$3" agent_runtime="$4" opencode_bin="$5"
  cat <<EOF
# =============================================================================
# OpenMAIC dev/prod lokal — dibuat oleh install.sh pada $(date -u +%Y-%m-%d)
# LLM default: OpenCode CLI v2 (provider 'opencode' terdaftar di
# lib/ai/providers.ts, dieksekusi lokal pola nexu-io/open-design).
# CLI diinstal via: curl -fsSL https://opencode.ai/v2/install | bash
# Default (opencode:space-bunny-free) adalah model FREE Zen: TIDAK butuh
#   opencode auth login
# karena eksekusi terjadi di dalam klien opencode, jadi instalasi langsung
# bisa dipakai tanpa kredensial. Untuk model BERBAYAR, set DEFAULT_MODEL ke
# id dari `opencode models` (mis. opencode:big-pickle) setelah auth login.
# Dokumentasi semua variabel: lihat .env.example
# =============================================================================

# --- LLM default (OpenCode CLI v2) ---------------------------------------------
# Harus \`provider:model\` dengan provider terdaftar; tanpa ini resolveModel throw.
DEFAULT_MODEL=opencode:space-bunny-free
# Route eksplisit maic-agent-driver (wajib + \`api\` saat agent runtime aktif).
# CATATAN: driver (pi runner) memanggil HTTP OpenAI-compatible + function tools,
# yang tidak bisa dipenuhi eksekusi CLI. Driver memakai model berbayar
# (default opencode:space-bunny-free) via OPENCODE_API_KEY; tanpa key, runtime agen
# gagal auth. Bila hanya perlu generasi teks, matikan
# OPENMAIC_AGENT_RUNTIME_ENABLED.
MODEL_ROUTES='{"maic-agent-driver":{"model":"opencode:space-bunny-free","api":"openai-completions"}}'

# --- OpenCode CLI (eksekusi lokal, tanpa API key untuk model FREE) -------------
# Server memanggil binary ini per request (prompt via stdin, JSON via stdout).
# Path absolut menghindari masalah PATH pada service. Kosong = auto-discovery
# (OPENCODE_BIN, PATH, ~/.opencode/bin). Timeout per panggilan CLI.
OPENCODE_BIN=${opencode_bin}
# OPENCODE_CLI_TIMEOUT_MS=600000
# Opsional (hanya untuk pemakaian HTTP/gateway langsung, bukan CLI):
# OPENCODE_API_KEY=
# OPENCODE_BASE_URL=https://opencode.ai/zen/v1
# OPENCODE_MODELS=space-bunny-free

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
# Bila yang ada hanya versi BERKOMENTARI (`# KEY=...`, jejak template
# --no-postgres), baris itu diaktifkan ulang dengan nilai di sini — bukan
# ditumpuk sebagai duplikat yang saling bertabrakan saat .env.local dibaca.
pastikan_var_env() {
  local file="$1" key="$2" value="$3" escaped
  if grep -qE "^[[:space:]]*${key}=" "$file"; then return 0; fi
  if [[ -n "$value" ]] && grep -qE "^[[:space:]]*#[[:space:]]*${key}=" "$file"; then
    escaped="${value//&/\\&}"
    escaped="${escaped//|/\\|}"
    sed -i -E "s|^[[:space:]]*#[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# Agent runtime aktif tanpa DATABASE_URL = warning [config] di setiap boot
# (lib/server/config-validation.ts). Jadi nyalakan hanya bila DB-nya ada.
set_agent_runtime_flag() {
  local enabled="$1" reason="$2"
  if grep -qE "^[[:space:]]*OPENMAIC_AGENT_RUNTIME_ENABLED=${enabled}$" .env.local; then return 0; fi
  sed -i -E "s|^[[:space:]]*OPENMAIC_AGENT_RUNTIME_ENABLED=.*|OPENMAIC_AGENT_RUNTIME_ENABLED=${enabled}|" .env.local
  info "OPENMAIC_AGENT_RUNTIME_ENABLED=${enabled} (${reason})."
}

if [[ ! -f .env.local ]]; then
  info "Membuat .env.local baru dari template..."
  if [[ -n "$DATABASE_URL_VALUE" ]]; then
    tulis_template_env "$DATABASE_URL_VALUE" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "true" "" > .env.local
  else
    tulis_template_env "" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "false" "" > .env.local
    # Tanpa Postgres, seluruh blok persistence dikomentari. Pola harus cocok
    # dengan nilai APA PUN (template mengisinya dengan token acak), bukan hanya
    # baris kosong — dulu `PERSISTENCE_DEV_TOKEN=` tidak pernah kena dan tetap
    # aktif padahal tidak ada database.
    sed -i -E -e 's|^(DATABASE_URL=.*)$|# \1|' \
           -e 's|^(PERSISTENCE_DEV_TOKEN=.*)$|# \1|' \
           -e 's|^(NEXT_PUBLIC_PERSISTENCE=.*)$|# \1|' \
           -e 's|^(NEXT_PUBLIC_PERSISTENCE_TOKEN=.*)$|# \1|' .env.local
    if [[ "$WITH_POSTGRES" -eq 1 ]]; then
      warn "Postgres ${PG_MAJOR} tidak siap (cluster/port tidak terdeteksi) — .env.local dibuat TANPA persistence. Jalankan: sudo pg_createcluster ${PG_MAJOR} main && sudo pg_ctlcluster ${PG_MAJOR} main start, lalu ulangi ./install.sh."
    fi
  fi
  chmod 600 .env.local
  info ".env.local dibuat (hak akses 600 karena berisi secret)."
else
  info ".env.local sudah ada — dilengkapi tanpa menimpa nilai Anda..."
  cp .env.local ".env.local.bak.$(date +%Y%m%d-%H%M%S)"
  # Migrasi ke default OpenCode CLI v2 (space-bunny-free):
  # - ollama:* (Ollama tidak lagi diinstal) -> default baru.
  # - opencode:big-pickle / opencode:muse-spark-1.3-contributor-free
  #   (default lama) -> default baru.
  # - opencode:gpt-6-luna -> default baru. Model id ini TIDAK ada di katalog
  #   opencode (hanya `opencode-go/gpt-6-luna`), jadi CLI menolak dengan
  #   `provider.no-route: Model unavailable` dan tidak akan pernah berhasil;
  #   setiap pemanggilan hanya menghasilkan exit 1 yang sama.
  # Nilai kustom milik user (provider/model lain) tidak disentuh.
  if grep -qE '^[[:space:]]*DEFAULT_MODEL=ollama:' .env.local; then
    sed -i -E 's|^[[:space:]]*DEFAULT_MODEL=ollama:.*|DEFAULT_MODEL=opencode:space-bunny-free|' .env.local
    info "DEFAULT_MODEL dimigrasi ollama -> opencode:space-bunny-free."
  elif grep -qE '^[[:space:]]*DEFAULT_MODEL=opencode:gpt-6-luna[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*DEFAULT_MODEL=opencode:gpt-6-luna[[:space:]]*$|DEFAULT_MODEL=opencode:space-bunny-free|' .env.local
    info "DEFAULT_MODEL dimigrasi opencode:gpt-6-luna -> opencode:space-bunny-free (model lama tidak tersedia)."
  elif grep -qE '^[[:space:]]*DEFAULT_MODEL=opencode:big-pickle[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*DEFAULT_MODEL=opencode:big-pickle[[:space:]]*$|DEFAULT_MODEL=opencode:space-bunny-free|' .env.local
    info "DEFAULT_MODEL dimigrasi opencode:big-pickle -> opencode:space-bunny-free."
  elif grep -qE '^[[:space:]]*DEFAULT_MODEL=opencode:muse-spark-1\.3-contributor-free[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*DEFAULT_MODEL=opencode:muse-spark-1\.3-contributor-free[[:space:]]*$|DEFAULT_MODEL=opencode:space-bunny-free|' .env.local
    info "DEFAULT_MODEL dimigrasi opencode:muse-spark-1.3-contributor-free -> opencode:space-bunny-free."
  fi
  if grep -qE '^[[:space:]]*MODEL_ROUTES=.*ollama:' .env.local; then
    sed -i -E '/^[[:space:]]*MODEL_ROUTES=/ s|ollama:[^"\\} ]*|opencode:space-bunny-free|g' .env.local
    info "MODEL_ROUTES dimigrasi ollama -> opencode:space-bunny-free."
  elif grep -qE '^[[:space:]]*MODEL_ROUTES=.*opencode:gpt-6-luna' .env.local; then
    sed -i -E '/^[[:space:]]*MODEL_ROUTES=/ s|opencode:gpt-6-luna|opencode:space-bunny-free|g' .env.local
    info "MODEL_ROUTES dimigrasi opencode:gpt-6-luna -> opencode:space-bunny-free (model lama tidak tersedia)."
  elif grep -qE '^[[:space:]]*MODEL_ROUTES=.*opencode:big-pickle' .env.local; then
    sed -i -E '/^[[:space:]]*MODEL_ROUTES=/ s|opencode:big-pickle|opencode:space-bunny-free|g' .env.local
    info "MODEL_ROUTES dimigrasi opencode:big-pickle -> opencode:space-bunny-free."
  elif grep -qE '^[[:space:]]*MODEL_ROUTES=.*opencode:muse-spark-1\.3-contributor-free' .env.local; then
    sed -i -E '/^[[:space:]]*MODEL_ROUTES=/ s|opencode:muse-spark-1\.3-contributor-free|opencode:space-bunny-free|g' .env.local
    info "MODEL_ROUTES dimigrasi opencode:muse-spark-1.3-contributor-free -> opencode:space-bunny-free."
  fi
  # OPENCODE_MODELS: pastikan_var_env di bawah tidak menimpa nilai yang sudah
  # ada, jadi pin default lama (big-pickle / muse-spark-1.3-contributor-free /
  # gpt-6-luna) harus dimigrasi eksplisit di sini. Nilai kustom lain tidak
  # disentuh.
  if grep -qE '^[[:space:]]*OPENCODE_MODELS=big-pickle[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*OPENCODE_MODELS=big-pickle[[:space:]]*$|OPENCODE_MODELS=space-bunny-free|' .env.local
    info "OPENCODE_MODELS dimigrasi big-pickle -> space-bunny-free."
  elif grep -qE '^[[:space:]]*OPENCODE_MODELS=gpt-6-luna[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*OPENCODE_MODELS=gpt-6-luna[[:space:]]*$|OPENCODE_MODELS=space-bunny-free|' .env.local
    info "OPENCODE_MODELS dimigrasi gpt-6-luna -> space-bunny-free (model lama tidak tersedia)."
  elif grep -qE '^[[:space:]]*OPENCODE_MODELS=muse-spark-1\.3-contributor-free[[:space:]]*$' .env.local; then
    sed -i -E 's|^[[:space:]]*OPENCODE_MODELS=muse-spark-1\.3-contributor-free[[:space:]]*$|OPENCODE_MODELS=space-bunny-free|' .env.local
    info "OPENCODE_MODELS dimigrasi muse-spark-1.3-contributor-free -> space-bunny-free."
  fi
  pastikan_var_env .env.local DEFAULT_MODEL "opencode:space-bunny-free"
  pastikan_var_env .env.local MODEL_ROUTES '{"maic-agent-driver":{"model":"opencode:space-bunny-free","api":"openai-completions"}}'
  pastikan_var_env .env.local OPENCODE_BIN ""
  # OPENCODE_API_KEY/BASE_URL opsional (hanya HTTP langsung); jangan buat key
  # kosong yang mengesankan wajib — cukup pastikan pin model tersedia.
  pastikan_var_env .env.local OPENCODE_MODELS "space-bunny-free"
  pastikan_var_env .env.local ACCESS_CODE "$ACCESS_CODE_NEW"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    if [[ "$PG_PASSWORD_FORCED" -eq 1 && -n "$DATABASE_URL_VALUE" ]]; then
      # Password dipaksa via --pg-password/PG_PASSWORD: sinkronkan file agar
      # tidak stale (kasus satu-satunya DATABASE_URL boleh ditimpa).
      # Escape & dan | agar aman sebagai replacement sed (password sudah
      # URL-encode, jadi seharusnya tidak ada, tapi tetap amankan).
      DB_URL_SED_ESCAPED="${DATABASE_URL_VALUE//&/\\&}"
      DB_URL_SED_ESCAPED="${DB_URL_SED_ESCAPED//|/\\|}"
      if grep -qE '^[[:space:]]*DATABASE_URL=' .env.local; then
        sed -i -E "s|^[[:space:]]*DATABASE_URL=.*|DATABASE_URL=${DB_URL_SED_ESCAPED}|" .env.local
      else
        pastikan_var_env .env.local DATABASE_URL "$DATABASE_URL_VALUE"
      fi
      info "DATABASE_URL di .env.local disinkronkan dengan password yang dipaksa."
    else
      pastikan_var_env .env.local DATABASE_URL "$DATABASE_URL_VALUE"
    fi
    # PERSISTENCE_DEV_TOKEN yang baru dibuat harus dicocokkan dengan token
    # publik, kalau tidak tiap request persistence berakhir 401.
    TOKEN_LAMA="$(env_get .env.local PERSISTENCE_DEV_TOKEN)"
    if [[ -z "$TOKEN_LAMA" ]]; then
      pastikan_var_env .env.local PERSISTENCE_DEV_TOKEN "$DEV_TOKEN_NEW"
      if grep -qE '^[[:space:]]*NEXT_PUBLIC_PERSISTENCE_TOKEN=' .env.local; then
        TOKEN_SED_ESCAPED="${DEV_TOKEN_NEW//&/\\&}"
        sed -i -E "s|^[[:space:]]*NEXT_PUBLIC_PERSISTENCE_TOKEN=.*|NEXT_PUBLIC_PERSISTENCE_TOKEN=${TOKEN_SED_ESCAPED}|" .env.local
        info "NEXT_PUBLIC_PERSISTENCE_TOKEN dicocokkan dengan PERSISTENCE_DEV_TOKEN yang baru."
      fi
    fi
    pastikan_var_env .env.local NEXT_PUBLIC_PERSISTENCE "1"
    # Token publik: pakai yang sudah ada; kalau tidak, samakan dengan token
    # server (pastikan_var_env juga mengaktifkan kembali baris berkomentar,
    # jadi blok persistence tidak berakhir dengan dua baris yang bertabrakan).
    if ! grep -qE '^[[:space:]]*NEXT_PUBLIC_PERSISTENCE_TOKEN=' .env.local; then
      SERVER_TOKEN="$(env_get .env.local PERSISTENCE_DEV_TOKEN)"
      pastikan_var_env .env.local NEXT_PUBLIC_PERSISTENCE_TOKEN "$SERVER_TOKEN"
    fi
    pastikan_var_env .env.local PERSISTENCE_ALLOW_INSECURE_DEV_AUTH "true"
    pastikan_var_env .env.local COOKIE_SECURE "0"
    # Nyalakan agent runtime HANYA bila DATABASE_URL benar-benar terisi;
    # kalau tidak, boot memunculkan warning [config] terus-menerus.
    DB_URL_ISI="$(env_get .env.local DATABASE_URL)"
    if [[ -n "$DB_URL_ISI" ]]; then
      set_agent_runtime_flag true "DATABASE_URL tersedia"
      pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "true"
    else
      set_agent_runtime_flag false "DATABASE_URL kosong"
      pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "false"
      warn "DATABASE_URL kosong di .env.local — OPENMAIC_AGENT_RUNTIME_ENABLED dimatikan agar boot tidak memunculkan warning [config]."
    fi
  else
    # --no-postgres: flag aktif tanpa DATABASE_URL = warning [config] tiap boot
    # (lib/server/config-validation.ts), jadi turunkan. Nilai lain dibiarkan.
    DB_URL_ISI="$(env_get .env.local DATABASE_URL)"
    if [[ -z "$DB_URL_ISI" ]]; then
      set_agent_runtime_flag false "Postgres dilewati (--no-postgres)"
      pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "false"
    fi
    warn "Postgres dilewati: agent runtime/persistence tidak disiapkan (nilai .env.local Anda tidak diubah)."
  fi
fi

# ============================================================ 6. Direktori data
LANGKAH="direktori data/"
info "Menyiapkan direktori data/..."
mkdir -p data/classrooms data/classroom-jobs

# ============================================================ 7. Dependensi JS
if [[ "$WITH_INSTALL" -eq 1 ]]; then
  LANGKAH="pnpm install"
  info "Menjalankan pnpm install --frozen-lockfile (postinstall: build packages + sync vendor)..."
  # Batas heap eksplisit seperti Dockerfile agar predictable di server kecil.
  NODE_OPTIONS="--max-old-space-size=3072" pnpm install --frozen-lockfile

  LANGKAH="verifikasi dependensi"
  info "Verifikasi vendor bundle PPTX..."
  node scripts/assert-vendor-maic-importer.mjs

  info "Verifikasi kontrak Node engine..."
  node scripts/check-node-engine-contract.mjs
else
  info "Lewati pnpm install (--no-install). Jalankan manual nanti: pnpm install"
fi

# ============================================================ 8. OpenCode CLI
if [[ "$WITH_OPENCODE" -eq 1 ]]; then
  LANGKAH="OpenCode CLI v2"
  # Instal sebagai user pemilik sesi (bukan root) agar binary + auth milik user
  # yang benar; installer v2 menaruhnya di ~/.opencode/bin.
  OPENCODE_TARGET_USER="${SUDO_USER:-$(id -un)}"
  # `eval echo ~user` hanya berhasil bila user ada; getent lebih jujur.
  OPENCODE_TARGET_HOME="$(getent passwd "$OPENCODE_TARGET_USER" 2>/dev/null | cut -d: -f6 || true)"
  if [[ -z "$OPENCODE_TARGET_HOME" ]]; then
    warn "User '${OPENCODE_TARGET_USER}' tidak ada di /etc/passwd — OpenCode CLI dipasang ke HOME user saat ini ($(id -un))."
    OPENCODE_TARGET_USER="$(id -un)"
    OPENCODE_TARGET_HOME="$HOME"
  fi
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
    OPENCODE_HAVE="$("$OPENCODE_BIN_EXISTING" --version 2>/dev/null | awk '{print $NF}' | sed 's/^v//' || true)"
    OPENCODE_LATEST="$(curl -fsSL --max-time 20 https://opencode.ai/update/api/latest/cli/npm 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
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
    info "Menginstal OpenCode CLI v2 untuk user ${OPENCODE_TARGET_USER}..."
    # Sumber resmi v2: https://opencode.ai/v2/install
    if [[ "$(id -un)" == "${OPENCODE_TARGET_USER}" ]]; then
      curl -fsSL https://opencode.ai/v2/install | bash - \
        || warn "Instalasi OpenCode CLI gagal; jalankan manual: curl -fsSL https://opencode.ai/v2/install | bash"
    else
      curl -fsSL https://opencode.ai/v2/install | run_as_root -u "${OPENCODE_TARGET_USER}" bash - \
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

# ============================================================ 9. Opsional
if [[ "$WITH_PLAYWRIGHT" -eq 1 ]]; then
  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    # Tanpa pnpm install, `playwright` tidak ada; fallback npx akan menarik
    # versi Playwright yang BERBEDA dari proyek -> binary browser tidak cocok.
    warn "--with-playwright butuh dependensi terpasang; dilewati. Jalankan: pnpm install && pnpm exec playwright install --with-deps chromium"
  else
    info "Menginstal browser Playwright (chromium + dependensi OS)..."
    pnpm exec playwright install --with-deps chromium \
      || warn "Instalasi browser Playwright gagal; jalankan manual: pnpm exec playwright install --with-deps chromium"
  fi
fi

# ============================================================ 10. Build (opsional)
if [[ "$WITH_BUILD" -eq 1 ]]; then
  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    fail "--build butuh dependensi terinstal; ulangi tanpa --no-install."
  fi
  LANGKAH="npm run build"
  info "Menjalankan npm run build sebagai pembuktian..."
  npm run build
fi

# ==================================================== 11. Kepemilikan file (sudo)
# Installer sering dijalankan `sudo ./install.sh` sementara dev server
# dijalankan sebagai user biasa. Artefak yang lahir sebagai root (node_modules,
# data/, .next/) lalu EACCES saat Next/Turbopack menulis — gejalanya
# "permission denied" yang jauh dari penyebabnya. Jadi kembalikan ke user
# pemilik sesi (pola yang sama sudah dipakai di Dockerfile untuk /app/data).
OWNER_USER="${SUDO_USER:-}"
if [[ -n "$OWNER_USER" && "$OWNER_USER" != "root" ]] && id -u "$OWNER_USER" >/dev/null 2>&1; then
  info "Menyerahkan kepemilikan artefak ke user ${OWNER_USER}..."
  for path in .env.local data node_modules public/vendor .next; do
    [[ -e "$path" ]] || continue
    chown -R "$OWNER_USER" "$path" 2>/dev/null \
      || warn "Gagal chown $path ke ${OWNER_USER}; jalankan manual: sudo chown -R ${OWNER_USER} $path"
  done
  if [[ -d packages ]]; then
    find packages -maxdepth 3 -name node_modules -type d -print0 2>/dev/null \
      | xargs -0 -r chown -R "$OWNER_USER" 2>/dev/null || true
  fi
fi

# ============================================================ Selesai
LANGKAH="ringkasan"
echo ""
info "Instalasi selesai. Ringkasan:"
info "  Node $(node -v 2>/dev/null || echo '?')  |  npm $(npm -v 2>/dev/null || echo '?')  |  pnpm $(pnpm -v 2>/dev/null || echo '?')"
if [[ -n "${OPENCODE_BIN_DETECTED:-}" ]]; then
  info "  OpenCode CLI: ${OPENCODE_BIN_DETECTED} ($("$OPENCODE_BIN_DETECTED" --version 2>/dev/null | head -1 || echo 'versi tidak terbaca'))"
fi
if [[ "$WITH_POSTGRES" -eq 1 ]]; then
  pg_lsclusters 2>/dev/null || true
  if [[ -n "$PGPORT" ]] && pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1; then
    info "  Postgres ${PG_MAJOR}: OK (localhost:${PGPORT})"
  else
    warn "Postgres ${PG_MAJOR} tidak merespons — cek: sudo systemctl status postgresql"
  fi
fi
if [[ -f public/vendor/maic-importer/index.js ]]; then
  info "  Vendor PPTX: OK (public/vendor/maic-importer/index.js)"
else
  warn "Vendor PPTX hilang — jalankan: pnpm --filter @openmaic/importer build && pnpm run sync:maic-importer"
fi
if command -v ffmpeg >/dev/null 2>&1; then
  info "  ffmpeg: OK (ekstraksi media lokal aktif)"
else
  info "  ffmpeg: tidak ada (ekstraksi audio/video lokal nonaktif) — pasang dengan: sudo ./install.sh --with-ffmpeg"
fi
echo ""
# Tampilkan ACCESS_CODE agar user bisa login. Home menunda fetch library
# sampai modal selesai (pre-auth 401 ditelan diam-diam), jadi console bersih
# sejak buka pertama — tidak ada lagi "Failed to list ... HTTP 401".
if [[ -f .env.local ]]; then
  CURRENT_ACCESS_CODE="$(env_get .env.local ACCESS_CODE)"
  if [[ -n "$CURRENT_ACCESS_CODE" ]]; then
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
echo "  - LLM default: opencode:space-bunny-free (OpenCode CLI v2, eksekusi lokal)."
echo "    Model FREE: jalan tanpa credential, karena eksekusi terjadi di dalam"
echo "    klien opencode. Untuk model BERBAYAR, login dulu via 'opencode auth"
echo "    login' lalu set DEFAULT_MODEL ke id dari 'opencode models'."
echo "    OPENCODE_BIN menunjuk binary absolut."
echo "    Coba manual: opencode run -m opencode/space-bunny-free \"hi\""
echo "    Model FREE (mis. opencode:muse-spark-1.3-contributor-free) tetap bisa"
echo "    dipakai server-side tanpa API key via CLI yang sama."
echo "    Pengecualian: pi agent-driver (MODEL_ROUTES maic-agent-driver) memanggil"
echo "    HTTP + function tools — untuk runtime agen isi OPENCODE_API_KEY"
echo "    (default route sudah memakai space-bunny-free). Tanpa key, panggilannya 401:"
echo "    isi OPENCODE_API_KEY, atau set OPENMAIC_AGENT_RUNTIME_ENABLED=false."
echo "  - Agent runtime + workbench butuh Postgres ${PG_MAJOR} + MODEL_ROUTES maic-agent-driver."
echo "  - Ekstraksi material audio/video lokal butuh ffmpeg: sudo ./install.sh --with-ffmpeg"
echo "  - Video MP4 butuh: docker compose --profile video-export up (berat: Chromium+FFmpeg)."
echo "  - e2e: pnpm exec playwright install --with-deps chromium && pnpm test:e2e"
echo "  - Install ulang aman (idempoten): password Postgres dipakai ulang dari .env.local,"
echo "    kecuali dipaksa via --pg-password/PG_PASSWORD."
