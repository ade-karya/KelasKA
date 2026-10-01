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
#      hanya dilengkapi variabel yang hilang — tidak menimpa isi user,
#      kecuali TTS browser-native + agent runtime yang diselaraskan flag).
#      Pro Workbench: auto-tier model 1->2->3 dari API key yang terisi
#      (provider terdaftar di lib/ai/providers.ts) —
#      1 Gemini (google:gemini-3.5-flash-lite), 2 OpenCode Go
#      (opencode-go:gpt-6-luna), 3 OpenCode free CLI
#      (opencode:muse-spark-1.3-contributor-free sebagai default, dengan
#      OPENCODE_MODELS berisi SEMUA model free dari `opencode models`).
#      Installer mengambil daftar model free via CLI (`opencode models`,
#      fallback katalog lib/ai/providers.ts) lalu mengaktifkan semuanya di
#      OPENCODE_MODELS (comma-separated) agar tombol pemilih model di halaman
#      Pro Workbench (/workspace) bisa memilih di antaranya. API key
#      (GOOGLE_API_KEY, OPENCODE_API_KEY/OPENCODE_GO_API_KEY, provider LLM,
#      TTS/ASR, search) dibiarkan kosong untuk diisi manual. TTS browser-native
#      (Web Speech API) default ON tanpa API key (lihat --no-browser-tts).
#      Tanpa docker: render MP4 tetap via ZIP, bukan render-service.
#   7. Direktori `data/` untuk classroom store berbasis file.
#   8. Dependensi JS via `pnpm install --frozen-lockfile`
#      (postinstall otomatis build workspace packages + sync vendor importer).
#   9. Verifikasi: vendor bundle PPTX + kontrak Node engine.
#  10. pgAdmin4 web (default ON; lewati dengan --no-pgadmin): repo resmi
#      pgadmin.org + paket `pgadmin4-web` + setup-web.sh non-interaktif
#      (--yes + PGADMIN_SETUP_EMAIL/PASSWORD). Kredensial awal dibuat acak
#      (atau via --pgadmin-email/--pgadmin-password) dan disimpan di
#      .env.local (PGADMIN_EMAIL/PGADMIN_PASSWORD). Langsung bisa dibuka di
#      http://localhost/pgadmin4 tanpa langkah manual.
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
#   --with-pgadmin      Instal pgAdmin4 web (default sudah ON; flag ini
#                       no-op, disediakan agar eksplisit).
#   --no-pgadmin        Lewati instalasi & setup pgAdmin4 web.
#   --pgadmin-email=E   Email login awal pgAdmin (default:
#                       admin@openmaic.id; dipakai saat setup pertama,
#                       atau disinkronkan bila dipaksa).
#                       NOTE: jangan pakai domain .local (contoh lama
#                       admin@openmaic.local) — ditolak validasi email
#                       pgAdmin 9.x (special-use domain).
#   --pgadmin-password=PASS
#                       Password login awal pgAdmin (default: dibuat acak;
#                       min. 6 karakter).
#   --with-ffmpeg       Instal ffmpeg (default sudah ON; flag ini no-op,
#                       disediakan agar eksplisit/kompatibel).
#   --no-ffmpeg         Lewati instalasi ffmpeg (ekstraksi media lokal mati).
#   --with-browser-tts  Aktifkan TTS browser-native tanpa API key (default sudah
#                       ON; flag ini no-op, disediakan agar eksplisit).
#   --no-browser-tts    Matikan TTS browser-native (narasi butuh provider TTS
#                       ber-key; lihat .env.example bagian TTS).
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
WITH_PGADMIN=1
WITH_FFMPEG=1
WITH_OPENCODE=1
WITH_BROWSER_TTS=1
PG_PASSWORD="${PG_PASSWORD:-}"
# Kredensial login awal pgAdmin (setup-web.sh non-interaktif). Fallback ke
# nama var upstream (PGADMIN_SETUP_*) bila user mengekspornya manual.
PGADMIN_EMAIL="${PGADMIN_EMAIL:-${PGADMIN_SETUP_EMAIL:-}}"
PGADMIN_PASSWORD="${PGADMIN_PASSWORD:-${PGADMIN_SETUP_PASSWORD:-}}"
PGADMIN_EMAIL_DEFAULT="admin@openmaic.id"
PGADMIN_CREDS_FORCED=0
# Mayor Postgres target: 18 = stabil terbaru (19 masih beta per Sep 2026).
PG_MAJOR="${PG_MAJOR:-18}"

tampilkan_help() {
  # Cetak blok komentar header (baris 2 .. baris kosong pertama).
  awk 'NR>1 { if ($0 ~ /^[[:space:]]*$/) exit; sub(/^# ?/, ""); print }' "$0"
  cat <<'EOF'
Contoh:
  sudo ./install.sh --yes
  sudo ./install.sh --yes --build --with-playwright
  sudo ./install.sh --yes --no-pgadmin              # tanpa pgAdmin4 web
  sudo ./install.sh --yes --no-ffmpeg              # tanpa ekstraksi media lokal
  sudo ./install.sh --yes --no-browser-tts         # tanpa TTS browser-native (butuh key TTS)
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
    --with-pgadmin)    WITH_PGADMIN=1 ;;
    --no-pgadmin)      WITH_PGADMIN=0 ;;
    --pgadmin-email=*) PGADMIN_EMAIL="${arg#*=}"; [[ "$PGADMIN_EMAIL" == *"@"* ]] || fail "--pgadmin-email harus format email (contoh: --pgadmin-email=admin@openmaic.id)." ;;
    --pgadmin-password=*) PGADMIN_PASSWORD="${arg#*=}"; [[ -n "$PGADMIN_PASSWORD" ]] || fail "--pgadmin-password butuh nilai (contoh: --pgadmin-password=rahasia)." ;;
    --with-ffmpeg)     WITH_FFMPEG=1 ;;
    --no-ffmpeg)       WITH_FFMPEG=0 ;;
    --with-browser-tts) WITH_BROWSER_TTS=1 ;;
    --no-browser-tts)  WITH_BROWSER_TTS=0 ;;
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
  if [[ "$WITH_POSTGRES" -eq 1 || "$WITH_PGADMIN" -eq 1 ]]; then APT_RINGKAS+=", gnupg"; fi
  if [[ "$WITH_FFMPEG" -eq 1 ]]; then APT_RINGKAS+=", ffmpeg"; fi
  echo "Installer OpenMAIC akan:"
  echo "  - apt install: ${APT_RINGKAS}"
  if [[ "$WITH_POSTGRES" -eq 1 ]]; then
    echo "  - setup database Postgres 'openmaic' di PG ${PG_MAJOR} (repo PGDG)"
  else
    echo "  - tanpa PostgreSQL (--no-postgres): agent runtime + persistence mati"
  fi
  if [[ "$WITH_PGADMIN" -eq 1 ]]; then
    echo "  - instal pgAdmin4 web siap pakai (repo pgadmin.org + setup otomatis -> http://localhost/pgadmin4)"
  else
    echo "  - tanpa pgAdmin4 web (--no-pgadmin)"
  fi
  echo "  - instal Node.js 24 (bila belum memenuhi syarat) + pnpm 12.6.0"
  if [[ "$WITH_OPENCODE" -eq 1 ]]; then
    echo "  - instal OpenCode CLI v2"
  fi
  if [[ "$WITH_BROWSER_TTS" -eq 1 ]]; then
    echo "  - aktifkan TTS browser-native tanpa API key (Web Speech API)"
  else
    echo "  - tanpa TTS browser-native (--no-browser-tts): narasi butuh provider TTS ber-key"
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
#   gnupg            dearmor kunci PGDG/pgAdmin (bila Postgres/pgAdmin dipakai)
APT_PKGS=(
  ca-certificates curl git
  python3 build-essential pkg-config
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev
)
if [[ "$WITH_POSTGRES" -eq 1 || "$WITH_PGADMIN" -eq 1 ]]; then APT_PKGS+=(gnupg); fi

# ------------------------------------------------- sanitasi sumber r2u (deb-src)
# r2u (https://r2u.stat.illinois.edu/ubuntu) hanya menyediakan paket binary
# (deb), tanpa `main/source/Sources`. Bila entri deb-src-nya aktif — mis. dari
# opsi "Enable source code", salin-tempel `Types: deb deb-src`, atau baris
# `deb-src ...r2u...` — tiap `apt-get update` (di script ini ada beberapa
# kali: awal, PGDG, NodeSource) memancarkan:
#   W: Skipping acquire of configured file 'main/source/Sources' as repository
#      'https://r2u.stat.illinois.edu/ubuntu noble InRelease' does not seem to
#      provide it (sources.list entry misspelt?)
# Ini peringatan saja (exit 0), tapi menutupi warning yang penting. Perbaiki
# idempoten sebelum update pertama: komentari baris `deb-src ...r2u...`
# (format one-line *.list) dan sederhanakan `Types: deb deb-src` -> `Types:
# deb` hanya pada file yang isinya r2u (format DEB822 *.sources). Repo lain
# tidak disentuh; run ulang aman (pola hanya cocok bila deb-src masih aktif).
sanitasi_r2u_debsrc() {
  local f
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do
    [[ -f "$f" ]] || continue
    if grep -Eq '^[[:space:]]*deb-src[[:space:]].*r2u\.stat\.illinois\.edu' "$f" 2>/dev/null; then
      info "Menonaktifkan baris deb-src r2u di $f (r2u tidak menyediakan Sources)..."
      run_as_root sed -i -E 's|^[[:space:]]*deb-src([[:space:]].*r2u\.stat\.illinois\.edu.*)|# deb-src\1  # dinonaktifkan install.sh: r2u tanpa Sources|' "$f"
    fi
  done
  for f in /etc/apt/sources.list.d/*.sources; do
    [[ -f "$f" ]] || continue
    grep -q "r2u.stat.illinois.edu" "$f" 2>/dev/null || continue
    grep -qE '^[[:space:]]*Types:.*deb-src' "$f" 2>/dev/null || continue
    # File campuran (ada stanza non-r2u di file yang sama): jangan sed global
    # agar repo lain tidak ikut kehilangan deb-src-nya.
    if grep -Eq '^[[:space:]]*URIs:' "$f" 2>/dev/null \
      && grep -E '^[[:space:]]*URIs:' "$f" | grep -qv "r2u.stat.illinois.edu"; then
      warn "File $f memuat stanza r2u + repo lain; betulkan manual: ubah 'Types: deb deb-src' menjadi 'Types: deb' hanya pada stanza r2u."
      continue
    fi
    info "Menonaktifkan Types deb-src r2u di $f (r2u tidak menyediakan Sources)..."
    run_as_root sed -i -E 's|^[[:space:]]*Types:.*deb-src.*|Types: deb|' "$f"
  done
}
sanitasi_r2u_debsrc

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
  local tts_browser_line="${13:-TTS_BROWSER_NATIVE_ENABLED=true}"
  # PENTING: heredoc di bawah SENGAJA tanpa quote (<<EOF) agar ${...} dan
  # $(date ...) terekspansi. Konsekuensinya backtick literal dan $(...) ikut
  # dieksekusi shell — jadi semua backtick literal WAJIB ditulis \`...\`.
  # Satu saja backtick tak-terescape (apalagi ``` ganjil) berakibat fatal:
  # "bad substitution", .env.local 0 byte, installer exit 1 di langkah ini.
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
#   3. OpenCode free CLI : ${tier_default} (tanpa auth sama sekali; default =
#      muse-spark bila ada di daftar free, else entri pertama OPENCODE_MODELS)
# Slug tier2 persis katalog \`opencode models\` (terverifikasi); butuh
# registrasi provider opencode-go di lib/ai/providers.ts (sudah ada).
# CLI diinstal via: curl -fsSL https://opencode.ai/v2/install | bash
# Dokumentasi semua variabel: lihat .env.example
# =============================================================================

# --- Tier model Pro Workbench (auto: ${tier_name}) --------------------------------
# Harus \`provider:model\` dengan provider terdaftar; tanpa ini resolveModel throw.
DEFAULT_MODEL=${tier_default}
# Route eksplisit maic-agent-driver (wajib + \`api\` saat agent runtime aktif).
# Tier ber-key (1/2): HTTP OpenAI-compatible (\`openai-completions\`).
# Tier-3 gratis: driver khusus CLI (\`opencode-cli\`, alias \`cli\`/\`opencode\`) —
# eksekusi lokal \`opencode run\` tanpa key; function tools via envelope
# \`\`\`tool_calls (lib/ai/opencode-cli.ts + lib/server/agent-runtime/agent-driver-model.ts).
# Paritas tool-calling dengan LLM ber-key: SEMUA blok fence valid dipakai
# berurutan, argumen divalidasi terhadap skema tool, sekali repair otomatis
# bila upaya call gagal parse, dan skills disajikan identik (prompt sama) —
# hanya seed yang tetap unsupported.
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
# OPENCODE_MODELS: SEMUA model free yang diaktifkan (comma-separated, diambil
# dari `opencode models` oleh install.sh; boleh diisi manual):
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

# --- TTS tanpa API key (browser-native, Web Speech API) ---------------------------
# Default ON: narasi bunyi langsung tanpa key/server. Nilai dibaca server saat
# runtime (restart cukup, tanpa rebuild); client default juga ON sehingga fresh
# install langsung bersuara. Matikan via --no-browser-tts (nilai false) bila
# ingin mewajibkan provider TTS ber-key (lihat .env.example bagian TTS).
${tts_browser_line}
# Provider TTS ber-key tetap opsional (ISI MANUAL bila dipakai):
# TTS_OPENAI_API_KEY=
# TTS_MINIMAX_API_KEY=

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
# Bila baris aktif ada tapi nilainya KOSONG (mis. DATABASE_URL= dari run saat
# Postgres belum siap, atau sisa run gagal), isi dengan nilai baru agar run
# ulang pulih — nilai non-kosong milik user tidak pernah disentuh.
pastikan_var_env() {
  local file="$1" key="$2" value="$3" escaped current
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

# TTS browser-native (Web Speech API, tanpa API key) default ON. Flag installer
# adalah sumber kebenaran (pola set_agent_runtime_flag): run default menulis
# true, --no-browser-tts menulis false. Idempoten, aman tiap run.
set_tts_browser_flag() {
  local enabled="$1" reason="$2"
  if grep -qE "^[[:space:]]*TTS_BROWSER_NATIVE_ENABLED=${enabled}$" .env.local; then return 0; fi
  if grep -qE "^[[:space:]]*TTS_BROWSER_NATIVE_ENABLED=" .env.local; then
    sed -i -E "s|^[[:space:]]*TTS_BROWSER_NATIVE_ENABLED=.*|TTS_BROWSER_NATIVE_ENABLED=${enabled}|" .env.local
  elif grep -qE "^[[:space:]]*#[[:space:]]*TTS_BROWSER_NATIVE_ENABLED=" .env.local; then
    sed -i -E "s|^[[:space:]]*#[[:space:]]*TTS_BROWSER_NATIVE_ENABLED=.*|TTS_BROWSER_NATIVE_ENABLED=${enabled}|" .env.local
  else
    echo "TTS_BROWSER_NATIVE_ENABLED=${enabled}" >> .env.local
  fi
  info "TTS_BROWSER_NATIVE_ENABLED=${enabled} (${reason})."
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
#           (default; eksekusi lokal, tanpa auth; terverifikasi RC=0 tanpa
#           kredensial). SEMUA model free dari `opencode models` diambil lalu
#           diaktifkan di OPENCODE_MODELS (comma-separated); tombol pemilih model
#           di /workspace memilih di antaranya (GET/POST /api/agent/models).
TIER1_MODEL="google:gemini-3.5-flash-lite"
TIER1_KEY_VAR="GOOGLE_API_KEY"
TIER2_MODEL="opencode-go:gpt-6-luna"
TIER2_KEY_PRIMARY="OPENCODE_API_KEY"
TIER2_KEY_HTTP="OPENCODE_GO_API_KEY"
TIER3_MODEL="opencode:muse-spark-1.3-contributor-free"
# Fallback katalog provider `opencode` (lib/ai/providers.ts) bila CLI belum
# ada / offline: SEMUA model free diaktifkan, bukan satu pin saja.
OPENCODE_FREE_FALLBACK="space-bunny-free,muse-spark-1.3-contributor-free,big-pickle,longcat-2.5-preview-free,mimo-v2.6-flash-free,ling-3.0-flash-fin-free,nemotron-3-ultra-free,nemotron-3.5-lightning-free"
# Pin katalog provider `opencode` agar CLI gratis selalu discoverable.
# Kompatibel lama (single id) — nilai aktif kini daftar comma-separated
# dari daftar_model_free_opencode (CLI `opencode models` atau fallback).
TIER_PIN="muse-spark-1.3-contributor-free"

# Ambil SEMUA model free opencode-cli (`opencode models`) sebagai daftar
# comma-separated, lalu aktifkan di OPENCODE_MODELS. Idempoten, toleran offline:
# gagal/CLI absen -> fallback katalog di atas.
# Output: satu baris `id1,id2,...` (bare id tanpa prefix `opencode/`).
daftar_model_free_opencode() {
  local bin="${1:-}" out="" json_tmp="" txt_tmp="" _home="" _sudo_home=""
  if [[ -z "$bin" ]]; then
    # Saat sudo, $HOME=/root — cari home pemilik sesi dulu agar kandidat benar.
    if [[ -n "${SUDO_USER:-}" ]]; then
      _sudo_home="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6 || true)"
    fi
    for _home in "${_sudo_home:-}" "${OPENCODE_TARGET_HOME:-}" "$HOME"; do
      [[ -n "$_home" ]] || continue
      for cand in "$_home/.opencode/bin/opencode" "$_home/bin/opencode"; do
        if [[ -x "$cand" ]]; then bin="$cand"; break 2; fi
      done
    done
    [[ -z "$bin" ]] && bin="$(command -v opencode 2>/dev/null || true)"
    [[ -z "$bin" ]] && bin="${OPENCODE_BIN_DETECTED:-}"
  fi
  if [[ -n "$bin" && -x "$bin" ]] && command -v timeout >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    json_tmp="$(mktemp 2>/dev/null || echo '')"
    if [[ -n "$json_tmp" ]]; then
      if timeout 30 "$bin" models --format json >"$json_tmp" 2>/dev/null; then
        out="$(node -e '
          const fs=require("node:fs");
          try{
            const raw=fs.readFileSync(process.argv[1],"utf8");
            const j=JSON.parse(raw);
            const arr=Array.isArray(j)?j:(Array.isArray(j.models)?j.models:(Array.isArray(j.data)?j.data:[]));
            const ids=[];
            for(const m of arr){
              if(typeof m==="string"){ ids.push(m); continue; }
              if(!m||typeof m!=="object") continue;
              const id=String(m.id||m.slug||m.name||"");
              if(!id) continue;
              ids.push(id);
            }
            const free=ids.map((s)=>s.trim()).filter(Boolean)
              .map((s)=>s.replace(/^opencode[\/:]/,""))
              .filter((s)=>/free$|big-pickle/i.test(s));
            console.log([...new Set(free)].join(","));
          }catch{ process.exit(1); }
        ' "$json_tmp" 2>/dev/null || true)"
      fi
      rm -f "$json_tmp"
    fi
    if [[ -z "$out" ]]; then
      txt_tmp="$(mktemp 2>/dev/null || echo '')"
      if [[ -n "$txt_tmp" ]]; then
        if timeout 30 "$bin" models >"$txt_tmp" 2>/dev/null; then
          out="$(grep -oE 'opencode[/:][A-Za-z0-9._-]+' "$txt_tmp" 2>/dev/null \
            | sed -E 's|^opencode[/:]||' | grep -Ei 'free$|big-pickle' || true)"
          out="$(printf '%s' "$out" | awk 'NF && !seen[$0]++' | paste -sd, - 2>/dev/null || true)"
        fi
        rm -f "$txt_tmp"
      fi
    fi
  fi
  if [[ -z "$out" ]]; then out="$OPENCODE_FREE_FALLBACK"; fi
  # Pastikan default tier3 selalu ikut (idempoten, di depan bila belum ada).
  if [[ ",${out}," != *",muse-spark-1.3-contributor-free,"* ]]; then
    out="muse-spark-1.3-contributor-free${out:+,}${out}"
  fi
  printf '%s' "$out"
}

# Model default tier3 = entri pertama daftar free (preferensi muse-spark bila ada).
tier3_default_dari_daftar() {
  local daftar="${1:-$OPENCODE_FREE_FALLBACK}" pertama=""
  if [[ ",${daftar}," == *",muse-spark-1.3-contributor-free,"* ]]; then
    printf 'opencode:muse-spark-1.3-contributor-free'
    return
  fi
  pertama="$(printf '%s' "$daftar" | cut -d, -f1 | tr -d '[:space:]')"
  [[ -z "$pertama" ]] && pertama="muse-spark-1.3-contributor-free"
  printf 'opencode:%s' "$pertama"
}

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
  # Hanya untuk tier ber-key (1/2). Tier-3 membangun route langsung via printf
  # dengan default dinamis tier3_default_dari_daftar (lihat 2 situs pemanggil).
  printf '{"maic-agent-driver":{"model":"%s","api":"openai-completions"}}' "$(tier_default_model "$1")"
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

# Run yang gagal di tengah (mis. heredoc template) meninggalkan .env.local
# 0 byte, karena `> .env.local` memotong file SEBELUM isi ditulis. Anggap file
# kosong sebagai tidak ada agar run ulang mengambil jalur buat-baru (atomik di
# bawah), bukan jalur lengkapi.
if [[ -f .env.local && ! -s .env.local ]]; then
  warn ".env.local kosong (0 byte, sisa run yang gagal) — dibuat ulang dari template."
  rm -f .env.local
fi
# Bersihkan file sementara dari run yang terinterupsi sebelum mulai yang baru.
rm -f .env.local.tmp.*
if [[ ! -f .env.local ]]; then
  info "Membuat .env.local baru dari template..."
  # Tier dari environment (file belum ada). Runtime agen ON bila DB ada —
  # tier-3 gratis dilayani driver khusus CLI (opencode-cli, tanpa key).
  # Ambil SEMUA model free opencode-cli lalu aktifkan di OPENCODE_MODELS.
  OPENCODE_FREE_LIST="$(daftar_model_free_opencode "" 2>/dev/null || printf '%s' "$OPENCODE_FREE_FALLBACK")"
  [[ -n "$OPENCODE_FREE_LIST" ]] || OPENCODE_FREE_LIST="$OPENCODE_FREE_FALLBACK"
  if [[ "$OPENCODE_FREE_LIST" != "$OPENCODE_FREE_FALLBACK" ]]; then
    info "Model free OpenCode terdeteksi (${OPENCODE_FREE_LIST})."
  fi
  TIER="$(pilih_tier_model .env.local)"
  if [[ "$TIER" == "tier3" ]]; then
    TIER_DEFAULT="$(tier3_default_dari_daftar "$OPENCODE_FREE_LIST")"
    # Konstruksi langsung (tanpa sed-replace) agar tak rapuh bila format berubah.
    TIER_DRIVER="$(printf '{"maic-agent-driver":{"model":"%s","api":"opencode-cli"}}' "$TIER_DEFAULT")"
    TIER_PIN="$OPENCODE_FREE_LIST"
  else
    TIER_DEFAULT="$(tier_default_model "$TIER")"
    TIER_DRIVER="$(tier_driver_route "$TIER")"
    TIER_PIN="$OPENCODE_FREE_LIST"
  fi
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
  if [[ "$WITH_BROWSER_TTS" -eq 1 ]]; then TTS_BROWSER_LINE="TTS_BROWSER_NATIVE_ENABLED=true"; else TTS_BROWSER_LINE="TTS_BROWSER_NATIVE_ENABLED=false"; fi
  info "Tier model Pro Workbench: ${TIER} (${TIER_DEFAULT})."
  if [[ -n "${GO_MIRRORED_FRESH:-}" ]]; then
    info "OPENCODE_GO_API_KEY disalin dari OPENCODE_API_KEY (gateway Zen yang sama) untuk driver HTTP."
  fi
  if [[ "$WITH_BROWSER_TTS" -eq 1 ]]; then
    info "TTS browser-native: AKTIF tanpa API key (Web Speech API)."
  else
    info "TTS browser-native: NONAKTIF (--no-browser-tts) — narasi butuh provider TTS ber-key."
  fi
  if [[ -n "$DATABASE_URL_VALUE" ]]; then
    # Tulis atomik via file sementara + mv: bila template gagal di tengah,
    # .env.local tidak pernah ada dalam keadaan terpotong — run ulang aman.
    TMP_ENV_BARU="$(mktemp .env.local.tmp.XXXXXX)"
    tulis_template_env "$DATABASE_URL_VALUE" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "$AGENT_RT" "" "$TIER" "$TIER_DEFAULT" "$TIER_DRIVER" "$TIER_PIN" "$TIER1_KEY_LINE" "$TIER2_KEY_LINE" "$TIER2GO_KEY_LINE" "$TTS_BROWSER_LINE" > "$TMP_ENV_BARU" \
      || { rm -f "$TMP_ENV_BARU"; fail "gagal menulis template .env.local (lihat error di atas)."; }
    chmod 600 "$TMP_ENV_BARU"
    mv -f "$TMP_ENV_BARU" .env.local
    if [[ "$AGENT_RT" == "false" ]]; then
      info "Agent runtime nonaktif (tanpa DATABASE_URL). Tier-3 tetap didukung driver CLI bila DB ada."
    fi
  else
    TMP_ENV_BARU="$(mktemp .env.local.tmp.XXXXXX)"
    tulis_template_env "" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "$AGENT_RT" "" "$TIER" "$TIER_DEFAULT" "$TIER_DRIVER" "$TIER_PIN" "$TIER1_KEY_LINE" "$TIER2_KEY_LINE" "$TIER2GO_KEY_LINE" "$TTS_BROWSER_LINE" > "$TMP_ENV_BARU" \
      || { rm -f "$TMP_ENV_BARU"; fail "gagal menulis template .env.local (lihat error di atas)."; }
    chmod 600 "$TMP_ENV_BARU"
    mv -f "$TMP_ENV_BARU" .env.local
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
  # Ambil SEMUA model free lalu aktifkan di OPENCODE_MODELS (tombol pemilih
  # model /workspace memakai daftar ini via GET /api/agent/models).
  OPENCODE_FREE_LIST="$(daftar_model_free_opencode "" 2>/dev/null || printf '%s' "$OPENCODE_FREE_FALLBACK")"
  [[ -n "$OPENCODE_FREE_LIST" ]] || OPENCODE_FREE_LIST="$OPENCODE_FREE_FALLBACK"
  TIER_PIN="$OPENCODE_FREE_LIST"
  TIER="$(pilih_tier_model .env.local)"
  if [[ "$TIER" == "tier3" ]]; then
    TIER_DEFAULT="$(tier3_default_dari_daftar "$OPENCODE_FREE_LIST")"
    TIER_DRIVER="$(printf '{"maic-agent-driver":{"model":"%s","api":"opencode-cli"}}' "$TIER_DEFAULT")"
  else
    TIER_DEFAULT="$(tier_default_model "$TIER")"
    TIER_DRIVER="$(tier_driver_route "$TIER")"
  fi
  info "Tier model Pro Workbench: ${TIER} (${TIER_DEFAULT})."
  info "Model free aktif (OPENCODE_MODELS): ${OPENCODE_FREE_LIST}."
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
    ollama:*|opencode:gpt-6-luna|opencode-go:gpt-6-luna|google:gemini-3.5-flash-lite|deepseek:deepseek-flash|opencode:space-bunny-free|opencode:muse-spark-1.3-contributor-free|opencode:big-pickle|opencode:longcat-2.5-preview-free|opencode:mimo-v2.6-flash-free|opencode:ling-3.0-flash-fin-free|opencode:nemotron-3-ultra-free|opencode:nemotron-3.5-lightning-free|opencode:*-free|tokendance:deepseek-v4.1-flash)
      if [[ "$CUR_DEFAULT" != "$TIER_DEFAULT" ]]; then
        DM_ESCAPED="$(sed_escape_replacement "$TIER_DEFAULT")"
        sed -i -E "s|^[[:space:]]*DEFAULT_MODEL=.*|DEFAULT_MODEL=${DM_ESCAPED}|" .env.local
        info "DEFAULT_MODEL dipindah ${CUR_DEFAULT} -> ${TIER_DEFAULT} (${TIER})."
      fi
      ;;
  esac
  CUR_DRIVER="$(sed -n -E 's/^[^#]*"maic-agent-driver"[^}]*"model"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' .env.local | head -1)"
  case "$CUR_DRIVER" in
    ollama:*|opencode:gpt-6-luna|opencode-go:gpt-6-luna|google:gemini-3.5-flash-lite|deepseek:deepseek-flash|opencode:space-bunny-free|opencode:muse-spark-1.3-contributor-free|opencode:big-pickle|opencode:longcat-2.5-preview-free|opencode:mimo-v2.6-flash-free|opencode:ling-3.0-flash-fin-free|opencode:nemotron-3-ultra-free|opencode:nemotron-3.5-lightning-free|opencode:*-free|tokendance:deepseek-v4.1-flash)
      if [[ "$CUR_DRIVER" != "$TIER_DEFAULT" ]]; then
        DR_RE='ollama:[^"\\} ]*|opencode:gpt-6-luna|opencode-go:gpt-6-luna|google:gemini-3\.5-flash-lite|deepseek:deepseek-flash|opencode:space-bunny-free|opencode:muse-spark-1\.3-contributor-free|opencode:big-pickle|opencode:longcat-2\.5-preview-free|opencode:mimo-v2\.6-flash-free|opencode:ling-3\.0-flash-fin-free|opencode:nemotron-3-ultra-free|opencode:nemotron-3\.5-lightning-free|opencode:[^"\\} ]*-free|tokendance:deepseek-v4\.1-flash'
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
  # kustom lain tidak disentuh. Model free kini daftar comma-separated berisi
  # SEMUA model free (tombol /workspace memilih di antaranya). Hanya migrasi
  # bila tiap entri adalah id milik installer (daftar fallback) — nilai kustom
  # operator (mis. berisi id non-free) dipertahankan.
  CUR_PIN="$(env_get .env.local OPENCODE_MODELS)"
  if [[ -n "$CUR_PIN" ]]; then
    _pin_milik_installer=1
    _ifs_lama="$IFS"; IFS=','; set -f
    for _satu in $CUR_PIN; do
      _satu="$(printf '%s' "$_satu" | tr -d '[:space:]' | sed -E 's|^opencode[/:]||')"
      case ",${OPENCODE_FREE_FALLBACK},gpt-6-luna," in
        *",${_satu},"*) ;;
        *) _pin_milik_installer=0; break ;;
      esac
    done
    set +f; IFS="$_ifs_lama"; unset _ifs_lama _satu
    if [[ "$_pin_milik_installer" -eq 1 && "$CUR_PIN" != "$TIER_PIN" ]]; then
      PIN_ESCAPED="$(sed_escape_replacement "$TIER_PIN")"
      sed -i -E "s|^[[:space:]]*OPENCODE_MODELS=.*|OPENCODE_MODELS=${PIN_ESCAPED}|" .env.local
      info "OPENCODE_MODELS dipindah ${CUR_PIN} -> ${TIER_PIN} (semua model free aktif)."
    elif [[ "$_pin_milik_installer" -eq 0 ]]; then
      info "OPENCODE_MODELS kustom dipertahankan (${CUR_PIN})."
    fi
    unset _pin_milik_installer
  fi
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
  # TTS browser-native tanpa API key (Web Speech API) default ON. Flag installer
  # adalah sumber kebenaran: default menulis true, --no-browser-tts menulis
  # false (narasi lalu butuh provider TTS ber-key, lihat .env.example TTS).
  if [[ "$WITH_BROWSER_TTS" -eq 1 ]]; then
    set_tts_browser_flag true "browser-native default ON (tanpa API key)"
    pastikan_var_env .env.local TTS_BROWSER_NATIVE_ENABLED "true"
  else
    set_tts_browser_flag false "--no-browser-tts (butuh provider TTS ber-key)"
    pastikan_var_env .env.local TTS_BROWSER_NATIVE_ENABLED "false"
  fi
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

# ============================================================ 5b. pgAdmin4 web
# Default ON (lewati dengan --no-pgadmin). Server headless -> varian
# pgadmin4-web saja (tanpa desktop). Sumber resmi:
# https://www.pgadmin.org/download/pgadmin-4-apt/
# Siap pakai: setup-web.sh dijalankan non-interaktif (--yes +
# PGADMIN_SETUP_EMAIL/PASSWORD, mekanisme resmi upstream) sehingga
# http://localhost/pgadmin4 langsung bisa login tanpa langkah manual.
# Idempoten: repo dicek dulu; setup-web.sh hanya saat database konfigurasi
# pgAdmin belum ada; kredensial dipakai ulang dari .env.local (jangan putar
# password tiap run — login web yang tersimpan akan rusak).
if [[ "$WITH_PGADMIN" -eq 1 ]]; then
  LANGKAH="pgAdmin4: kredensial"
  # Nilai flag/env yang sudah terisi = dipaksa (pola yang sama dipakai
  # --pg-password/PG_PASSWORD di seksi 4). Cek SEBELUM baca .env.local.
  if [[ -n "$PGADMIN_EMAIL" || -n "$PGADMIN_PASSWORD" ]]; then PGADMIN_CREDS_FORCED=1; fi
  if [[ -z "$PGADMIN_EMAIL" && -f .env.local ]]; then
    PGADMIN_EMAIL="$(env_get .env.local PGADMIN_EMAIL)"
  fi
  if [[ -z "$PGADMIN_EMAIL" ]]; then
    PGADMIN_EMAIL="$PGADMIN_EMAIL_DEFAULT"
    info "Email pgAdmin memakai default ${PGADMIN_EMAIL} (ubah via --pgadmin-email)."
  fi
  [[ "$PGADMIN_EMAIL" == *"@"* ]] \
    || fail "Email pgAdmin tidak valid: '${PGADMIN_EMAIL}' (butuh format email)."
  PGADMIN_DOMAIN="${PGADMIN_EMAIL##*@}"
  [[ "$PGADMIN_DOMAIN" == *.* ]] \
    || fail "Email pgAdmin tidak valid: '${PGADMIN_EMAIL}' (domain harus mengandung titik; contoh: admin@openmaic.id)."
  # pgAdmin 9.x menolak domain .local (special-use, mDNS) via email_validator:
  # login selalu gagal "Incorrect username or password" walau password benar.
  if [[ "${PGADMIN_EMAIL,,}" == *.local ]]; then
    fail "Email pgAdmin '${PGADMIN_EMAIL}' memakai domain .local yang ditolak pgAdmin 9.x. Pakai misalnya admin@openmaic.id (--pgadmin-email=admin@openmaic.id)."
  fi
  if [[ -z "$PGADMIN_PASSWORD" && -f .env.local ]]; then
    PGADMIN_PASSWORD="$(env_get .env.local PGADMIN_PASSWORD)"
  fi
  if [[ -z "$PGADMIN_PASSWORD" ]]; then
    PGADMIN_PASSWORD="$(rand_hex 16)"
    info "Password pgAdmin dibuat acak dan disimpan di .env.local (PGADMIN_PASSWORD)."
  fi
  if [[ "${#PGADMIN_PASSWORD}" -lt 6 ]]; then
    fail "Password pgAdmin minimal 6 karakter (ketentuan pgAdmin)."
  fi

  LANGKAH="apt: repo pgAdmin4"
  # Deteksi via isi file sumber, bukan apt-cache policy | grep -q (alasan
  # SIGPIPE sama seperti repo PGDG di atas).
  PGADMIN_LIST=/etc/apt/sources.list.d/pgadmin4.list
  PGADMIN_KEYRING=/etc/apt/keyrings/packages-pgadmin-org.gpg
  pgadmin_sudah_terdaftar=1
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*; do
    [[ -f "$f" ]] || continue
    if grep -qs "pgadmin" "$f"; then pgadmin_sudah_terdaftar=0; break; fi
  done
  if [[ "$pgadmin_sudah_terdaftar" -eq 0 ]]; then
    info "Repo pgAdmin4 sudah terdaftar — lewati penambahan."
  else
    info "Menambahkan repo pgAdmin4 (pgadmin.org)..."
    run_as_root install -d -m 0755 /etc/apt/keyrings
    PGADMIN_TMP="$(mktemp)"
    curl -fsSL https://www.pgadmin.org/static/packages_pgadmin_org.pub -o "$PGADMIN_TMP"
    run_as_root gpg --batch --yes --dearmor -o "$PGADMIN_KEYRING" "$PGADMIN_TMP"
    rm -f "$PGADMIN_TMP"
    run_as_root chmod 0644 "$PGADMIN_KEYRING"
    # Codename distro dari /etc/os-release (paket lsb-release sengaja tidak dipakai;
    # setara lsb_release -cs pada panduan resmi pgAdmin).
    # shellcheck disable=SC1091  # /etc/os-release selalu ada di Ubuntu/Debian
    CODENAME="$(. /etc/os-release 2>/dev/null && printf '%s' "${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}")"
    [[ -n "$CODENAME" ]] || fail "Tidak bisa membaca VERSION_CODENAME dari /etc/os-release (Paket lsb-release sengaja tidak dipakai)."
    echo "deb [signed-by=$PGADMIN_KEYRING] https://ftp.postgresql.org/pub/pgadmin/pgadmin4/apt/${CODENAME} pgadmin4 main" \
      | run_as_root tee "$PGADMIN_LIST" >/dev/null
    run_as_root apt-get update -o Acquire::Retries=3
  fi
  LANGKAH="apt: pgAdmin4 web"
  info "Menginstal pgAdmin4 web (pgadmin4-web; desktop sengaja tidak)..."
  run_as_root apt-get install -y -o Acquire::Retries=3 pgadmin4-web

  # Sinkronkan user pgAdmin via setup.py. pgAdmin 9.x: setup-web.sh tidak
  # membuat user (PGADMIN_SETUP_* diabaikan) dan setup-db hanya migrasi,
  # jadi user dibuat/disinkronkan eksplisit. Idempoten: update bila ada,
  # add bila belum ada.
  pgadmin_sync_user() {
    local pgadmin_py upd_out
    pgadmin_py="/usr/pgadmin4/venv/bin/python3"
    if [[ ! -x "$pgadmin_py" ]]; then
      warn "Sinkronisasi user pgAdmin gagal (${pgadmin_py} tidak ada); kelola manual via http://localhost/pgadmin4."
      return 1
    fi
    upd_out="$(run_as_root "$pgadmin_py" /usr/pgadmin4/web/setup.py update-user "$PGADMIN_EMAIL" --password "$PGADMIN_PASSWORD" --admin 2>&1 || true)"
    if printf '%s' "$upd_out" | grep -qi "user not found"; then
      if run_as_root "$pgadmin_py" /usr/pgadmin4/web/setup.py add-user "$PGADMIN_EMAIL" "$PGADMIN_PASSWORD" --admin >/dev/null 2>&1; then
        info "User pgAdmin ${PGADMIN_EMAIL} dibuat."
      else
        warn "Buat user pgAdmin gagal; kelola manual via http://localhost/pgadmin4."
        return 1
      fi
    elif printf '%s' "$upd_out" | grep -qiE "something went wrong|traceback"; then
      warn "Sinkronisasi kredensial pgAdmin gagal; ubah manual via http://localhost/pgadmin4."
      return 1
    else
      info "User pgAdmin ${PGADMIN_EMAIL} siap."
    fi
    # setup.py berjalan sebagai root sehingga file DB bisa berubah owner;
    # kembalikan ke www-data agar Apache/WSGI bisa baca-tulis.
    run_as_root chown -R www-data: /var/lib/pgadmin /var/log/pgadmin 2>/dev/null || true
  }

  # Daftarkan koneksi PostgreSQL 'openmaic' ke pgAdmin agar database bisa
  # dijelajah dari web UI (Servers > openmaic). Idempoten (upsert by name):
  # aman tiap run, sekaligus menyelaraskan ulang bila password/port berubah.
  # Password server dienkripsi dengan password login pgAdmin (kunci crypt
  # pgAdmin server-mode), jadi registrasi selalu memakai nilai PGADMIN_*
  # aktif — panggil setelah pgadmin_sync_user + .env.local tersimpan.
  # Selalu kembalikan 0 agar installer lanjut (gagal = warn saja).
  pgadmin_register_server() {
    local db_url pg_tmp pg_py
    pg_py="/usr/pgadmin4/venv/bin/python3"
    if [[ ! -x "$pg_py" ]]; then
      warn "Registrasi server pgAdmin dilewati (${pg_py} tidak ada)."
      return 0
    fi
    db_url="${DATABASE_URL_VALUE:-}"
    if [[ -z "$db_url" && -f .env.local ]]; then
      db_url="$(env_get .env.local DATABASE_URL)"
    fi
    if [[ "$db_url" != postgres*://* ]]; then
      info "Lewati registrasi server pgAdmin (DATABASE_URL tidak tersedia)."
      return 0
    fi
    pg_tmp="$(mktemp)"
    chmod 600 "$pg_tmp"
    cat >"$pg_tmp" <<'PGPYEOF'
import os, sys
sys.path.insert(0, '/usr/pgadmin4/web')
import config
from pgadmin import create_app
from urllib.parse import urlparse, unquote

email = os.environ['PGADMIN_EMAIL']
pgadmin_pw = os.environ['PGADMIN_PASSWORD']
u = urlparse(os.environ['OPENMAIC_DATABASE_URL'])
pg_host = u.hostname or 'localhost'
pg_port = u.port or 5432
pg_user = unquote(u.username or '')
pg_pass = unquote(u.password or '')
pg_db = (u.path or '/openmaic').lstrip('/') or 'openmaic'
if not pg_user or not pg_pass:
    print('DB user/password kosong di DATABASE_URL.')
    sys.exit(3)

app = create_app(config.APP_NAME + '-cli')
with app.test_request_context():
    from pgadmin.model import db, User, Server, ServerGroup
    from pgadmin.utils.constants import INTERNAL
    from pgadmin.utils.crypto import encrypt
    user = User.query.filter_by(username=email, auth_source=INTERNAL).first()
    if user is None:
        print('USER_NOT_FOUND ' + email)
        sys.exit(2)
    group = ServerGroup.query.filter_by(user_id=user.id, name='Servers').first()
    if group is None:
        group = ServerGroup(name='Servers', user_id=user.id)
        db.session.add(group)
        db.session.commit()
    enc = encrypt(pg_pass, pgadmin_pw)
    srv = Server.query.filter_by(user_id=user.id, name='openmaic').first()
    if srv is None:
        srv = Server(
            user_id=user.id, servergroup_id=group.id, name='openmaic',
            host=pg_host, port=pg_port, maintenance_db=pg_db,
            username=pg_user, password=enc, save_password=1,
            comment='OpenMAIC PostgreSQL (install.sh)',
            use_ssh_tunnel=0, tunnel_authentication=0,
            tunnel_prompt_password=1, shared=False,
            kerberos_conn=False, cloud_status=0, is_adhoc=0,
            connection_params={'sslmode': 'prefer'},
        )
        db.session.add(srv)
        action = 'created'
    else:
        srv.servergroup_id = group.id
        srv.host, srv.port = pg_host, pg_port
        srv.maintenance_db, srv.username = pg_db, pg_user
        srv.password, srv.save_password = enc, 1
        srv.connection_params = {'sslmode': 'prefer'}
        action = 'updated'
    db.session.commit()
    print('SERVER_%s id=%s host=%s port=%s db=%s user=%s' % (
        action.upper(), srv.id, pg_host, pg_port, pg_db, pg_user))
PGPYEOF
    if run_as_root env PGADMIN_EMAIL="$PGADMIN_EMAIL" \
        PGADMIN_PASSWORD="$PGADMIN_PASSWORD" \
        OPENMAIC_DATABASE_URL="$db_url" \
        "$pg_py" "$pg_tmp"; then
      info "Server pgAdmin 'openmaic' terdaftar untuk ${PGADMIN_EMAIL}."
    else
      warn "Registrasi server pgAdmin gagal; daftarkan manual via http://localhost/pgadmin4 (Servers > Register > Server)."
    fi
    rm -f "$pg_tmp"
    run_as_root chown -R www-data: /var/lib/pgadmin /var/log/pgadmin 2>/dev/null || true
    return 0
  }

  # Setup awal non-interaktif bila database konfigurasi belum ada. Run ulang
  # setup-db di atas database yang ada hanya migrasi (tidak menyentuh user),
  # jadi setup-web.sh dilewati bila konfigurasi sudah lengkap.
  # NOTE pgAdmin 9.x: path DB = /var/lib/pgadmin/pgadmin4.db (bukan
  # /var/lib/pgadmin4/pgadmin4.db seperti versi lama).

  LANGKAH="pgAdmin4: setup-web"
  PGADMIN_DB="/var/lib/pgadmin/pgadmin4.db"
  PGADMIN_DB_LEGACY="/var/lib/pgadmin4/pgadmin4.db"
  if [[ ( ! -f "$PGADMIN_DB" && ! -f "$PGADMIN_DB_LEGACY" ) || ! -e /etc/apache2/conf-enabled/pgadmin4.conf ]]; then
    info "Menjalankan setup-web.sh non-interaktif untuk ${PGADMIN_EMAIL}..."
    # env di depan meneruskan kredensial lewat sudo yang env_reset
    # (run_as_root meneruskannya sebagai argumen env, bukan variabel shell).
    # Pada pgAdmin 9.x variabel ini diabaikan upstream, tapi tetap
    # diteruskan untuk kompatibilitas versi lama.
    run_as_root env PGADMIN_SETUP_EMAIL="$PGADMIN_EMAIL" \
      PGADMIN_SETUP_PASSWORD="$PGADMIN_PASSWORD" \
      /usr/pgadmin4/bin/setup-web.sh --yes \
      || warn "setup-web.sh gagal; jalankan manual: sudo /usr/pgadmin4/bin/setup-web.sh --yes"
    # pgAdmin 9.x tidak membuat user via setup-web.sh -> buat/sinkronkan
    # eksplisit agar http://localhost/pgadmin4 langsung bisa login.
    pgadmin_sync_user || true
  else
    info "Konfigurasi pgAdmin sudah ada — lewati setup-web.sh."
    if [[ "$PGADMIN_CREDS_FORCED" -eq 1 ]]; then
      # Kredensial dipaksa tapi user sudah ada: setup-db tidak menyentuh
      # user lama, jadi sinkronkan via CLI setup.py (best effort).
      pgadmin_sync_user || true
    fi
  fi

  # Simpan kredensial ke .env.local. Nilai dipaksa = sinkronkan (satu-satunya
  # kasus boleh menimpa, pola yang sama dipakai DATABASE_URL di seksi 5).
  if [[ -f .env.local ]]; then
    if [[ "$PGADMIN_CREDS_FORCED" -eq 1 ]]; then
      PGADMIN_EMAIL_SED="$(sed_escape_replacement "$PGADMIN_EMAIL")"
      PGADMIN_PASS_SED="$(sed_escape_replacement "$PGADMIN_PASSWORD")"
      if grep -qE '^[[:space:]]*PGADMIN_EMAIL=' .env.local; then
        sed -i -E "s|^[[:space:]]*PGADMIN_EMAIL=.*|PGADMIN_EMAIL=${PGADMIN_EMAIL_SED}|" .env.local
      else
        pastikan_var_env .env.local PGADMIN_EMAIL "$PGADMIN_EMAIL"
      fi
      if grep -qE '^[[:space:]]*PGADMIN_PASSWORD=' .env.local; then
        sed -i -E "s|^[[:space:]]*PGADMIN_PASSWORD=.*|PGADMIN_PASSWORD=${PGADMIN_PASS_SED}|" .env.local
      else
        pastikan_var_env .env.local PGADMIN_PASSWORD "$PGADMIN_PASSWORD"
      fi
      info "PGADMIN_EMAIL/PGADMIN_PASSWORD di .env.local disinkronkan dengan nilai yang dipaksa."
    else
      pastikan_var_env .env.local PGADMIN_EMAIL "$PGADMIN_EMAIL"
      pastikan_var_env .env.local PGADMIN_PASSWORD "$PGADMIN_PASSWORD"
    fi
  else
    warn ".env.local tidak ada — kredensial pgAdmin tidak tersimpan. Ulangi ./install.sh untuk menyimpannya."
  fi

  # Daftarkan server database ke pgAdmin (butuh user + DATABASE_URL efektif).
  # Dijalankan tiap run agar password/port yang berubah ikut selaras.
  LANGKAH="pgAdmin4: register server"
  pgadmin_register_server

  # Pastikan Apache jalan (setup-web.sh memakai systemctl; tanpa systemd perlu
  # fallback agar pgAdmin langsung bisa dibuka). Setelah setup, selalu reload
  # agar conf pgadmin4 yang baru di-enable langsung aktif (sebelumnya hanya
  # "sudah berjalan" tanpa reload sehingga /pgadmin4 belum tentu terdaftar).
  LANGKAH="pgAdmin4: apache"
  if pgrep -x apache2 >/dev/null 2>&1; then
    info "Apache sudah berjalan."
  elif command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
    if run_as_root systemctl enable --now apache2; then
      info "Apache dinyalakan."
    else
      warn "Apache gagal dinyalakan — cek: sudo systemctl status apache2"
    fi
  elif command -v service >/dev/null 2>&1; then
    if run_as_root service apache2 start; then
      info "Apache dinyalakan."
    else
      warn "'service apache2 start' gagal; nyalakan manual."
    fi
  elif command -v apache2ctl >/dev/null 2>&1; then
    if run_as_root apache2ctl start; then
      info "Apache dinyalakan."
    else
      warn "apache2ctl start gagal; nyalakan manual."
    fi
  else
    warn "Apache tidak terdeteksi berjalan; nyalakan manual: sudo systemctl start apache2"
  fi
  if pgrep -x apache2 >/dev/null 2>&1; then
    if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
      run_as_root systemctl reload apache2 2>/dev/null || run_as_root systemctl restart apache2 2>/dev/null || true
    elif command -v service >/dev/null 2>&1; then
      run_as_root service apache2 reload 2>/dev/null || run_as_root service apache2 restart 2>/dev/null || true
    elif command -v apache2ctl >/dev/null 2>&1; then
      run_as_root apache2ctl graceful 2>/dev/null || run_as_root apache2ctl restart 2>/dev/null || true
    fi
  fi
  if curl -fsSL -o /dev/null --max-time 15 http://localhost/pgadmin4 2>/dev/null; then
    info "pgAdmin4 web: OK (http://localhost/pgadmin4, login ${PGADMIN_EMAIL})."
  else
    warn "pgAdmin4 belum merespons di http://localhost/pgadmin4 — tunggu Apache selesai restart lalu coba lagi."
  fi
else
  info "Lewati pgAdmin4 web (--no-pgadmin)."
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
  # Ambil SEMUA model free dari CLI lalu aktifkan di OPENCODE_MODELS
  # (comma-separated). Template seksi 5 dibuat SEBELUM CLI terinstal sehingga
  # nilainya masih fallback; segarkan di sini dengan hasil live `opencode models`.
  # Tombol pemilih model /workspace (GET/POST /api/agent/models) memakai daftar ini.
  if [[ -f .env.local ]]; then
    OPENCODE_FREE_LIVE="$(daftar_model_free_opencode "${OPENCODE_BIN_DETECTED:-}" 2>/dev/null || printf '%s' "$OPENCODE_FREE_FALLBACK")"
    [[ -n "$OPENCODE_FREE_LIVE" ]] || OPENCODE_FREE_LIVE="$OPENCODE_FREE_FALLBACK"
    CUR_PIN_LIVE="$(env_get .env.local OPENCODE_MODELS)"
    if [[ -z "$CUR_PIN_LIVE" ]]; then
      echo "OPENCODE_MODELS=${OPENCODE_FREE_LIVE}" >> .env.local
      info "OPENCODE_MODELS disegarkan ke semua model free: ${OPENCODE_FREE_LIVE}."
    else
      _live_milik_installer=1
      _ifs_live="$IFS"; IFS=','; set -f
      for _satu_live in $CUR_PIN_LIVE; do
        _satu_live="$(printf '%s' "$_satu_live" | tr -d '[:space:]' | sed -E 's|^opencode[/:]||')"
        case ",${OPENCODE_FREE_FALLBACK},gpt-6-luna," in
          *",${_satu_live},"*) ;;
          *) _live_milik_installer=0; break ;;
        esac
      done
      set +f; IFS="$_ifs_live"; unset _ifs_live _satu_live
      if [[ "$_live_milik_installer" -eq 1 ]]; then
        if [[ "$CUR_PIN_LIVE" != "$OPENCODE_FREE_LIVE" ]]; then
          PIN_LIVE_ESCAPED="$(sed_escape_replacement "$OPENCODE_FREE_LIVE")"
          sed -i -E "s|^[[:space:]]*OPENCODE_MODELS=.*|OPENCODE_MODELS=${PIN_LIVE_ESCAPED}|" .env.local
          info "OPENCODE_MODELS disegarkan ke semua model free: ${OPENCODE_FREE_LIVE}."
        else
          info "OPENCODE_MODELS sudah memuat semua model free (${CUR_PIN_LIVE})."
        fi
      else
        info "OPENCODE_MODELS kustom dipertahankan (${CUR_PIN_LIVE}); daftar free live: ${OPENCODE_FREE_LIVE}."
      fi
      unset _live_milik_installer
    fi
    # Sinkronkan DEFAULT_MODEL/MODEL_ROUTES tier3 bila masih pin lama single-id:
    # jangan timpa kustom non-opencode, hanya preset installer.
    if grep -qE '^[[:space:]]*DEFAULT_MODEL=opencode:(space-bunny-free|muse-spark-1.3-contributor-free|big-pickle)$' .env.local 2>/dev/null; then
      TIER3_LIVE_DEFAULT="$(tier3_default_dari_daftar "$OPENCODE_FREE_LIVE")"
      TIER3_LIVE_ESCAPED="$(sed_escape_replacement "$TIER3_LIVE_DEFAULT")"
      sed -i -E "s|^[[:space:]]*DEFAULT_MODEL=.*|DEFAULT_MODEL=${TIER3_LIVE_ESCAPED}|" .env.local
      DR_LIVE_RE='opencode:space-bunny-free|opencode:muse-spark-1\.3-contributor-free|opencode:big-pickle'
      sed -i -E "/^[[:space:]]*MODEL_ROUTES=/ s#(${DR_LIVE_RE})#${TIER3_LIVE_ESCAPED}#g" .env.local
      info "DEFAULT_MODEL/MODEL_ROUTES diselaraskan ke default live ${TIER3_LIVE_DEFAULT}."
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
if [[ "$WITH_BROWSER_TTS" -eq 1 ]]; then
  info "  TTS browser-native: ON tanpa API key (Web Speech API)"
else
  info "  TTS browser-native: OFF (--no-browser-tts) — narasi butuh provider TTS ber-key"
fi
if [[ "$WITH_PGADMIN" -eq 1 ]]; then
  if dpkg -l pgadmin4-web 2>/dev/null | grep -q '^ii'; then
    info "  pgAdmin4 web: OK (http://localhost/pgadmin4)"
    if [[ ! -f /var/lib/pgadmin/pgadmin4.db && ! -f /var/lib/pgadmin4/pgadmin4.db ]]; then
      warn "  pgAdmin4 DB belum ada — jalankan ulang: sudo ./install.sh --yes"
    fi
  else
    warn "pgAdmin4 web tidak terdeteksi — cek: dpkg -l pgadmin4-web"
  fi
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
if [[ "$WITH_PGADMIN" -eq 1 && -f .env.local ]]; then
  CURRENT_PGADMIN_EMAIL="$(env_get .env.local PGADMIN_EMAIL)"
  CURRENT_PGADMIN_PASS="$(env_get .env.local PGADMIN_PASSWORD)"
  if [[ -n "$CURRENT_PGADMIN_EMAIL" && -n "$CURRENT_PGADMIN_PASS" ]]; then
    echo "pgAdmin4 (http://localhost/pgadmin4):"
    echo "  email   : ${CURRENT_PGADMIN_EMAIL}"
    echo "  password: ${CURRENT_PGADMIN_PASS}"
    echo "  server  : openmaic (terdaftar otomatis dari DATABASE_URL)"
    echo ""
  else
    warn "Kredensial pgAdmin tidak terbaca dari .env.local — cek PGADMIN_EMAIL/PGADMIN_PASSWORD."
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
echo "    3. OpenCode free CLI : default opencode:muse-spark-1.3-contributor-free (tanpa auth;"
echo '       coba manual: opencode run -m opencode/muse-spark-1.3-contributor-free "hi"'
echo "       OPENCODE_BIN menunjuk binary absolut. Tool-calling paritas ber-key:"
echo "       multi-blok fence, validasi skema argumen, sekali repair otomatis;"
echo "       skills disajikan identik (hanya seed unsupported)."
echo "       SEMUA model free dari \`opencode models\` diambil + diaktifkan di"
echo "       OPENCODE_MODELS (comma-separated); tombol pemilih model di /workspace"
echo "       (tampilan sama dengan chat classic) memilih di antaranya"
echo "       (GET/POST /api/agent/models, tersimpan di"
echo "       data/agent-driver-model.json dan dipakai run berikutnya TANPA restart;"
echo "       hanya berlaku saat driver tier-3 CLI free, tier ber-key tak dibajak)."
echo "    Driver agen (MODEL_ROUTES maic-agent-driver): tier ber-key via HTTP"
echo "    (openai-completions/responses); tier-3 gratis via driver khusus CLI"
echo "    (opencode-cli, tanpa key, envelope tool_calls). Route yang hilang tetap"
echo "    gagal keras (wajib dikonfigurasi eksplisit)."
echo "  - Agent runtime + workbench butuh Postgres ${PG_MAJOR} (semua tier, termasuk tier-3 CLI)."
echo "  - Performa: PARALLEL_SCENE_CONCURRENCY=5 (scene paralel, maks kode 10;"
echo "    turunkan bila kena 429, naikkan s.d. 10 di server besar) + ffmpeg apt"
echo "    default terinstal (lewati via --no-ffmpeg). TTS tanpa pacing"
echo "    (default kode: interval 0) dan asset collector auto-aktif bila ada DB."
echo "  - TTS tanpa API key: browser-native (Web Speech API) default ON"
echo "    (TTS_BROWSER_NATIVE_ENABLED=true di .env.local + default client ON,"
echo "    fresh install langsung bersuara; matikan via --no-browser-tts bila"
echo "    ingin mewajibkan provider TTS ber-key seperti OpenAI/MiniMax)."
echo "  - Ekstraksi material audio/video lokal: ffmpeg (default ON)."
echo "  - pgAdmin4 web (default ON, --no-pgadmin untuk lewati): http://localhost/pgadmin4"
echo "    login awal = PGADMIN_EMAIL/PGADMIN_PASSWORD di .env.local (ambil:"
echo "    grep '^PGADMIN_' .env.local). Tambah server: Host localhost,"
echo "    Port <lihat DATABASE_URL>, user openmaic + password Postgres Anda."
echo "  - Video MP4 butuh: docker compose --profile video-export up (berat: Chromium+FFmpeg)."
echo "  - e2e: pnpm exec playwright install --with-deps chromium && pnpm test:e2e"
echo "  - Install ulang aman (idempoten): password Postgres dipakai ulang dari .env.local,"
echo "    kecuali dipaksa via --pg-password/PG_PASSWORD."
