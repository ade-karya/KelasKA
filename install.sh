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
#      dipasang default native (lihat --no-ffmpeg). PostgreSQL 18 dari repo
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
#      Pro Workbench: auto-tier model 1->2->3 dari API key yang terisi
#      (provider terdaftar di lib/ai/providers.ts) —
#      1 Gemini (google:gemini-3.5-flash-lite), 2 OpenCode Go
#      (opencode-go:gpt-6-luna), 3 OpenCode free CLI
#      (opencode:muse-spark-1.3-contributor-free). API key
#      (GOOGLE_API_KEY, OPENCODE_API_KEY/OPENCODE_GO_API_KEY, provider LLM,
#      TTS/ASR, search) dibiarkan kosong untuk diisi manual. Tanpa docker:
#      render MP4 tetap via ZIP, bukan render-service.
#   7. Direktori `data/` untuk classroom store berbasis file.
#   8. Dependensi JS via `pnpm install --frozen-lockfile`
#      (postinstall otomatis build workspace packages + sync vendor importer).
#   9. Verifikasi: vendor bundle PPTX + kontrak Node engine.
#
# Yang SENGAJA tidak dipasang (agar server tetap ringan):
#   - postgresql-contrib: tidak ada `CREATE EXTENSION` di seluruh repo, jadi
#     paket ekstensi hanya menambah bobot tanpa dipakai.
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
#   --with-ffmpeg       Instal ffmpeg (default sudah ON; flag ini no-op,
#                       disediakan agar eksplisit/kompatibel).
#   --no-ffmpeg         Lewati instalasi ffmpeg (ekstraksi media lokal mati).
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
WITH_FFMPEG=1
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
  sudo ./install.sh --yes --no-ffmpeg              # tanpa ekstraksi media lokal
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
    --no-ffmpeg)       WITH_FFMPEG=0 ;;
    --with-opencode)   WITH_OPENCODE=1 ;;
    --no-opencode)     WITH_OPENCODE=0 ;;
    --pg-major=*)      PG_MAJOR="${arg#*=}" ;;
    --with-ollama)     fail "Opsi --with-ollama sudah dihapus: Ollama tidak lagi diinstal. OpenMAIC kini memakai OpenCode CLI v2 (tier gratis: opencode:muse-spark-1.3-contributor-free). Hapus flag tersebut dan ulangi." ;;
    --pg-password=*)   PG_PASSWORD="${arg#*=}"; [[ -n "$PG_PASSWORD" ]] || fail "--pg-password butuh nilai (contoh: --pg-password=rahasia)." ;;
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
    return
  fi
  # Sudah root (SUDO=""): kupas flag gaya sudo di depan agar `"$@"` mentah
  # tidak mencoba mengeksekusi `-E`/`-H`/`-u` sebagai perintah. Ini path utama
  # `sudo ./install.sh`: SUDO="" tapi target user (OpenCode/Playwright) beda.
  local want_home=0 target=""
  while [[ $# -gt 0 ]]; do
    case "${1:-}" in
      -E) shift ;;                    # sudah root: env memang terwarisi
      -H) want_home=1; shift ;;
      -u) target="${2:-}"; shift 2 ;;
      *) break ;;
    esac
  done
  if [[ -z "$target" ]]; then
    "$@"
    return
  fi
  if [[ "$(id -un)" == "$target" ]]; then
    "$@"
    return
  fi
  # Sudah root -> pindah user tanpa password. Pakai sudo bila ada (tetap bisa
  # dipanggil eksplisit walau $SUDO=""), kalau tidak pakai runuser/su.
  if command -v sudo >/dev/null 2>&1; then
    if [[ "$want_home" -eq 1 ]]; then
      sudo -H -u "$target" "$@"
    else
      sudo -u "$target" "$@"
    fi
    return
  fi
  local thome=""
  if [[ "$want_home" -eq 1 ]]; then
    thome="$(getent passwd "$target" 2>/dev/null | cut -d: -f6 || true)"
    [[ -n "$thome" ]] || thome="/home/$target"
  fi
  if command -v runuser >/dev/null 2>&1; then
    if [[ -n "$thome" ]]; then
      runuser -u "$target" -- env "HOME=$thome" "$@"
    else
      runuser -u "$target" -- "$@"
    fi
    return
  fi
  local q="" a
  if [[ -n "$thome" ]]; then q="export HOME=$(printf '%q' "$thome");"; fi
  for a in "$@"; do q="$q $(printf '%q' "$a")"; done
  su "$target" -c "$q"
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

# Kebalikan url_encode. Dipakai saat memakai ulang password dari DATABASE_URL:
# nilai di file sudah ter-encode, jadi harus di-decode dulu sebelum di-encode
# ulang — kalau tidak `%40` menjadi `%2540` (double-encode) dan auth Postgres
# gagal di run berikutnya.
url_decode() {
  node -e 'process.stdout.write(decodeURIComponent(process.argv[1]))' "$1"
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
  echo "  - buat/lengkapi .env.local (auto-tier Pro Workbench 1 LLM -> 2 opencode paid -> 3 free CLI), direktori data/, pnpm install"
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

# ffmpeg (native apt) untuk provider `local-ffmpeg` (ekstraksi transcript
# audio/video). Default dipasang; lewati dengan --no-ffmpeg.
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
    CODENAME="$(. /etc/os-release 2>/dev/null && printf '%s' "${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}")"
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
  || warn "corepack enable gagal; pnpm mungkin tetap tersedia lewat npm."
# corepack baru lebih suka `install --global`; `prepare --activate` dipakai
# sebagai fallback untuk corepack lama.
corepack install --global "pnpm@$PNPM_WANT" >/dev/null 2>&1 \
  || corepack prepare "pnpm@$PNPM_WANT" --activate \
  || fail "corepack gagal menyiapkan pnpm@$PNPM_WANT."
hash -r 2>/dev/null || true
command -v pnpm >/dev/null 2>&1 \
  || fail "pnpm tidak ditemukan setelah corepack. Pasang manual: npm i -g pnpm@$PNPM_WANT"
# corepack hanya dicek keberadaannya saja tidak cukup: pnpm global lama (mis.
# dari `npm i -g pnpm@9`) bisa membayangi shim corepack di PATH dan lolos cek
# tapi gagal/lain perilaku saat `pnpm install`. Hanya peringatkan (tanpa fail)
# agar lingkungan yang sengaja memakai pnpm lebih baru tidak rusak.
PNPM_HAVE="$(pnpm -v 2>/dev/null || echo '?')"
if [[ "$PNPM_HAVE" == "$PNPM_WANT" ]]; then
  info "pnpm ${PNPM_HAVE}."
else
  warn "pnpm ${PNPM_HAVE} terpakai, tapi packageManager mengunci pnpm@${PNPM_WANT}. Selaraskan manual bila install bermasalah: npm i -g pnpm@${PNPM_WANT}"
fi

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
    # Password tersimpan dalam bentuk percent-encoded, jadi tidak ada `@` mentah.
    # Pakai `(.*)` rakus sampai `@` TERAKHIR agar password yang mengandung `@`
    # (mis. ditulis manual tanpa encode) tidak terpotong di `@` pertama.
    EXISTING_PG_PASS_RAW="$(env_get .env.local DATABASE_URL \
      | sed -E -n 's|^postgres(ql)?://openmaic:(.*)@.*|\2|p')"
    # Nilai di file sudah percent-encoded (ditulis installer via url_encode),
    # jadi decode dulu sebelum dipakai — encode ulang di bawah tanpa decode
    # akan double-encode (`%40` -> `%2540`) dan auth Postgres gagal. Bila
    # decode gagal (password ditulis manual tanpa encode), pakai mentahnya.
    EXISTING_PG_PASS=""
    if [[ -n "$EXISTING_PG_PASS_RAW" ]]; then
      EXISTING_PG_PASS="$(url_decode "$EXISTING_PG_PASS_RAW" 2>/dev/null || printf '%s' "$EXISTING_PG_PASS_RAW")"
    fi
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
  pg_as_postgres psql -p "$PGPORT" -d openmaic -c "GRANT ALL PRIVILEGES ON SCHEMA public TO openmaic;" >/dev/null \
    || warn "GRANT ON SCHEMA public gagal; lanjutkan, cek manual sebagai postgres."

  DATABASE_URL_VALUE="postgres://openmaic:${PG_URL_ENCODED}@localhost:${PGPORT}/openmaic"
  if [[ "$PG_PASSWORD_GENERATED" -eq 1 ]]; then
    info "Password Postgres dibuat acak dan disimpan di .env.local (DATABASE_URL)."
  fi
  fi # tutup: if [[ -n "$PGPORT" ]]
  # DATABASE_URL aktif tidak pernah ditimpa (pastikan_var_env), jadi port
  # localhost yang basi (mis. cluster lama di 5433) harus ketahuan. Hanya
  # untuk host lokal — URL remote (Neon/Supabase/dll.) bukan urusan installer.
  if [[ -n "$PGPORT" && -f .env.local ]]; then
    _DB_URL_AKTIF="$(env_get .env.local DATABASE_URL)"
    _DB_PORT_AKTIF="$(printf '%s' "$_DB_URL_AKTIF" | sed -E -n 's#^postgres(ql)?://[^@]*@(localhost|127\.0\.0\.1|\[::1\]):([0-9]+)/.*#\3#p')"
    if [[ -n "$_DB_PORT_AKTIF" && "$_DB_PORT_AKTIF" != "$PGPORT" ]]; then
      warn "DATABASE_URL di .env.local menunjuk localhost:${_DB_PORT_AKTIF}, tapi cluster PostgreSQL ${PG_MAJOR}/main ada di port ${PGPORT}. Nilai Anda tidak ditimpa — perbaiki manual bila aplikasi gagal konek DB."
    fi
    unset _DB_URL_AKTIF _DB_PORT_AKTIF
  fi
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
  local tier_name="$6" tier_default="$7" tier_driver="$8" tier_pin="$9"
  local tier_key1_line="${10}" tier_key2_line="${11}" tier_key2go_line="${12}"
  cat <<EOF
# =============================================================================
# OpenMAIC dev/prod lokal — dibuat oleh install.sh pada $(date -u +%Y-%m-%d)
# Pro Workbench: 3 tier model otomatis, urutan 1->2->3 (tier=${tier_name}).
# Dipilih dari API key yang terisi; isi key lalu jalankan ulang install.sh
# untuk naik tier, kosongkan key untuk turun tier (nilai kustom Anda tak
# disentuh). Provider \`opencode\`/\`opencode-go\` = CLI lokal pola nexu-io/open-design.
#   1. LLM murni + key  : ${TIER1_MODEL} (${TIER1_KEY_VAR} platform asli)
#   2. OpenCode Go + key : ${TIER2_MODEL} (OPENCODE_API_KEY dan/atau
#      OPENCODE_GO_API_KEY untuk jalur HTTP/driver; \`opencode auth login\`
#      saja TIDAK cukup untuk driver HTTP)
#   3. OpenCode free CLI : ${TIER3_MODEL} (tanpa auth sama sekali)
# Slug tier2 persis katalog \`opencode models\` (terverifikasi); butuh
# registrasi provider opencode-go di lib/ai/providers.ts (sudah ada).
# CLI diinstal via: curl -fsSL https://opencode.ai/v2/install | bash
# Dokumentasi semua variabel: lihat .env.example
# =============================================================================

# --- Tier model Pro Workbench (auto: ${tier_name}) --------------------------------
# Harus \`provider:model\` dengan provider terdaftar; tanpa ini resolveModel throw.
DEFAULT_MODEL=${tier_default}
# Route eksplisit maic-agent-driver (wajib + \`api\` saat agent runtime aktif).
# Tier ber-key (1/2): HTTP OpenAI-compatible (`openai-completions`).
# Tier-3 gratis: driver khusus CLI (`opencode-cli`, alias `cli`/`opencode`) —
# eksekusi lokal `opencode run` tanpa key; function tools via envelope
# ```tool_calls (lib/ai/opencode-cli.ts + lib/server/agent-runtime/agent-driver-model.ts).
MODEL_ROUTES='${tier_driver}'

# --- OpenCode CLI (eksekusi lokal, tanpa API key untuk model FREE) -------------
# Server memanggil binary ini per request (prompt via stdin, JSON via stdout).
# Path absolut menghindari masalah PATH pada service. Kosong = auto-discovery
# (OPENCODE_BIN, PATH, ~/.opencode/bin). Timeout per panggilan CLI.
OPENCODE_BIN=${opencode_bin}
# OPENCODE_CLI_TIMEOUT_MS=600000
# Tier1 butuh key Google AI Studio (ISI MANUAL):
${tier_key1_line}
# GOOGLE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
# Tier2 butuh key (ISI MANUAL; jalur CLI paid butuh \`opencode auth login\`):
${tier_key2_line}
${tier_key2go_line}
# OPENCODE_BASE_URL=https://opencode.ai/zen/v1
# Pin katalog provider opencode untuk tier saat ini (boleh diisi manual):
# OPENCODE_MODELS=${tier_pin}

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

# --- Local/self-hosted: jaringan lokal (native, tanpa docker) -------------------
# ON agar URL privat/loopback bisa dipakai server: LLM lokal (Ollama,
# Lemonade), ASR lokal (FunASR/Lemonade), SearXNG lokal. Tanpa ini URL
# localhost dari client diblokir SSRF-guard di production.
# PERINGATAN: hanya untuk deployment lokal/tepercaya. Jangan aktifkan bila
# server terekspos ke publik.
ALLOW_LOCAL_NETWORKS=true
# ISI MANUAL bila pakai LLM/search lokal (butuh ALLOW_LOCAL_NETWORKS=true):
# OLLAMA_BASE_URL=http://localhost:11434/v1
# OLLAMA_MODELS=
# SEARXNG_BASE_URL=

# --- Persistence / Agent runtime (PostgreSQL) -----------------------------------
DATABASE_URL=${db_url}
PERSISTENCE_DEV_TOKEN=${dev_token}
NEXT_PUBLIC_PERSISTENCE=1
NEXT_PUBLIC_PERSISTENCE_TOKEN=${dev_token}
PERSISTENCE_ALLOW_INSECURE_DEV_AUTH=true
COOKIE_SECURE=0

# --- Render service MP4 (opsional, butuh \`docker compose --profile video-export up\`)
# RENDER_SERVICE_URL=http://localhost:9000

# --- Performa (native, tanpa docker) ---------------------------------------------
# Generate konten scene paralel (batas kode: 10). 0/unset = serial (default).
# 5 = prioritas kecepatan; turunkan bila API key berkuota konkurensi rendah
# (gejala: 429) atau naikkan s.d. 10 di server besar. Dibaca saat runtime
# (restart cukup, tanpa rebuild).
PARALLEL_SCENE_CONCURRENCY=5

# --- Access control --------------------------------------------------------------
# Password bersama pelindung deployment. Tanpa ini API fail-open (warning saat boot).
ACCESS_CODE=${access_code}

LOG_LEVEL=info
LOG_FORMAT=pretty
EOF
}

# Escape nilai agar aman sebagai replacement `sed s|||`: backslash dulu
# (kalau belakangan, backslash hasil escape &/| ikut tergandakan), lalu & dan
# delimiter |. Tanpa ini password paksa berisi `\` rusak (mis. `a\b` -> `ab`,
# `p\a` -> BEL) di semua path sed di bawah.
sed_escape_replacement() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//&/\\&}"
  s="${s//|/\\|}"
  printf '%s' "$s"
}

# Lengkapi satu variabel bila belum ada di file (tanpa menimpa nilai user).
# Bila yang ada hanya versi BERKOMENTARI (`# KEY=...`, jejak template
# --no-postgres), baris itu diaktifkan ulang dengan nilai di sini — bukan
# ditumpuk sebagai duplikat yang saling bertabrakan saat .env.local dibaca.
pastikan_var_env() {
  local file="$1" key="$2" value="$3" escaped
  if grep -qE "^[[:space:]]*${key}=" "$file"; then return 0; fi
  if [[ -n "$value" ]] && grep -qE "^[[:space:]]*#[[:space:]]*${key}=" "$file"; then
    escaped="$(sed_escape_replacement "$value")"
    sed -i -E "s|^[[:space:]]*#[[:space:]]*${key}=.*|${key}=${escaped}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# Pastikan placeholder KOMENTAR ada agar user tahu kolom manualnya, tanpa
# mengaktifkan apa pun (tidak menimpa nilai user; tidak mengubah perilaku).
pastikan_komentar_env() {
  local file="$1" key="$2" placeholder="$3"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then return 0; fi
  if grep -qE "^[[:space:]]*#[[:space:]]*${key}=" "$file"; then return 0; fi
  echo "# ${key}=${placeholder}" >> "$file"
}

# Agent runtime aktif tanpa DATABASE_URL = warning [config] di setiap boot
# (lib/server/config-validation.ts). Jadi nyalakan hanya bila DB-nya ada.
set_agent_runtime_flag() {
  local enabled="$1" reason="$2"
  if grep -qE "^[[:space:]]*OPENMAIC_AGENT_RUNTIME_ENABLED=${enabled}$" .env.local; then return 0; fi
  sed -i -E "s|^[[:space:]]*OPENMAIC_AGENT_RUNTIME_ENABLED=.*|OPENMAIC_AGENT_RUNTIME_ENABLED=${enabled}|" .env.local
  info "OPENMAIC_AGENT_RUNTIME_ENABLED=${enabled} (${reason})."
}

# ---------------- tier model Pro Workbench (urutan prioritas 1->2->3) ------------
# Installer memilih otomatis berdasar API key yang TERISI (file .env.local
# yang ada, fallback environment). Idempoten: isi key lalu jalankan ulang
# untuk naik tier; kosongkan key untuk turun tier. Nilai kustom milik user
# (provider/model di luar daftar milik installer) tidak disentuh.
#   tier1 = Gemini + key : google:gemini-3.5-flash-lite
#           (GOOGLE_API_KEY dari https://aistudio.google.com;
#           terverifikasi live: generateContent 200 OK)
#   tier2 = OpenCode Go + key : opencode-go:gpt-6-luna — slug PERSIS katalog
#           `opencode models` (terverifikasi RC=0). Kunci: OPENCODE_API_KEY
#           (utama) dan/atau OPENCODE_GO_API_KEY (jalur HTTP/driver).
#           `opencode auth login` saja tidak cukup untuk driver HTTP.
#   tier3 = OpenCode free CLI : opencode:muse-spark-1.3-contributor-free
#           (eksekusi lokal, tanpa auth; terverifikasi RC=0 tanpa kredensial)
TIER1_MODEL="google:gemini-3.5-flash-lite"
TIER1_KEY_VAR="GOOGLE_API_KEY"
TIER2_MODEL="opencode-go:gpt-6-luna"
TIER2_KEY_PRIMARY="OPENCODE_API_KEY"
TIER2_KEY_HTTP="OPENCODE_GO_API_KEY"
TIER3_MODEL="opencode:muse-spark-1.3-contributor-free"
# Pin katalog provider `opencode` agar CLI gratis selalu discoverable.
TIER_PIN="muse-spark-1.3-contributor-free"

pilih_tier_model() {
  local f="${1:-.env.local}" k1="" k2=""
  k1="$(env_get "$f" "$TIER1_KEY_VAR")"
  [[ -z "$k1" ]] && k1="${GOOGLE_API_KEY:-}"
  k2="$(env_get "$f" "$TIER2_KEY_PRIMARY")"
  [[ -z "$k2" ]] && k2="$(env_get "$f" "$TIER2_KEY_HTTP")"
  [[ -z "$k2" ]] && k2="${OPENCODE_API_KEY:-}"
  [[ -z "$k2" ]] && k2="${OPENCODE_GO_API_KEY:-}"
  if [[ -n "$k1" ]]; then echo "tier1"
  elif [[ -n "$k2" ]]; then echo "tier2"
  else echo "tier3"
  fi
}

tier_default_model() {
  case "${1:-tier3}" in
    tier1) printf '%s' "$TIER1_MODEL" ;;
    tier2) printf '%s' "$TIER2_MODEL" ;;
    *)     printf '%s' "$TIER3_MODEL" ;;
  esac
}
tier_driver_route() {
  case "${1:-tier3}" in
    tier3) printf '{"maic-agent-driver":{"model":"%s","api":"opencode-cli"}}' "$(tier_default_model "$1")" ;;
    *) printf '{"maic-agent-driver":{"model":"%s","api":"openai-completions"}}' "$(tier_default_model "$1")" ;;
  esac
}

# Tulis key dari environment ke file bila kolom file masih kosong (append
# mentah via printf, tanpa sed → aman untuk karakter apa pun). Tidak menimpa
# nilai file. Dipanggil sebelum pilih tier agar tier dari env ikut permanen.
selaraskan_key_env() {
  local file="$1" key="$2" envval=""
  case "$key" in
    GOOGLE_API_KEY) envval="${GOOGLE_API_KEY:-}" ;;
    OPENCODE_API_KEY) envval="${OPENCODE_API_KEY:-}" ;;
    OPENCODE_GO_API_KEY) envval="${OPENCODE_GO_API_KEY:-}" ;;
  esac
  if [[ -z "$(env_get "$file" "$key")" && -n "$envval" ]]; then
    printf '%s=%s\n' "$key" "$envval" >> "$file"
    info "${key} diisi dari environment."
  fi
}

if [[ ! -f .env.local ]]; then
  info "Membuat .env.local baru dari template..."
  # Tier dari environment (file belum ada). Runtime agen ON bila DB ada —
  # tier-3 gratis dilayani driver khusus CLI (opencode-cli, tanpa key).
  TIER="$(pilih_tier_model .env.local)"
  TIER_DEFAULT="$(tier_default_model "$TIER")"
  TIER_DRIVER="$(tier_driver_route "$TIER")"
  # Baris key: aktif bila ada di environment (agar tier dari env permanen di
  # file), komentar bila tidak. Isi mentah via variabel (heredoc tidak
  # mengevaluasi ulang isi variabel) → aman untuk karakter apa pun.
  if [[ -n "${GOOGLE_API_KEY:-}" ]]; then TIER1_KEY_LINE="GOOGLE_API_KEY=${GOOGLE_API_KEY}"; else TIER1_KEY_LINE="# GOOGLE_API_KEY="; fi
  if [[ -n "${OPENCODE_API_KEY:-}" ]]; then TIER2_KEY_LINE="OPENCODE_API_KEY=${OPENCODE_API_KEY}"; else TIER2_KEY_LINE="# OPENCODE_API_KEY="; fi
  if [[ -n "${OPENCODE_GO_API_KEY:-}" ]]; then
    TIER2GO_KEY_LINE="OPENCODE_GO_API_KEY=${OPENCODE_GO_API_KEY}"
  elif [[ -n "${OPENCODE_API_KEY:-}" ]]; then
    # Driver HTTP tier2 membaca OPENCODE_GO_API_KEY; samakan dari kunci utama
    # (gateway Zen yang sama) agar tier2 langsung jalan.
    TIER2GO_KEY_LINE="OPENCODE_GO_API_KEY=${OPENCODE_API_KEY}"
    GO_MIRRORED_FRESH=1
  else
    TIER2GO_KEY_LINE="# OPENCODE_GO_API_KEY="
  fi
  if [[ -n "$DATABASE_URL_VALUE" ]]; then AGENT_RT="true"; else AGENT_RT="false"; fi
  info "Tier model Pro Workbench: ${TIER} (${TIER_DEFAULT})."
  if [[ -n "${GO_MIRRORED_FRESH:-}" ]]; then
    info "OPENCODE_GO_API_KEY disalin dari OPENCODE_API_KEY (gateway Zen yang sama) untuk driver HTTP."
  fi
  if [[ -n "$DATABASE_URL_VALUE" ]]; then
    tulis_template_env "$DATABASE_URL_VALUE" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "$AGENT_RT" "" "$TIER" "$TIER_DEFAULT" "$TIER_DRIVER" "$TIER_PIN" "$TIER1_KEY_LINE" "$TIER2_KEY_LINE" "$TIER2GO_KEY_LINE" > .env.local
    if [[ "$AGENT_RT" == "false" ]]; then
      info "Agent runtime nonaktif (tanpa DATABASE_URL). Tier-3 tetap didukung driver CLI bila DB ada."
    fi
  else
    tulis_template_env "" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "$AGENT_RT" "" "$TIER" "$TIER_DEFAULT" "$TIER_DRIVER" "$TIER_PIN" "$TIER1_KEY_LINE" "$TIER2_KEY_LINE" "$TIER2GO_KEY_LINE" > .env.local
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
  # Auto-tier Pro Workbench 1->2->3 berdasar API key yang terisi. Hanya nilai
  # milik installer yang dipindah; nilai kustom user tidak disentuh.
  # - ollama:* (Ollama tidak lagi diinstal) -> tier saat ini.
  # - opencode:gpt-6-luna (slug lama, tanpa prefix go) -> tier saat ini.
  # - google:gemini-3.5-flash-lite / deepseek:deepseek-flash (tier1 lama) /
  #   opencode-go:gpt-6-luna / opencode:muse-spark-1.3-contributor-free /
  #   opencode:space-bunny-free / opencode:big-pickle /
  #   tokendance:deepseek-v4.1-flash = preset installer -> tier saat ini
  #   (ganti total ke Gemini: nilai DeepSeek lama ikut dipindah maju).
  for kk in GOOGLE_API_KEY OPENCODE_API_KEY OPENCODE_GO_API_KEY; do
    selaraskan_key_env .env.local "$kk"
  done
  TIER="$(pilih_tier_model .env.local)"
  TIER_DEFAULT="$(tier_default_model "$TIER")"
  TIER_DRIVER="$(tier_driver_route "$TIER")"
  info "Tier model Pro Workbench: ${TIER} (${TIER_DEFAULT})."
  # Driver HTTP tier2 membaca OPENCODE_GO_API_KEY; samakan dari kunci utama
  # bila kolom GO belum ada sama sekali (aktif maupun komentar) — gateway
  # Zen yang sama. Nilai GO eksplisit tidak disentuh.
  K2P="$(env_get .env.local "$TIER2_KEY_PRIMARY")"
  if [[ -n "$K2P" && -z "$(env_get .env.local "$TIER2_KEY_HTTP")" ]] \
    && ! grep -qE "^[[:space:]]*#[[:space:]]*${TIER2_KEY_HTTP}=" .env.local; then
    printf '%s=%s\n' "$TIER2_KEY_HTTP" "$K2P" >> .env.local
    info "${TIER2_KEY_HTTP} disalin dari ${TIER2_KEY_PRIMARY} (gateway Zen yang sama) untuk driver HTTP."
  fi
  # Rename ID DeepSeek yang sudah tidak ada di platform (hasil fetch GET
  # /v1/models: hanya deepseek-flash + deepseek-v4-pro yang live).
  # deepseek-v4-flash & deepseek-v4-flash-vision-exp -> deepseek-flash
  # (V4.1 Flash; vision kini native). Pola tidak menyentuh
  # tokendance:deepseek-v4.1-flash (setelah `v4` ada `.`, bukan `-`).
  if grep -qE 'deepseek-v4-flash(-vision-exp)?' .env.local 2>/dev/null; then
    sed -i -E -e 's/deepseek-v4-flash-vision-exp/deepseek-flash/g' -e 's/deepseek-v4-flash/deepseek-flash/g' .env.local
    info "ID DeepSeek lawas dipindah ke deepseek-flash (V4.1 Flash, sesuai /v1/models)."
  fi
  CUR_DEFAULT="$(env_get .env.local DEFAULT_MODEL)"
  case "$CUR_DEFAULT" in
    ollama:*|opencode:gpt-6-luna|opencode-go:gpt-6-luna|google:gemini-3.5-flash-lite|deepseek:deepseek-flash|opencode:space-bunny-free|opencode:muse-spark-1.3-contributor-free|opencode:big-pickle|tokendance:deepseek-v4.1-flash)
      if [[ "$CUR_DEFAULT" != "$TIER_DEFAULT" ]]; then
        DM_ESCAPED="$(sed_escape_replacement "$TIER_DEFAULT")"
        sed -i -E "s|^[[:space:]]*DEFAULT_MODEL=.*|DEFAULT_MODEL=${DM_ESCAPED}|" .env.local
        info "DEFAULT_MODEL dipindah ${CUR_DEFAULT} -> ${TIER_DEFAULT} (${TIER})."
      fi
      ;;
  esac
  CUR_DRIVER="$(sed -n -E 's/^[^#]*"maic-agent-driver"[^}]*"model"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' .env.local | head -1)"
  case "$CUR_DRIVER" in
    ollama:*|opencode:gpt-6-luna|opencode-go:gpt-6-luna|google:gemini-3.5-flash-lite|deepseek:deepseek-flash|opencode:space-bunny-free|opencode:muse-spark-1.3-contributor-free|opencode:big-pickle|tokendance:deepseek-v4.1-flash)
      if [[ "$CUR_DRIVER" != "$TIER_DEFAULT" ]]; then
        DR_RE='ollama:[^"\\} ]*|opencode:gpt-6-luna|opencode-go:gpt-6-luna|google:gemini-3\.5-flash-lite|deepseek:deepseek-flash|opencode:space-bunny-free|opencode:muse-spark-1\.3-contributor-free|opencode:big-pickle|tokendance:deepseek-v4\.1-flash'
        DM_ESCAPED2="$(sed_escape_replacement "$TIER_DEFAULT")"
        sed -i -E "/^[[:space:]]*MODEL_ROUTES=/ s#(${DR_RE})#${DM_ESCAPED2}#g" .env.local
        info "MODEL_ROUTES maic-agent-driver dipindah ${CUR_DRIVER} -> ${TIER_DEFAULT} (${TIER})."
      fi
      ;;
  esac
  # Normalisasi api driver tier-3 ke driver khusus CLI: model opencode/*
  # yang masih memakai "openai-completions" (warisan sebelum driver CLI)
  # dipindah ke "opencode-cli" agar transport eksplisit. Berlaku untuk nilai
  # milik installer; nilai kustom (provider non-opencode) tidak disentuh.
  if [[ "$TIER" == "tier3" ]] && grep -qE '^[[:space:]]*MODEL_ROUTES=.*opencode:[^"]*.*openai-completions' .env.local 2>/dev/null; then
    sed -i -E '/^[[:space:]]*MODEL_ROUTES=/ s#"api"[[:space:]]*:[[:space:]]*"openai-completions"#"api":"opencode-cli"#' .env.local
    info 'MODEL_ROUTES maic-agent-driver api dinormalisasi openai-completions -> opencode-cli (driver khusus tier-3).'
  fi
  # OPENCODE_MODELS: pastikan_var_env di bawah tidak menimpa nilai yang sudah
  # ada, jadi pin milik installer harus dipindah eksplisit di sini. Nilai
  # kustom lain tidak disentuh.
  CUR_PIN="$(env_get .env.local OPENCODE_MODELS)"
  case "$CUR_PIN" in
    space-bunny-free|muse-spark-1.3-contributor-free|big-pickle|gpt-6-luna)
      if [[ "$CUR_PIN" != "$TIER_PIN" ]]; then
        PIN_ESCAPED="$(sed_escape_replacement "$TIER_PIN")"
        sed -i -E "s|^[[:space:]]*OPENCODE_MODELS=.*|OPENCODE_MODELS=${PIN_ESCAPED}|" .env.local
        info "OPENCODE_MODELS dipindah ${CUR_PIN} -> ${TIER_PIN} (${TIER})."
      fi
      ;;
  esac
  pastikan_var_env .env.local DEFAULT_MODEL "$TIER_DEFAULT"
  pastikan_var_env .env.local MODEL_ROUTES "$TIER_DRIVER"
  pastikan_var_env .env.local OPENCODE_BIN ""
  # Key tier1/tier2 opsional; jangan buat key kosong yang mengesankan wajib
  # — tier dipilih dari key yang terisi. Cukup pastikan pin model tersedia.
  pastikan_var_env .env.local OPENCODE_MODELS "$TIER_PIN"
  pastikan_komentar_env .env.local GOOGLE_API_KEY ""
  # Native tanpa docker: izinkan URL loopback/privat (Ollama/Lemonade/FunASR/
  # SearXNG lokal). Baris berkomentar jejak template lama ikut diaktifkan.
  pastikan_var_env .env.local ALLOW_LOCAL_NETWORKS "true"
  # Placeholder manual (tetap nonaktif, hanya penanda kolom isian):
  pastikan_komentar_env .env.local OPENCODE_API_KEY ""
  pastikan_komentar_env .env.local OPENCODE_GO_API_KEY ""
  pastikan_komentar_env .env.local OLLAMA_BASE_URL "http://localhost:11434/v1"
  pastikan_komentar_env .env.local SEARXNG_BASE_URL ""
  # Performa native: generate scene paralel (restart cukup, tanpa rebuild).
  pastikan_var_env .env.local PARALLEL_SCENE_CONCURRENCY "5"
  pastikan_var_env .env.local ACCESS_CODE "$ACCESS_CODE_NEW"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    if [[ "$PG_PASSWORD_FORCED" -eq 1 && -n "$DATABASE_URL_VALUE" ]]; then
      # Password dipaksa via --pg-password/PG_PASSWORD: sinkronkan file agar
      # tidak stale (kasus satu-satunya DATABASE_URL boleh ditimpa).
      DB_URL_SED_ESCAPED="$(sed_escape_replacement "$DATABASE_URL_VALUE")"
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
        TOKEN_SED_ESCAPED="$(sed_escape_replacement "$DEV_TOKEN_NEW")"
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
    # Nyalakan agent runtime bila DATABASE_URL benar-benar terisi.
    # Tier-3 gratis dilayani driver khusus CLI (opencode-cli, tanpa key);
    # tier ber-key memakai driver HTTP seperti biasa.
    DB_URL_ISI="$(env_get .env.local DATABASE_URL)"
    if [[ -n "$DB_URL_ISI" ]]; then
      set_agent_runtime_flag true "DATABASE_URL + ${TIER} tersedia (driver ${TIER} khusus)"
      pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "true"
    else
      ALASAN_RT="DATABASE_URL kosong"
      set_agent_runtime_flag false "$ALASAN_RT"
      pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "false"
      warn "OPENMAIC_AGENT_RUNTIME_ENABLED=false (${ALASAN_RT})."
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
    # $HOME saat sudo adalah /root, bukan home target — jangan pakai $HOME di
    # sini. Coba /home/<user> dulu sebelum menyerah ke user saat ini.
    if [[ -d "/home/${OPENCODE_TARGET_USER}" ]]; then
      OPENCODE_TARGET_HOME="/home/${OPENCODE_TARGET_USER}"
      warn "User '${OPENCODE_TARGET_USER}' tidak ada di /etc/passwd — pakai ${OPENCODE_TARGET_HOME} sebagai home."
    else
      warn "User '${OPENCODE_TARGET_USER}' tidak ada di /etc/passwd — OpenCode CLI dipasang ke HOME user saat ini ($(id -un))."
      OPENCODE_TARGET_USER="$(id -un)"
      OPENCODE_TARGET_HOME="$HOME"
    fi
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
    # Catatan: `sudo -u <user> bash` TANPA -H mempertahankan HOME=/root sehingga
    # installer menaruh binary di /root/.opencode (salah user). -H memaksa HOME
    # milik target agar deteksi path di bawah menemukannya.
    if [[ "$(id -un)" == "${OPENCODE_TARGET_USER}" ]]; then
      curl -fsSL https://opencode.ai/v2/install | bash - \
        || warn "Instalasi OpenCode CLI gagal; jalankan manual: curl -fsSL https://opencode.ai/v2/install | bash"
    else
      curl -fsSL https://opencode.ai/v2/install | run_as_root -H -u "${OPENCODE_TARGET_USER}" bash - \
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
        BIN_SED_ESCAPED="$(sed_escape_replacement "$OPENCODE_BIN_DETECTED")"
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
    # Browser harus milik user pemilik sesi, bukan root: bila installer jalan
    # via sudo, `pnpm exec` sebagai root menaruh browser di /root/.cache lalu
    # dev server (user biasa) tidak menemukannya. Jalankan sebagai pemilik sesi.
    PLAYWRIGHT_USER="${SUDO_USER:-$(id -un)}"
    if [[ "$(id -un)" == "$PLAYWRIGHT_USER" ]]; then
      pnpm exec playwright install --with-deps chromium \
        || warn "Instalasi browser Playwright gagal; jalankan manual: pnpm exec playwright install --with-deps chromium"
    else
      # -H agar HOME milik target (cache browser di ~/.cache, bukan /root);
      # teruskan COREPACK_ENABLE_DOWNLOAD_PROMPT agar shim pnpm tidak prompt.
      run_as_root -H -u "$PLAYWRIGHT_USER" env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm exec playwright install --with-deps chromium \
        || warn "Instalasi browser Playwright gagal; jalankan manual sebagai ${PLAYWRIGHT_USER}: pnpm exec playwright install --with-deps chromium"
    fi
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
  # Backup .env.local dari run ini maupun run sebelumnya ikut dikembalikan —
  # kalau tidak, backup milik root dan user tidak bisa membaca/menghapusnya.
  for bak in .env.local.bak.*; do
    [[ -e "$bak" ]] || continue
    chown "$OWNER_USER" "$bak" 2>/dev/null \
      || warn "Gagal chown $bak ke ${OWNER_USER}; jalankan manual: sudo chown ${OWNER_USER} $bak"
  done
  if [[ -d packages ]]; then
    find packages -maxdepth 3 -name node_modules -type d -print0 2>/dev/null \
      | xargs -0 -r chown -R "$OWNER_USER" 2>/dev/null || true
  fi
  # Cache browser Playwright bila pernah terinstal sebagai root di run lama
  # (sebelum step 9 dijalankan sebagai pemilik sesi). Bukan fatal bila absen.
  OWNER_HOME="$(getent passwd "$OWNER_USER" 2>/dev/null | cut -d: -f6 || true)"
  if [[ -n "$OWNER_HOME" && -d "$OWNER_HOME/.cache/ms-playwright" ]]; then
    chown -R "$OWNER_USER" "$OWNER_HOME/.cache/ms-playwright" 2>/dev/null || true
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
  info "  ffmpeg: tidak ada (dilewati via --no-ffmpeg) — pasang dengan: sudo ./install.sh --yes (tanpa --no-ffmpeg)"
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
echo "  - Nilai NEXT_PUBLIC_* dibaca saat start (dev) / saat build (produksi): restart dev server, atau build ulang untuk produksi."
echo "  - Fitur native aktif semua tanpa docker: flag client+server true,"
echo "    ALLOW_LOCAL_NETWORKS=true (Ollama/Lemonade/FunASR/SearXNG lokal bisa"
echo "    dipakai; matikan bila server terekspos publik). Video MP4 tanpa"
echo "    render-service: unduh ZIP lalu render via CLI lokal."
echo "  - ISI MANUAL di .env.local: GOOGLE_API_KEY (tier1), OPENCODE_API_KEY /"
echo "    OPENCODE_GO_API_KEY (tier2), OLLAMA_BASE_URL / OLLAMA_MODELS,"
echo "    SEARXNG_BASE_URL, dan API key provider lain (lihat .env.example)."
echo "    Server baca ulang tiap restart (flag server-only); flag NEXT_PUBLIC_*"
echo "    butuh build ulang."
echo "  - Tier model Pro Workbench (auto 1->2->3 dari API key; ulangi install.sh"
echo "    setelah isi/kosongkan key untuk pindah tier, nilai kustom tak disentuh):"
echo "    1. Gemini + key    : google:gemini-3.5-flash-lite (ISI MANUAL"
echo "       GOOGLE_API_KEY dari https://aistudio.google.com)"
echo "    2. OpenCode Go + key  : opencode-go:gpt-6-luna (slug persis katalog"
echo "       'opencode models', terverifikasi; ISI MANUAL OPENCODE_API_KEY"
echo "       dan/atau OPENCODE_GO_API_KEY untuk jalur HTTP/driver;"
echo "       'opencode auth login' saja tidak cukup untuk driver)"
echo "    3. OpenCode free CLI : opencode:muse-spark-1.3-contributor-free (tanpa auth;"
echo '       coba manual: opencode run -m opencode/muse-spark-1.3-contributor-free "hi"'
echo "       OPENCODE_BIN menunjuk binary absolut."
echo "    Driver agen (MODEL_ROUTES maic-agent-driver): tier ber-key via HTTP"
echo "    (openai-completions/responses); tier-3 gratis via driver khusus CLI"
echo "    (opencode-cli, tanpa key, envelope tool_calls)."
echo "  - Agent runtime + workbench butuh Postgres ${PG_MAJOR} (semua tier, termasuk tier-3 CLI)."
echo "  - Performa: PARALLEL_SCENE_CONCURRENCY=5 (scene paralel, maks kode 10;"
echo "    turunkan bila kena 429, naikkan s.d. 10 di server besar) + ffmpeg apt"
echo "    default terinstal (lewati via --no-ffmpeg). TTS tanpa pacing"
echo "    (default kode: interval 0) dan asset collector auto-aktif bila ada DB."
echo "  - Ekstraksi material audio/video lokal: ffmpeg (default ON)."
echo "  - Video MP4 butuh: docker compose --profile video-export up (berat: Chromium+FFmpeg)."
echo "  - e2e: pnpm exec playwright install --with-deps chromium && pnpm test:e2e"
echo "  - Install ulang aman (idempoten): password Postgres dipakai ulang dari .env.local,"
echo "    kecuali dipaksa via --pg-password/PG_PASSWORD."
