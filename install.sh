#!/usr/bin/env bash
#
# install.sh — Installer server fresh untuk OpenMAIC (Ubuntu / Debian).
#
# Menyiapkan semuanya dari nol sehingga perintah berikut bisa jalan:
#   npm run dev     (mode pengembangan)
#   npm run build   (build produksi)
#   npm run start   (jalankan hasil build)
# (Perintah padanannya via pnpm — `pnpm dev / pnpm build / pnpm start` — juga bisa.)
# Dengan --with-pm2, installer juga menginstal PM2, memastikan build produksi
# ada, lalu menjalankan aplikasi via PM2 (ecosystem.config.cjs -> server
# standalone Next.js, auto-restart + hidup lagi setelah reboot).
#
# Yang diinstal / disiapkan:
#   1. Paket sistem (apt): hanya yang dipakai installer, Node, dan build native
#      `canvas` (opsi jsdom) — rincian + alasannya di blok APT_PKGS. ffmpeg
#      dipasang default native (lihat --no-ffmpeg). PostgreSQL 18 dari repo
#      resmi PGDG (hanya dengan --with-postgres; apt.postgresql.org) — bukan
#      paket bawaan distro yang tertinggal (Ubuntu 24.04 = PG 16); ganti mayor
#      dengan --pg-major=N.
#   2. Node.js 24 (>= 24.21, sesuai `engines` di package.json) via NodeSource.
#   3. pnpm 12.9.1 via corepack (sesuai `packageManager` di package.json).
#   4. PostgreSQL 18 (hanya dengan --with-postgres; default dilewati):
#      database + user `openmaic` + password acak.
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
#      OPENCODE_MODELS berisi SEMUA model opencode yang tersedia: bila
#      `opencode auth login` sudah dilakukan user pemilik sesi, SEMUA model
#      dari `opencode models` diaktifkan; bila belum login, hanya model free —
#      plus OPENCODE_GO_MODELS untuk SEMUA model `opencode-go/*` (grup kedua
#      pemilih model; bila sudah login berisi semua, bila belum login
#      dikosongkan = grup Go disembunyikan; login lalu jalankan ulang
#      installer untuk memunculkannya).
#      Installer mengecek status login dulu (`opencode auth list` + file
#      auth.json milik pemilik sesi) via CLI (`opencode models`,
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
#   9. Verifikasi: vendor bundle PPTX + kontrak Node engine + bootstrap skema
#      database eager (28 tabel persistence + agent runtime via tsx, agar boot
#      pertama bersih tanpa error 42P01; idempoten, gagal = warning saja).
#  10. pgAdmin4 web (hanya dengan --with-pgadmin; default dilewati):
#      repo resmi pgadmin.org + paket `pgadmin4-web` + setup-web.sh non-interaktif
#      (--yes + PGADMIN_SETUP_EMAIL/PASSWORD). Kredensial awal dibuat acak
#      (atau via --pgadmin-email/--pgadmin-password) dan disimpan di
#      .env.local (PGADMIN_EMAIL/PGADMIN_PASSWORD). Langsung bisa dibuka di
#      http://localhost/pgadmin4 tanpa langkah manual.
#  11. PM2 (hanya dengan --with-pm2): PM2 global via npm + build produksi
#      bila belum ada + sinkron aset standalone (.next/static + public) +
#      start/reload proses `kelaska` via ecosystem.config.cjs sebagai user
#      pemilik sesi (bukan root) + `pm2 save` dan unit systemd agar hidup
#      lagi setelah reboot.
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
#   --with-postgres     Instal & setup PostgreSQL 18 dari repo PGDG
#                       (database + user `openmaic`; default dilewati,
#                       agent runtime + persistence tetap nonaktif).
#   --no-postgres       Lewati instalasi & setup PostgreSQL (default sudah
#                       OFF; flag ini no-op, disediakan agar eksplisit).
#   --no-opencode       Lewati instalasi OpenCode CLI v2.
#   --with-opencode     Instal OpenCode CLI v2 (default sudah ON; flag ini
#                       no-op, disediakan agar eksplisit).
#   --no-upstream       Lewati pengaturan git remote `upstream`
#                       (default: remote `upstream` dipastikan menunjuk ke
#                       https://github.com/THU-MAIC/OpenMAIC.git).
#   --with-upstream     Pastikan git remote `upstream` terpasang (default sudah
#                       ON; flag ini no-op, disediakan agar eksplisit).
#   --upstream-url=URL  Paksa URL remote `upstream` (default:
#                       https://github.com/THU-MAIC/OpenMAIC.git).
#   --no-install        Lewati `pnpm install` (hanya siapkan sistem + env).
#   --build             Jalankan `npm run build` di akhir sebagai pembuktian.
#   --with-pm2          Instal PM2 + pastikan build produksi + jalankan
#                       aplikasi via PM2 (ecosystem.config.cjs, server
#                       standalone; implisit build bila .next belum ada).
#   --colab             Preset Google Colab / runtime ephemerial (root tanpa
#                       systemd): setara --yes --with-pm2 (postgres + pgadmin
#                       tetap OFF kecuali diminta --with-postgres /
#                       --with-pgadmin).
#                       Tulis --colab paling dulu bila digabung flag lain agar
#                       masih bisa di-override (mis. --colab --with-pgadmin
#                       --with-postgres).
#   --with-playwright   Instal browser Chromium untuk e2e Playwright.
#   --full / --with-dev-tools
#                       Bundle dev-penuh: setara `--build --with-playwright`
#                       (build produksi + browser Chromium e2e).
#   --with-pgadmin      Instal pgAdmin4 web (default dilewati; pasang dengan
#                       flag ini).
#   --no-pgadmin        Lewati instalasi & setup pgAdmin4 web (default sudah
#                       OFF; flag ini no-op, disediakan agar eksplisit).
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
WITH_POSTGRES=0
WITH_INSTALL=1
WITH_BUILD=0
WITH_PLAYWRIGHT=0
WITH_PM2=0
WITH_COLAB=0
WITH_PGADMIN=0
WITH_FFMPEG=1
WITH_OPENCODE=1
WITH_BROWSER_TTS=1
WITH_UPSTREAM=1
# Remote git upstream (repo asli OpenMAIC). Bisa dioverride via
# --upstream-url=URL atau env UPSTREAM_URL.
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/THU-MAIC/OpenMAIC.git}"
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
  sudo ./install.sh --yes --with-pm2                  # produksi via PM2 (build + daemon auto-restart)
  sudo ./install.sh --yes --with-postgres --with-pgadmin  # + Postgres + pgAdmin4 web
  sudo ./install.sh --colab                       # Colab/ephemerial (= --yes --with-pm2, tanpa postgres/pgadmin)
  sudo ./install.sh --colab --with-postgres --with-pgadmin  # Colab + Postgres + pgAdmin
  sudo ./install.sh --yes --full                  # bundle dev-penuh (= --build --with-playwright)
  sudo ./install.sh --yes --no-ffmpeg              # tanpa ekstraksi media lokal
  sudo ./install.sh --yes --no-browser-tts         # tanpa TTS browser-native (butuh key TTS)
  sudo ./install.sh --yes --no-opencode          # tanpa OpenCode CLI
EOF
}

for arg in "$@"; do
  case "$arg" in
    --yes)             ASSUME_YES=1 ;;
    --with-postgres)   WITH_POSTGRES=1 ;;
    --no-postgres)     WITH_POSTGRES=0 ;;
    --no-install)      WITH_INSTALL=0 ;;
    --build)           WITH_BUILD=1 ;;
    --with-playwright) WITH_PLAYWRIGHT=1 ;;
    --with-pm2) WITH_PM2=1 ;;
    --colab) WITH_COLAB=1; ASSUME_YES=1; WITH_PM2=1; WITH_PGADMIN=0 ;;
    --full|--with-dev-tools) WITH_BUILD=1; WITH_PLAYWRIGHT=1 ;;
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
    --with-upstream)   WITH_UPSTREAM=1 ;;
    --no-upstream)     WITH_UPSTREAM=0 ;;
    --upstream-url=*)  UPSTREAM_URL="${arg#*=}"; [[ -n "$UPSTREAM_URL" ]] || fail "--upstream-url butuh nilai (contoh: --upstream-url=https://github.com/THU-MAIC/OpenMAIC.git)." ;;
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
  fail "Script ini untuk Ubuntu/Debian (butuh apt-get). Di distro lain, samakan manual: Node 24 + pnpm 12.9 + Postgres + paket build di Dockerfile."
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
    echo "  - tanpa PostgreSQL (default; pasang dengan --with-postgres): agent runtime + persistence mati"
  fi
  if [[ "$WITH_PGADMIN" -eq 1 ]]; then
    echo "  - instal pgAdmin4 web siap pakai (repo pgadmin.org + setup otomatis -> http://localhost/pgadmin4)"
  else
    echo "  - tanpa pgAdmin4 web (default; pasang dengan --with-pgadmin)"
  fi
  echo "  - instal Node.js 24 (bila belum memenuhi syarat) + pnpm 12.9.1"
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
  if [[ "$WITH_PLAYWRIGHT" -eq 1 ]]; then
    echo "  - instal browser Chromium Playwright untuk e2e"
  fi
  if [[ "$WITH_PM2" -eq 1 ]]; then
    echo "  - instal PM2 + build produksi + jalankan via PM2 (ecosystem.config.cjs)"
  fi
  if [[ "$WITH_COLAB" -eq 1 ]]; then
    echo "  - preset Colab: non-interaktif + PM2 (postgres/pgadmin tetap OFF kecuali --with-postgres/--with-pgadmin)"
  fi
  if [[ "$WITH_UPSTREAM" -eq 1 ]]; then
    echo "  - pastikan git remote 'upstream' -> ${UPSTREAM_URL}"
  else
    echo "  - tanpa pengaturan git remote 'upstream' (--no-upstream)"
  fi
  echo "  - buat/lengkapi .env.local (auto-tier Pro Workbench 1 LLM -> 2 opencode paid -> 3 free CLI), direktori data/, pnpm install"
  # Tanpa TTY, `read` langsung gagal dan `set -e` mematikan script tanpa pesan
  # yang berguna — lebih baik gagal dengan instruksi yang jelas.
  [[ -t 0 ]] || fail "Tidak ada TTY untuk konfirmasi. Jalankan ulang dengan --yes (non-interaktif)."
  read -rp "Lanjut? [y/N] " jawab
  [[ "$jawab" =~ ^[yY]$ ]] || { info "Dibatalkan."; exit 0; }
fi

# Preset Colab: catat spesifikasi runtime (CPU/RAM/disk) agar mudah
# didiagnosis bila langkah berat gagal (OOM/kehabisan disk di runtime kecil).
# Best-effort: tidak pernah menggagalkan installer.
if [[ "$WITH_COLAB" -eq 1 ]]; then
  LANGKAH="colab: cek spesifikasi"
  COLAB_CPU="$(nproc 2>/dev/null || echo '?')"
  COLAB_RAM_MB="$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo '')"
  COLAB_DISK="$(df -h "$ROOT_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || echo '')"
  info "Spesifikasi runtime: CPU=${COLAB_CPU}, RAM=${COLAB_RAM_MB:-?}MB, disk tersedia=${COLAB_DISK:-?}."
  if [[ "$COLAB_RAM_MB" =~ ^[0-9]+$ && "$COLAB_RAM_MB" -lt 4096 ]]; then
    warn "RAM di bawah 4GB — build produksi (+ PostgreSQL bila --with-postgres) bisa OOM; pakai runtime yang lebih besar bila gagal."
  fi
fi

# ==================================================== 0. Git remote upstream
# Pastikan remote `upstream` menunjuk ke repo asli OpenMAIC agar fork tetap
# bisa `git fetch upstream` / `git pull upstream <branch>`. Idempoten: hanya
# add bila belum ada, set-url bila beda, diam bila sudah benar. Tidak fetch
# (tetap offline-friendly) dan tidak pernah menyentuh `origin` maupun branch.
# Dilewati bila bukan checkout git (unduhan ZIP) atau dengan --no-upstream.
LANGKAH="git: remote upstream"
# Helper: git sebagai pemilik sesi (bukan /root saat sudo) agar .git/config
# tidak berubah owner. -c safe.directory menahan error "dubious ownership"
# saat root menyentuh repo milik user lain.
git_sebagai_pemilik() {
  local pemilik="${SUDO_USER:-$(id -un)}"
  if [[ "$(id -un)" == "$pemilik" ]]; then
    git -c safe.directory="$ROOT_DIR" "$@"
  else
    run_as_root -H -u "$pemilik" git -c safe.directory="$ROOT_DIR" "$@"
  fi
}
if [[ "$WITH_UPSTREAM" -eq 1 ]]; then
  if ! command -v git >/dev/null 2>&1; then
    warn "git tidak ditemukan — lewati pengaturan remote 'upstream' (pasang git lalu ulangi)."
  elif ! git_sebagai_pemilik rev-parse --git-dir >/dev/null 2>&1; then
    info "Bukan checkout git — lewati pengaturan remote 'upstream'."
  elif [[ -z "$UPSTREAM_URL" ]]; then
    warn "UPSTREAM_URL kosong — lewati pengaturan remote 'upstream'."
  else
    UPSTREAM_SAAT_INI="$(git_sebagai_pemilik remote get-url upstream 2>/dev/null || true)"
    if [[ -z "$UPSTREAM_SAAT_INI" ]]; then
      if git_sebagai_pemilik remote add upstream "$UPSTREAM_URL" >/dev/null 2>&1; then
        info "git remote 'upstream' ditambahkan -> ${UPSTREAM_URL}."
      else
        warn "Gagal menambah git remote 'upstream' — atur manual: git remote add upstream ${UPSTREAM_URL}"
      fi
    elif [[ "$UPSTREAM_SAAT_INI" != "$UPSTREAM_URL" ]]; then
      if git_sebagai_pemilik remote set-url upstream "$UPSTREAM_URL" >/dev/null 2>&1; then
        info "git remote 'upstream' diperbarui ${UPSTREAM_SAAT_INI} -> ${UPSTREAM_URL}."
      else
        warn "Gagal memperbarui git remote 'upstream' — atur manual: git remote set-url upstream ${UPSTREAM_URL}"
      fi
    else
      info "git remote 'upstream' sudah benar (${UPSTREAM_URL})."
    fi
    unset UPSTREAM_SAAT_INI
  fi
else
  info "Lewati git remote 'upstream' (--no-upstream)."
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
  # Buang cache path bash: bila node lama (nvm//tools) dipakai sebelum
  # instalasi, hash-nya masih menunjuk binary lama walau /usr/bin/node yang
  # baru sudah lebih dulu di PATH — tanpa ini verifikasi di bawah membaca
  # versi basi dan installer gagal keliru (khas runtime Colab).
  hash -r 2>/dev/null || true
  # `command -v node` bisa masih menunjuk node lama di PATH user (mis. nvm),
  # jadi verifikasi ulang versi efektif — `command -v node` saja tak cukup.
  node -v >/dev/null 2>&1 || fail "Instalasi Node.js gagal: 'node' tidak ada di PATH."
  NODE_V="$(node -v | sed 's/^v//')"
  node_version_gte "$NODE_V" "$NODE_MIN_WANT" \
    || fail "Node.js yang dipakai PATH masih $NODE_V (butuh >= $NODE_MIN_WANT). Perbaiki PATH (mis. unset nvm) lalu ulangi."
fi
NPM_V="$(npm -v 2>/dev/null || echo '?')"
info "Node $(node -v), npm $NPM_V."

# ============================================================ 3. pnpm 12.9.1
# Versi dikunci mengikuti kolom `packageManager` di package.json (Dockerfile
# memakai cara yang sama lewat corepack).
LANGKAH="pnpm via corepack"
PNPM_WANT="$(node -p "require('./package.json').packageManager || ''" | sed 's/.*pnpm@//; s/+.*//')"
[[ -n "$PNPM_WANT" ]] || PNPM_WANT="12.9.1"
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
# `command -v pnpm` saja tidak cukup: pnpm global lama (mis. dari
# `npm i -g pnpm@9`) bisa membayangi shim corepack di PATH dan lolos cek tapi
# gagal/lain perilaku saat `pnpm install`. Begitu pula cache corepack yang
# terpotong (run terbunuh saat mengunduh) membuat shim menunjuk ke direktori
# tanpa binary walau `corepack install` exit 0 — gejalanya `pnpm -v` gagal
# (`?`) lalu `pnpm install` mati `Cannot find module .../bin/pnpm.cjs`.
# Jadi verifikasi VERSI AKTIF, perbaiki otomatis bila rusak: buang cache lalu
# unduh ulang sekali; bila tetap gagal, fallback `npm i -g` (bukan fail, agar
# lingkungan yang sengaja memakai pnpm lebih baru tidak rusak).
PNPM_HAVE="$(pnpm -v 2>/dev/null || echo '?')"
if [[ "$PNPM_HAVE" != "$PNPM_WANT" ]]; then
  info "pnpm ${PNPM_HAVE} terdeteksi (mau ${PNPM_WANT}) — coba perbaiki otomatis..."
  for _cp_cache in "${HOME:-/root}/.cache/node/corepack" /root/.cache/node/corepack; do
    [[ -d "$_cp_cache" ]] && run_as_root rm -rf "$_cp_cache"
  done
  unset _cp_cache
  corepack install --global "pnpm@$PNPM_WANT" >/dev/null 2>&1 \
    || corepack prepare "pnpm@$PNPM_WANT" --activate \
    || run_as_root npm i -g "pnpm@$PNPM_WANT" \
    || warn "perbaikan pnpm otomatis gagal; selaraskan manual: npm i -g pnpm@${PNPM_WANT}"
  hash -r 2>/dev/null || true
  PNPM_HAVE="$(pnpm -v 2>/dev/null || echo '?')"
fi
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
  info "Lewati PostgreSQL (default; pasang dengan --with-postgres): agent runtime + persistence tetap nonaktif."
fi

# ============================================================ 5. .env.local
LANGKAH=".env.local"
# Template dev: LLM default via OpenCode CLI v2 / Zen (provider `opencode`
# terdaftar di lib/ai/providers.ts). Nilai rahasia dibuat acak per server.
# OPENCODE_BIN diisi belakangan (step 8, setelah CLI terinstal) lalu di-backfill.
ACCESS_CODE_NEW="$(rand_hex 24)"      # 48 char, di atas minimum 16
DEV_TOKEN_NEW="$(rand_hex 16)"

tulis_openmaic_yml() {
  # Slot `agent` (Pro Workbench + agent runtime) dari tier installer.
  # MODEL_ROUTES tidak lagi dibaca server (menolak start tanpanya file ini),
  # jadi tier ditulis ke sini, bukan ke .env.local. Heredoc SENGAJA tanpa
  # quote agar ${tier...} terekspansi; referensi key ditulis \${VAR} agar
  # literal sampai ke file (server yang menginterpolasinya saat start).
  # $1=tier (tier1|tier2|tier3), $2=model `provider:model` tier ini.
  local tier="$1" model="$2"
  local provider="${model%%:*}" api="openai-completions" keyvar=""
  if [[ "$tier" == "tier3" ]]; then
    api="opencode-cli"
  elif [[ "$tier" == "tier2" ]]; then
    keyvar="OPENCODE_GO_API_KEY"
  else
    keyvar="GOOGLE_API_KEY"
  fi
  cat <<EOF
# =============================================================================
# OpenMAIC model configuration — dibuat oleh install.sh (tier=${tier}).
# Slot \`agent\` mengemudikan Pro Workbench/agent runtime (butuh tool calling).
# Server membaca file ini saat start — restart setelah mengubah. Panduan:
# packages/docs (Configuration) dan skills/openmaic/references/provider-keys.md.
# Key tetap di .env.local dan dirujuk sebagai \${VAR}; nilai kustom Anda di
# file ini tidak disentuh installer (hanya dibuat bila belum ada).
# =============================================================================
providers:
  ${provider}:
    preset: ${provider}
$(if [[ -n "$keyvar" ]]; then printf '    apiKey: ${%s}\n' "$keyvar"; fi)
slots:
  agent:
    model: ${model}
    api: ${api}
EOF
}

tulis_openmaic_yml_bila_belum_ada() {
  # Buat openmaic.yml dari tier hanya bila belum ada: nilai kustom Anda di
  # file yang sudah ada tidak pernah disentuh installer.
  local tier="$1" model="$2" tmp=""
  if [[ -f openmaic.yml ]]; then
    info "openmaic.yml sudah ada — dipertahankan (slot agent tidak diubah)."
    return 0
  fi
  tmp="$(mktemp openmaic.yml.tmp.XXXXXX)"
  tulis_openmaic_yml "$tier" "$model" > "$tmp" \
    || { rm -f "$tmp"; fail "gagal menulis openmaic.yml (lihat error di atas)."; }
  chmod 644 "$tmp"
  mv -f "$tmp" openmaic.yml
  info "openmaic.yml dibuat (slot agent = ${model}, tier=${tier})."
}

tulis_template_env() {
  local db_url="$1" access_code="$2" dev_token="$3" agent_runtime="$4" opencode_bin="$5"
  local tier_name="$6" tier_default="$7" tier_pin="$8"
  local tier_key1_line="$9" tier_key2_line="${10}" tier_key2go_line="${11}"
  local tts_browser_line="${12:-TTS_BROWSER_NATIVE_ENABLED=true}"
  # Tanpa colon (`-` bukan `:-`): "" eksplisit = disembunyikan, bukan fallback.
  local tier_gopin="${13-$OPENCODE_GO_FREE_FALLBACK}"
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
# Slot agent (Pro Workbench + agent runtime) TIDAK lagi lewat MODEL_ROUTES:
# server menolak start bila MODEL_ROUTES diset tanpa openmaic.yml, dan
# mengabaikannya bila openmaic.yml ada. install.sh menulis openmaic.yml
# (slot \`agent\` = model + \`api\` tier ini) di samping .env.local.
# Tier ber-key (1/2): HTTP OpenAI-compatible (\`openai-completions\`).
# Tier-3 gratis: driver khusus CLI (\`opencode-cli\`, alias \`cli\`/\`opencode\`) —
# eksekusi lokal \`opencode run\` tanpa key; function tools via envelope
# \`\`\`tool_calls (lib/ai/opencode-cli.ts + lib/server/agent-runtime/agent-driver-model.ts).
# Paritas tool-calling dengan LLM ber-key: SEMUA blok fence valid dipakai
# berurutan, argumen divalidasi terhadap skema tool, sekali repair otomatis
# bila upaya call gagal parse, dan skills disajikan identik (prompt sama) —
# hanya seed yang tetap unsupported.
# (Dulu: MODEL_ROUTES='{"maic-agent-driver":{...}}' — sudah dipindah ke openmaic.yml.)

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
# OPENCODE_MODELS: daftar login-aware (comma-separated, diambil
# dari \`opencode models\` oleh install.sh; boleh diisi manual):
# sudah \`opencode auth login\` -> SEMUA model tersedia; belum -> hanya free.
# OPENCODE_MODELS=${tier_pin}
# OPENCODE_GO_MODELS: grup kedua pemilih model (provider \`opencode-go\`,
# comma-separated bare id; login -> semua, belum login -> KOSONG =
# grup Go disembunyikan; login lalu jalankan ulang installer).
# Baris AKTIF (bukan komentar) agar kosong berarti hidden, bukan fallback.
OPENCODE_GO_MODELS=${tier_gopin}

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
# Untuk Supabase: pakai jalur non-pooling (port 5432) karena app memakai
# LISTEN/NOTIFY yang tidak jalan di pgbouncer transaction-mode (port 6543),
# dan sslmode=no-verify (enkripsi on, verifikasi rantai sertifikat pooler off):
# DATABASE_URL=postgres://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres?sslmode=no-verify
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

# --- Supabase (opsional; isi bila DATABASE_URL = Supabase) ------------------------
# SUPABASE_URL=https://<ref>.supabase.co
# NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
# SUPABASE_ANON_KEY=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SUPABASE_PUBLISHABLE_KEY=
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
# SUPABASE_SERVICE_ROLE_KEY=
# SUPABASE_SECRET_KEY=
# SUPABASE_JWT_SECRET=
# POSTGRES_DATABASE=postgres
# POSTGRES_HOST=db.<ref>.supabase.co
# POSTGRES_USER=postgres
# POSTGRES_PASSWORD=
# POSTGRES_PRISMA_URL=
# POSTGRES_URL=
# POSTGRES_URL_NON_POOLING=

# --- Hugging Face S3 untuk penyimpanan aset (opsional) -------------------------
# Aktifkan dengan mengisi HF_S3_BUCKET + HF_S3_ENDPOINT + kredensial di bawah
# (LALU restart server). Bucket HF dibuat dulu via \`hf buckets create <ns>/<bucket>\`.
# JANGAN set ASSET_S3_BUCKET bersamaan (store HF dipakai, bukan store bawaan).
# HF_S3_BUCKET=kelaska
# HF_S3_ENDPOINT=https://s3.hf.co/akj2025
# HF_S3_REGION=us-east-1
# HF_S3_ACCESS_KEY_ID=
# HF_S3_SECRET_ACCESS_KEY=
# HF_TOKEN=

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
# tanpa postgres), baris itu diaktifkan ulang dengan nilai di sini — bukan
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
#           kredensial). Daftar model login-aware: sudah `opencode auth login`
#           -> SEMUA model `opencode` tersedia; belum login -> hanya model free.
#           Daftar diaktifkan di OPENCODE_MODELS (comma-separated); tombol
#           pemilih model di /workspace memilih di antaranya
#           (GET/POST /api/agent/models).
TIER1_MODEL="google:gemini-3.5-flash-lite"
TIER1_KEY_VAR="GOOGLE_API_KEY"
TIER2_MODEL="opencode-go:gpt-6-luna"
TIER2_KEY_PRIMARY="OPENCODE_API_KEY"
TIER2_KEY_HTTP="OPENCODE_GO_API_KEY"
TIER3_MODEL="opencode:muse-spark-1.3-contributor-free"
# Fallback katalog provider `opencode` (lib/ai/providers.ts) bila CLI belum
# ada / offline: SEMUA model free diaktifkan, bukan satu pin saja.
OPENCODE_FREE_FALLBACK="space-bunny-free,muse-spark-1.3-contributor-free,big-pickle,longcat-2.5-preview-free,mimo-v2.6-flash-free,ling-3.0-flash-fin-free,nemotron-3-ultra-free,nemotron-3.5-lightning-free,fledge-alpha-free"
# Nilai lama installer (sebelum grup Go disembunyikan saat belum login):
# dikenali saat migrasi agar instalasi lama dimigrasi ke kosong, bukan
# dianggap kustom. Kini bila belum login daftar Go = kosong (hidden).
OPENCODE_GO_FREE_FALLBACK="space-bunny-free,longcat-2.5-preview-free"
# Cermin `opencode models` provider opencode-go/* (dipakai bila sudah login
# tapi fetch live gagal, atau CLI absen — lalu disegarkan saat CLI ada).
OPENCODE_GO_ALL_FALLBACK="deepseek-v4-flash,deepseek-v4-flash-vision-exp,deepseek-v4-pro,deepseek-v4.1-flash,glm-5.2,glm-5.3,glm-5.3-flash,gpt-5.6-luna,gpt-6-luna,grok-4.6,grok-4.7,hy3,hy4-preview,kimi-k2.7-code,kimi-k3,longcat-2.0,longcat-2.5-preview-free,mimo-v2.5,mimo-v2.5-pro,mimo-v2.6-flash,mimo-v2.6-pro,minimax-m2.7,minimax-m3,muse-spark-1.2-contributor,muse-spark-1.3-contributor,qwen3.7-plus,qwen3.8-flash,qwen3.8-max,space-bunny-free"
# Pin katalog provider `opencode` agar CLI gratis selalu discoverable.
# Kompatibel lama (single id) — nilai aktif kini daftar comma-separated
# dari daftar_model_aktif_opencode (login: semua model `opencode models`;
# belum login: hanya free; fallback katalog bila CLI absen/offline).
TIER_PIN="muse-spark-1.3-contributor-free"

# User + home pemilik sesi OpenCode (bukan /root saat sudo). Dipakai cek login
# + fetch `opencode models` agar membaca auth.json milik user yang benar.
# Didefinisikan awal karena dipakai seksi .env.local (sebelum seksi 8 tahu
# OPENCODE_TARGET_HOME). Idempoten, tanpa efek samping.
opencode_target_user() {
  local tu="${SUDO_USER:-}"
  if [[ -z "$tu" ]]; then tu="$(id -un 2>/dev/null || printf '%s' "${USER:-}")"; fi
  # SUDO_USER bisa basi (user dihapus setelah sudo) — fallback ke user aktif.
  if ! id -u "$tu" >/dev/null 2>&1; then tu="$(id -un)"; fi
  printf '%s' "$tu"
}
opencode_target_home() {
  local tu="" th=""
  tu="$(opencode_target_user)"
  th="$(getent passwd "$tu" 2>/dev/null | cut -d: -f6 || true)"
  if [[ -z "$th" ]]; then
    if [[ -n "${OPENCODE_TARGET_HOME:-}" ]]; then th="$OPENCODE_TARGET_HOME";
    elif [[ "$(id -un)" == "$tu" ]]; then th="$HOME";
    else th="/home/$tu"; fi
  fi
  printf '%s' "$th"
}
# Jalankan perintah sebagai pemilik sesi (agar HOME/auth.json benar). Bila sudah
# sebagai pemilik, jalan langsung; bila root-via-sudo, via run_as_root -H -u.
# Dipakai untuk `opencode auth list` + `opencode models` (non-interaktif).
opencode_sebagai_pemilik() {
  local tu=""
  tu="$(opencode_target_user)"
  if [[ "$(id -un)" == "$tu" ]]; then
    "$@"
  else
    run_as_root -H -u "$tu" "$@"
  fi
}
# Cari binary opencode (dipakai cek login + fetch model). Hasil: path atau "".
opencode_cari_bin() {
  local bin="${1:-}" _home="" _sudo_home="" cand=""
  if [[ -n "$bin" && -x "$bin" ]]; then printf '%s' "$bin"; return 0; fi
  if [[ -n "${SUDO_USER:-}" ]]; then
    _sudo_home="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6 || true)"
  fi
  for _home in "${_sudo_home:-}" "${OPENCODE_TARGET_HOME:-}" "$(opencode_target_home)" "$HOME"; do
    [[ -n "$_home" ]] || continue
    for cand in "$_home/.opencode/bin/opencode" "$_home/bin/opencode"; do
      if [[ -x "$cand" ]]; then printf '%s' "$cand"; return 0; fi
    done
  done
  bin="$(command -v opencode 2>/dev/null || true)"
  if [[ -n "$bin" ]]; then printf '%s' "$bin"; return 0; fi
  if [[ -n "${OPENCODE_BIN_DETECTED:-}" && -x "${OPENCODE_BIN_DETECTED:-}" ]]; then
    printf '%s' "$OPENCODE_BIN_DETECTED"; return 0
  fi
  printf '%s' ""
}
# 0 bila `opencode auth login` sudah pernah dilakukan pemilik sesi (ada kredensial),
# 1 bila belum. Cek berlapis (file dulu, lalu `auth list`), non-interaktif +
# timeout agar tak menggantung. Gagal/offline = belum login (caller fallback free).
opencode_sudah_login() {
  local bin="" th="" auth_json="" out="" _auth_tmp=""
  bin="$(opencode_cari_bin "${1:-}")"
  [[ -n "$bin" && -x "$bin" ]] || return 1
  th="$(opencode_target_home)"
  # 1. File kredensial milik pemilik (dibaca root langsung, tanpa su).
  # Lokasi resmi: ~/.local/share/opencode/auth.json (CLI docs).
  for auth_json in "$th/.local/share/opencode/auth.json" "$th/.config/opencode/auth.json"; do
    if [[ -f "$auth_json" && -s "$auth_json" ]] && command -v node >/dev/null 2>&1; then
      if node -e '
        const fs=require("node:fs");
        try{
          const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
          if(!j||typeof j!=="object"||Array.isArray(j)) process.exit(1);
          const keys=Object.keys(j);
          if(keys.length===0) process.exit(1);
          const ada=keys.some((k)=>{
            const v=j[k];
            if(!v) return false;
            if(typeof v==="string") return v.trim().length>0;
            if(typeof v==="object") return Object.keys(v).length>0;
            return true;
          });
          process.exit(ada?0:1);
        }catch{ process.exit(1); }
      ' "$auth_json" 2>/dev/null; then
        return 0
      fi
    fi
  done
  # 2. `auth list` sebagai pemilik: hanya dianggap login bila perintah SUKSES dan
  # output memuat penanda terautentikasi. Exit 0 saja tak cukup (perintah sukses
  # juga saat tabel kosong / belum login), dan teks help (`auth ls` tidak ada
  # di CLI v2 — mencetak USAGE/SUBCOMMANDS + "active account") tidak boleh
  # dianggap login. Bentuk output antar versi beda: lama tabel `✓ Authed`,
  # v2 `OpenCode Go ... stored`.
  if ! command -v timeout >/dev/null 2>&1; then return 1; fi
  out=""
  _auth_tmp="$(mktemp 2>/dev/null || echo '')"
  if [[ -n "$_auth_tmp" ]]; then
    if opencode_sebagai_pemilik timeout 15 "$bin" auth list >"$_auth_tmp" 2>/dev/null; then
      out="$(cat "$_auth_tmp" 2>/dev/null || true)"
    else
      # `auth list` gagal (CLI sangat lama?): coba alias `ls` sekali saja.
      # Bila ini pun gagal / mencetak help, di bawah ditolak sebagai help.
      out="$(opencode_sebagai_pemilik timeout 15 "$bin" auth ls 2>/dev/null || true)"
    fi
    rm -f "$_auth_tmp"
  else
    out="$(opencode_sebagai_pemilik timeout 15 "$bin" auth list 2>/dev/null || true)"
    # Tanpa info exit code di jalur ini: output help ditolak di bawah anyway,
    # output kosong berarti belum login.
  fi
  unset _auth_tmp
  [[ -n "$out" ]] || return 1
  # Tolak teks help/usage lebih dulu (mengandung "active account" + "stored
  # credentials" sehingga lolos penanda bila tidak disaring).
  if printf '%s' "$out" | grep -qiE 'USAGE|SUBCOMMANDS|DESCRIPTION|Unknown subcommand|^ERROR'; then
    return 1
  fi
  # Tolak pesan BELUM login ("No providers authenticated...", "not logged in"):
  # kalimatnya sendiri mengandung kata penanda ("authenticated"/"logged in").
  if printf '%s' "$out" | grep -qiE 'no .*auth|not .*log|not .*auth|unauthenticated|no credentials|not connected|please .*login|run.*auth login'; then
    return 1
  fi
  if printf '%s' "$out" | grep -qiE '✓|✔|●|authed|authenticated|logged.?in|stored'; then
    # Hindari false-positive baris header/help ("Authentication management"):
    # wajib ada juga nama provider / garis tabel selain header.
    if printf '%s' "$out" | grep -qiE 'opencode|anthropic|openai|google|deepseek|zhipu|moonshot|minimax|azure|grok|qwen|kimi|glm|doubao|hunyuan|xiaomi|provider.*status|│|\|'; then
      return 0
    fi
  fi
  return 1
}
# Flag hasil cek login terakhir oleh daftar_model_aktif_opencode (1=sudah login
# sehingga daftar berisi SEMUA model; 0=belum login sehingga hanya free).
# Dipakai pesan log caller tanpa cek ulang (hemat 1x `auth list` ~15 detik).
OPENCODE_LOGIN_DETECTED=0

# Ambil SEMUA model free opencode-cli (`opencode models`) sebagai daftar
# comma-separated, lalu aktifkan di OPENCODE_MODELS. Idempoten, toleran offline:
# gagal/CLI absen -> fallback katalog di atas.
# Dijalankan sebagai pemilik sesi (bukan /root saat sudo) agar auth + HOME benar.
# Output: satu baris `id1,id2,...` (bare id tanpa prefix `opencode/`).
daftar_model_free_opencode() {
  local bin="" out="" json_tmp="" txt_tmp=""
  bin="$(opencode_cari_bin "${1:-}")"
  if [[ -n "$bin" && -x "$bin" ]] && command -v timeout >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    json_tmp="$(mktemp 2>/dev/null || echo '')"
    if [[ -n "$json_tmp" ]]; then
      if opencode_sebagai_pemilik timeout 30 "$bin" models --format json >"$json_tmp" 2>/dev/null; then
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
              // Hanya provider `opencode` (pola mengecualikan `opencode-go/*`
              // karena setelah `opencode` wajib `/`/`:` bukan `-`).
              .filter((s)=>/^opencode[\/:]/i.test(s))
              .map((s)=>s.replace(/^opencode[\/:]/i,""))
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
        if opencode_sebagai_pemilik timeout 30 "$bin" models >"$txt_tmp" 2>/dev/null; then
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

# Ambil SEMUA model provider `opencode` yang tersedia untuk akun login
# (`opencode models --format json`, tanpa filter free). Dipakai HANYA bila
# opencode_sudah_login=0 (lihat wrapper di bawah). Provider lain (anthropic,
# openai, ...) sengaja diabaikan: OPENCODE_MODELS menyimpan bare id untuk
# provider `opencode` (`opencode:<id>`, lihat lib/server/agent-runtime/
# opencode-models.ts), sehingga id luar-opencode akan menjadi salah prefix.
# Dijalankan sebagai pemilik sesi. Output "" bila gagal (caller fallback free).
# Satu baris `id1,id2,...` (bare id tanpa prefix `opencode/`).
daftar_model_semua_opencode() {
  local bin="" out="" json_tmp="" txt_tmp=""
  bin="$(opencode_cari_bin "${1:-}")"
  [[ -n "$bin" && -x "$bin" ]] || return 1
  command -v timeout >/dev/null 2>&1 || return 1
  command -v node >/dev/null 2>&1 || return 1
  json_tmp="$(mktemp 2>/dev/null || echo '')"
  if [[ -n "$json_tmp" ]]; then
    if opencode_sebagai_pemilik timeout 30 "$bin" models --format json >"$json_tmp" 2>/dev/null; then
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
            const prov=String(m.provider||m.providerID||"");
            let id=String(m.id||m.slug||m.name||"");
            if(!id) continue;
            id=id.trim();
            // Bentuk "provider/model" penuh (mis. opencode/gpt-5): pakai apa adanya.
            // Bentuk bare + kolom provider terpisah: gabungkan bila provider opencode.
            if(!id.includes("/") && prov && /^opencode$/i.test(prov.trim())){
              id="opencode/"+id;
            }
            ids.push(id);
          }
          const semua=ids.map((s)=>s.trim()).filter(Boolean)
            .filter((s)=>/^opencode[\/:]/i.test(s))
            .map((s)=>s.replace(/^opencode[\/:]/i,""))
            .map((s)=>s.trim()).filter(Boolean);
          console.log([...new Set(semua)].join(","));
        }catch{ process.exit(1); }
      ' "$json_tmp" 2>/dev/null || true)"
    fi
    rm -f "$json_tmp"
  fi
  if [[ -z "$out" ]]; then
    txt_tmp="$(mktemp 2>/dev/null || echo '')"
    if [[ -n "$txt_tmp" ]]; then
      if opencode_sebagai_pemilik timeout 30 "$bin" models >"$txt_tmp" 2>/dev/null; then
        out="$(grep -oE 'opencode[/:][A-Za-z0-9._-]+' "$txt_tmp" 2>/dev/null \
          | sed -E 's|^opencode[/:]||' || true)"
        out="$(printf '%s' "$out" | awk 'NF && !seen[$0]++' | paste -sd, - 2>/dev/null || true)"
      fi
      rm -f "$txt_tmp"
    fi
  fi
  [[ -n "$out" ]] || return 1
  if [[ ",${out}," != *",muse-spark-1.3-contributor-free,"* ]]; then
    out="muse-spark-1.3-contributor-free${out:+,}${out}"
  fi
  printf '%s' "$out"
}

# Wrapper login-aware: bila pemilik sesi sudah `opencode auth login`, stdout
# = SEMUA model opencode yang tersedia (free + berbayar ter-autentikasi) agar
# bisa dipakai; bila belum login, stdout = hanya model free (perilaku lama).
# Sekaligus mengeset OPENCODE_GO_LIST (daftar opencode-go: login -> semua,
# belum login -> KOSONG = grup Go disembunyikan dari pemilih workbench)
# + OPENCODE_LOGIN_DETECTED=1/0 untuk pesan log caller.
# PENTING: panggil TANPA command substitution (output -> file sementara lalu
# dibaca) — `var=$(fungsi)` jalan di subshell sehingga global di atas hilang.
# Idempoten, toleran offline: login tapi fetch gagal -> fallback free.
# Contoh:
#   tmp="$(mktemp)"; daftar_model_aktif_opencode "" >"$tmp" 2>/dev/null
#   OPENCODE_FREE_LIST="$(cat "$tmp")"; rm -f "$tmp"
#   # dipakai: $OPENCODE_FREE_LIST (stdout), $OPENCODE_GO_LIST, $OPENCODE_LOGIN_DETECTED
daftar_model_aktif_opencode() {
  local bin=""
  bin="$(opencode_cari_bin "${1:-}")"
  OPENCODE_LOGIN_DETECTED=0
  OPENCODE_GO_LIST=""
  if [[ -n "$bin" ]] && opencode_sudah_login "$bin"; then
    local semua="" go_semua=""
    semua="$(daftar_model_semua_opencode "$bin" 2>/dev/null || true)"
    go_semua="$(daftar_model_go_opencode "$bin" all 2>/dev/null || true)"
    [[ -n "$go_semua" ]] || go_semua="$OPENCODE_GO_ALL_FALLBACK"
    OPENCODE_GO_LIST="$go_semua"
    if [[ -n "$semua" ]]; then
      OPENCODE_LOGIN_DETECTED=1
      printf '%s' "$semua"
      return 0
    fi
    # Login tapi fetch gagal: jatuh ke free di bawah (jangan gagalkan installer).
  else
    # Belum login: grup Go disembunyikan (daftar kosong) — tak perlu fetch.
    OPENCODE_GO_LIST=""
  fi
  daftar_model_free_opencode "$bin"
}

# Ambil daftar model provider `opencode-go` (`$2` = free|all) sebagai
# comma-separated bare id. free = hanya *-free (tanpa login); all = semua
# (butuh `opencode auth login` agar bisa dipakai, tapi katalognya publik).
# Output "" + return 1 bila gagal (caller pakai fallback const).
daftar_model_go_opencode() {
  local bin="" mode="${2:-free}" out="" json_tmp="" txt_tmp=""
  bin="$(opencode_cari_bin "${1:-}")"
  [[ -n "$bin" && -x "$bin" ]] || return 1
  command -v timeout >/dev/null 2>&1 || return 1
  command -v node >/dev/null 2>&1 || return 1
  json_tmp="$(mktemp 2>/dev/null || echo '')"
  if [[ -n "$json_tmp" ]]; then
    if opencode_sebagai_pemilik timeout 30 "$bin" models --format json >"$json_tmp" 2>/dev/null; then
      out="$(GO_MODE="$mode" node -e '
        const fs=require("node:fs");
        try{
          const raw=fs.readFileSync(process.argv[1],"utf8");
          const j=JSON.parse(raw);
          const arr=Array.isArray(j)?j:(Array.isArray(j.models)?j.models:(Array.isArray(j.data)?j.data:[]));
          const ids=[];
          for(const m of arr){
            if(typeof m==="string"){ ids.push(m); continue; }
            if(!m||typeof m!=="object") continue;
            const prov=String(m.provider||m.providerID||"");
            let id=String(m.id||m.slug||m.name||"");
            if(!id) continue;
            id=id.trim();
            if(!id.includes("/") && prov && /^opencode-go$/i.test(prov.trim())){
              id="opencode-go/"+id;
            }
            ids.push(id);
          }
          let go=ids.map((s)=>s.trim()).filter(Boolean)
            .filter((s)=>/^opencode-go[\/:]/i.test(s))
            .map((s)=>s.replace(/^opencode-go[\/:]/i,""))
            .map((s)=>s.trim()).filter(Boolean);
          if(process.env.GO_MODE==="free"){
            go=go.filter((s)=>/free$/i.test(s));
          }
          console.log([...new Set(go)].join(","));
        }catch{ process.exit(1); }
      ' "$json_tmp" 2>/dev/null || true)"
    fi
    rm -f "$json_tmp"
  fi
  if [[ -z "$out" ]]; then
    txt_tmp="$(mktemp 2>/dev/null || echo '')"
    if [[ -n "$txt_tmp" ]]; then
      if opencode_sebagai_pemilik timeout 30 "$bin" models >"$txt_tmp" 2>/dev/null; then
        out="$(grep -oE 'opencode-go[/:][A-Za-z0-9._-]+' "$txt_tmp" 2>/dev/null \
          | sed -E 's|^opencode-go[/:]||' || true)"
        if [[ "$mode" == "free" ]]; then
          out="$(printf '%s' "$out" | grep -Ei 'free$' || true)"
        fi
        out="$(printf '%s' "$out" | awk 'NF && !seen[$0]++' | paste -sd, - 2>/dev/null || true)"
      fi
      rm -f "$txt_tmp"
    fi
  fi
  [[ -n "$out" ]] || return 1
  # Pastikan default tier2 selalu ikut (idempoten, di depan bila belum ada).
  if [[ ",${out}," != *",gpt-6-luna,"* ]]; then
    out="gpt-6-luna${out:+,}${out}"
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

# OPENMAIC_SECRET_KEY: kunci penyegel provider key workspace di DB (SecretBox,
# lib/server/secret-box.ts). WAJIB stabil lintas restart DAN rebuild:
# - Tanpa var ini server membuat data/instance-secret.key acak saat boot;
# - `npm run build` menghapus .next/standalone/data/ -> secret ikut hilang ->
#   SEMUA provider key ter-seal (google/huggingface/dll) tak terbaca lagi
#   (insiden 2026-10-08: PBL + LLM + media lumpuh total setelah rebuild).
# Idempoten: nilai .env.local/env tidak pernah ditimpa. Bila keduanya kosong,
# file secret yang masih hidup diadopsi; hanya bila tak ada di mana pun,
# generate baru (32 byte acak base64, format yang diterima checkedSecret).
pastikan_instance_secret() {
  local file="${1:-.env.local}" cur="" adopsi="" kandidat=""
  cur="$(env_get "$file" OPENMAIC_SECRET_KEY)"
  if [[ -n "$cur" ]]; then return 0; fi
  if [[ -n "${OPENMAIC_SECRET_KEY:-}" ]]; then
    printf '%s\n' "OPENMAIC_SECRET_KEY=${OPENMAIC_SECRET_KEY}" >> "$file"
    info "OPENMAIC_SECRET_KEY diisi dari environment."
    return 0
  fi
  for kandidat in .next/standalone/data/instance-secret.key data/instance-secret.key; do
    if [[ -f "$kandidat" ]]; then
      adopsi="$(tr -d '[:space:]' < "$kandidat" 2>/dev/null || true)"
      if [[ "$adopsi" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
        printf '%s\n' "OPENMAIC_SECRET_KEY=${adopsi}" >> "$file"
        info "OPENMAIC_SECRET_KEY diadopsi dari ${kandidat} (secret lama dipertahankan agar key ter-seal tetap terbaca)."
        return 0
      fi
    fi
  done
  adopsi="$(head -c 32 /dev/urandom 2>/dev/null | base64 | tr -d '\n' || true)"
  if [[ "$adopsi" =~ ^[A-Za-z0-9+/]{43}=$ ]]; then
    printf '\n%s\n' "OPENMAIC_SECRET_KEY=${adopsi}" >> "$file"
    info "OPENMAIC_SECRET_KEY dibuat acak dan disimpan di .env.local (jangan hapus — provider key DB bergantung padanya)."
  else
    warn "Gagal membuat OPENMAIC_SECRET_KEY acak; isi manual 32 byte base64 bila provider key tak terbaca setelah rebuild."
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
  # Login-aware: sudah `opencode auth login` -> SEMUA model tersedia diaktifkan;
  # belum login -> hanya model free (perilaku lama). Lihat daftar_model_aktif_opencode.
  # Via file sementara (bukan $()) agar global OPENCODE_GO_LIST +
  # OPENCODE_LOGIN_DETECTED ikut terbawa (subshell menghilangkannya).
  _model_tmp="$(mktemp)"
  if daftar_model_aktif_opencode "" >"$_model_tmp" 2>/dev/null; then
    OPENCODE_FREE_LIST="$(cat "$_model_tmp")"
  else
    OPENCODE_FREE_LIST="$OPENCODE_FREE_FALLBACK"
  fi
  rm -f "$_model_tmp"; unset _model_tmp
  [[ -n "$OPENCODE_FREE_LIST" ]] || OPENCODE_FREE_LIST="$OPENCODE_FREE_FALLBACK"
  # Kosong = grup Go disembunyikan (belum login); jangan diisi fallback.
  OPENCODE_GO_LIST="${OPENCODE_GO_LIST:-}"
  if [[ "${OPENCODE_LOGIN_DETECTED:-0}" -eq 1 ]]; then
    info "OpenCode sudah login — semua model tersedia diaktifkan (${OPENCODE_FREE_LIST})."
    info "Model Go aktif (OPENCODE_GO_MODELS): ${OPENCODE_GO_LIST}."
  else
    if [[ "$OPENCODE_FREE_LIST" != "$OPENCODE_FREE_FALLBACK" ]]; then
      info "Model free OpenCode terdeteksi (${OPENCODE_FREE_LIST})."
    fi
    info "Model Go disembunyikan (belum login; login lalu jalankan ulang installer)."
  fi
  TIER="$(pilih_tier_model .env.local)"
  if [[ "$TIER" == "tier3" ]]; then
    TIER_DEFAULT="$(tier3_default_dari_daftar "$OPENCODE_FREE_LIST")"
    TIER_PIN="$OPENCODE_FREE_LIST"
  else
    TIER_DEFAULT="$(tier_default_model "$TIER")"
    TIER_PIN="$OPENCODE_FREE_LIST"
  fi
  # Daftar model Go untuk grup kedua pemilih workbench (dipakai apa pun tiernya).
  TIER_GO_PIN="$OPENCODE_GO_LIST"
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
    tulis_template_env "$DATABASE_URL_VALUE" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "$AGENT_RT" "" "$TIER" "$TIER_DEFAULT" "$TIER_PIN" "$TIER1_KEY_LINE" "$TIER2_KEY_LINE" "$TIER2GO_KEY_LINE" "$TTS_BROWSER_LINE" "$TIER_GO_PIN" > "$TMP_ENV_BARU" \
      || { rm -f "$TMP_ENV_BARU"; fail "gagal menulis template .env.local (lihat error di atas)."; }
    chmod 600 "$TMP_ENV_BARU"
    mv -f "$TMP_ENV_BARU" .env.local
    tulis_openmaic_yml_bila_belum_ada "$TIER" "$TIER_DEFAULT"
    if [[ "$AGENT_RT" == "false" ]]; then
      info "Agent runtime nonaktif (tanpa DATABASE_URL). Tier-3 tetap didukung driver CLI bila DB ada."
    fi
  else
    TMP_ENV_BARU="$(mktemp .env.local.tmp.XXXXXX)"
    tulis_template_env "" "$ACCESS_CODE_NEW" "$DEV_TOKEN_NEW" "$AGENT_RT" "" "$TIER" "$TIER_DEFAULT" "$TIER_PIN" "$TIER1_KEY_LINE" "$TIER2_KEY_LINE" "$TIER2GO_KEY_LINE" "$TTS_BROWSER_LINE" "$TIER_GO_PIN" > "$TMP_ENV_BARU" \
      || { rm -f "$TMP_ENV_BARU"; fail "gagal menulis template .env.local (lihat error di atas)."; }
    chmod 600 "$TMP_ENV_BARU"
    mv -f "$TMP_ENV_BARU" .env.local
    tulis_openmaic_yml_bila_belum_ada "$TIER" "$TIER_DEFAULT"
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
  # Login-aware: sudah `opencode auth login` -> SEMUA model tersedia diaktifkan
  # di OPENCODE_MODELS (+ OPENCODE_GO_MODELS); belum login -> hanya model free
  # (perilaku lama). Via file sementara agar global wrapper terbawa.
  # Tombol pemilih model /workspace memakai daftar ini via GET /api/agent/models.
  _model_tmp="$(mktemp)"
  if daftar_model_aktif_opencode "" >"$_model_tmp" 2>/dev/null; then
    OPENCODE_FREE_LIST="$(cat "$_model_tmp")"
  else
    OPENCODE_FREE_LIST="$OPENCODE_FREE_FALLBACK"
  fi
  rm -f "$_model_tmp"; unset _model_tmp
  [[ -n "$OPENCODE_FREE_LIST" ]] || OPENCODE_FREE_LIST="$OPENCODE_FREE_FALLBACK"
  # Kosong = grup Go disembunyikan (belum login); jangan diisi fallback.
  OPENCODE_GO_LIST="${OPENCODE_GO_LIST:-}"
  TIER_PIN="$OPENCODE_FREE_LIST"
  TIER_GO_PIN="$OPENCODE_GO_LIST"
  TIER="$(pilih_tier_model .env.local)"
  if [[ "$TIER" == "tier3" ]]; then
    TIER_DEFAULT="$(tier3_default_dari_daftar "$OPENCODE_FREE_LIST")"
  else
    TIER_DEFAULT="$(tier_default_model "$TIER")"
  fi
  info "Tier model Pro Workbench: ${TIER} (${TIER_DEFAULT})."
  if [[ "${OPENCODE_LOGIN_DETECTED:-0}" -eq 1 ]]; then
    info "Model aktif (OPENCODE_MODELS, sudah login): ${OPENCODE_FREE_LIST}."
    info "Model Go aktif (OPENCODE_GO_MODELS): ${OPENCODE_GO_LIST}."
  else
    info "Model free aktif (OPENCODE_MODELS): ${OPENCODE_FREE_LIST}."
    info "Model Go disembunyikan (belum login; login lalu jalankan ulang installer)."
  fi
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
  # Slot agent kini tinggal di openmaic.yml (MODEL_ROUTES tidak dibaca server:
  # tanpa file ini server menolak start; dengan file ini routes diabaikan).
  # Buat dari tier bila belum ada; file yang sudah ada tidak disentuh.
  tulis_openmaic_yml_bila_belum_ada "$TIER" "$TIER_DEFAULT"
  CUR_DRIVER="$(sed -n -E 's/^[^#]*"maic-agent-driver"[^}]*"model"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' .env.local | head -1)"
  case "$CUR_DRIVER" in
    ollama:*|opencode:gpt-6-luna|opencode-go:gpt-6-luna|google:gemini-3.5-flash-lite|deepseek:deepseek-flash|opencode:space-bunny-free|opencode:muse-spark-1.3-contributor-free|opencode:big-pickle|opencode:longcat-2.5-preview-free|opencode:mimo-v2.6-flash-free|opencode:ling-3.0-flash-fin-free|opencode:nemotron-3-ultra-free|opencode:nemotron-3.5-lightning-free|opencode:*-free|tokendance:deepseek-v4.1-flash)
      # Nilai milik installer: sudah diwakili slot agent openmaic.yml di atas,
      # jadi baris warisan dikomentari (nilai dipertahankan sebagai jejak).
      sed -i -E 's|^[[:space:]]*MODEL_ROUTES=|# MODEL_ROUTES (dipindah ke openmaic.yml slot agent; tidak dibaca server) was: |' .env.local
      info "MODEL_ROUTES warisan dikomentari (slot agent kini di openmaic.yml = ${TIER_DEFAULT}, ${TIER})."
      ;;
    ?*)
      warn "MODEL_ROUTES kustom terdeteksi (${CUR_DRIVER}) — server mengabaikannya selama openmaic.yml ada; pindahkan manual ke slots bila masih diperlukan, lalu hapus barisnya."
      ;;
  esac
  # ada, jadi pin milik installer harus dipindah eksplisit di sini. Nilai
  # kustom lain tidak disentuh. Daftar kini login-aware: sudah login berisi
  # SEMUA model tersedia, belum login berisi SEMUA model free (tombol
  # /workspace memilih di antaranya). Hanya migrasi bila tiap entri adalah id
  # milik installer (daftar fallback + daftar live saat ini) — nilai kustom
  # operator (mis. berisi id di luar keduanya) dipertahankan.
  CUR_PIN="$(env_get .env.local OPENCODE_MODELS)"
  if [[ -n "$CUR_PIN" ]]; then
    _pin_milik_installer=1
    _ifs_lama="$IFS"; IFS=','; set -f
    for _satu in $CUR_PIN; do
      _satu="$(printf '%s' "$_satu" | tr -d '[:space:]' | sed -E 's|^opencode[/:]||')"
      case ",${OPENCODE_FREE_FALLBACK},gpt-6-luna,${TIER_PIN}," in
        *",${_satu},"*) ;;
        *) _pin_milik_installer=0; break ;;
      esac
    done
    set +f; IFS="$_ifs_lama"; unset _ifs_lama _satu
    if [[ "$_pin_milik_installer" -eq 1 && "$CUR_PIN" != "$TIER_PIN" ]]; then
      PIN_ESCAPED="$(sed_escape_replacement "$TIER_PIN")"
      sed -i -E "s|^[[:space:]]*OPENCODE_MODELS=.*|OPENCODE_MODELS=${PIN_ESCAPED}|" .env.local
      if [[ "${OPENCODE_LOGIN_DETECTED:-0}" -eq 1 ]]; then
        info "OPENCODE_MODELS dipindah ${CUR_PIN} -> ${TIER_PIN} (semua model tersedia, sudah login)."
      else
        info "OPENCODE_MODELS dipindah ${CUR_PIN} -> ${TIER_PIN} (semua model free aktif)."
      fi
    elif [[ "$_pin_milik_installer" -eq 0 ]]; then
      info "OPENCODE_MODELS kustom dipertahankan (${CUR_PIN})."
    fi
    unset _pin_milik_installer
  fi
  # OPENCODE_GO_MODELS (grup kedua pemilih workbench): migrasi milik installer
  # yang sama — allowlist = fallback free + fallback all + live saat ini.
  CUR_GO_PIN="$(env_get .env.local OPENCODE_GO_MODELS)"
  if [[ -n "$CUR_GO_PIN" ]]; then
    _go_milik_installer=1
    _ifs_go="$IFS"; IFS=','; set -f
    for _satu_go in $CUR_GO_PIN; do
      _satu_go="$(printf '%s' "$_satu_go" | tr -d '[:space:]' | sed -E 's|^opencode-go[/:]||')"
      case ",${OPENCODE_GO_FREE_FALLBACK},${OPENCODE_GO_ALL_FALLBACK},${TIER_GO_PIN}," in
        *",${_satu_go},"*) ;;
        *) _go_milik_installer=0; break ;;
      esac
    done
    set +f; IFS="$_ifs_go"; unset _ifs_go _satu_go
    if [[ "$_go_milik_installer" -eq 1 && "$CUR_GO_PIN" != "$TIER_GO_PIN" ]]; then
      GO_PIN_ESCAPED="$(sed_escape_replacement "$TIER_GO_PIN")"
      sed -i -E "s|^[[:space:]]*OPENCODE_GO_MODELS=.*|OPENCODE_GO_MODELS=${GO_PIN_ESCAPED}|" .env.local
      if [[ -z "$TIER_GO_PIN" ]]; then
        info "OPENCODE_GO_MODELS dikosongkan (grup Go disembunyikan, belum login)."
      else
        info "OPENCODE_GO_MODELS dipindah ${CUR_GO_PIN} -> ${TIER_GO_PIN}."
      fi
    elif [[ "$_go_milik_installer" -eq 0 ]]; then
      info "OPENCODE_GO_MODELS kustom dipertahankan (${CUR_GO_PIN})."
    fi
    unset _go_milik_installer
  fi
  pastikan_var_env .env.local DEFAULT_MODEL "$TIER_DEFAULT"
  # MODEL_ROUTES tidak lagi ditulis/di-ensure: server tidak membacanya
  # (slot agent tinggal di openmaic.yml; lihat migrasi di atas).
  pastikan_var_env .env.local OPENCODE_BIN ""
  # Key tier1/tier2 opsional; jangan buat key kosong yang mengesankan wajib
  # — tier dipilih dari key yang terisi. Cukup pastikan pin model tersedia.
  pastikan_var_env .env.local OPENCODE_MODELS "$TIER_PIN"
  pastikan_var_env .env.local OPENCODE_GO_MODELS "$TIER_GO_PIN"
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
  # Placeholder Hugging Face S3 (tetap nonaktif sampai user mengisi).
  pastikan_komentar_env .env.local HF_S3_BUCKET "kelaska"
  pastikan_komentar_env .env.local HF_S3_ENDPOINT "https://s3.hf.co/akj2025"
  pastikan_komentar_env .env.local HF_S3_REGION "us-east-1"
  pastikan_komentar_env .env.local HF_S3_ACCESS_KEY_ID ""
  pastikan_komentar_env .env.local HF_S3_SECRET_ACCESS_KEY ""
  pastikan_komentar_env .env.local HF_TOKEN ""
  # Placeholder Supabase (tetap nonaktif; aktifkan saat memakai DATABASE_URL Supabase).
  pastikan_komentar_env .env.local SUPABASE_URL "https://<ref>.supabase.co"
  pastikan_komentar_env .env.local NEXT_PUBLIC_SUPABASE_URL "https://<ref>.supabase.co"
  pastikan_komentar_env .env.local SUPABASE_ANON_KEY ""
  pastikan_komentar_env .env.local NEXT_PUBLIC_SUPABASE_ANON_KEY ""
  pastikan_komentar_env .env.local SUPABASE_PUBLISHABLE_KEY ""
  pastikan_komentar_env .env.local NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ""
  pastikan_komentar_env .env.local SUPABASE_SERVICE_ROLE_KEY ""
  pastikan_komentar_env .env.local SUPABASE_SECRET_KEY ""
  pastikan_komentar_env .env.local SUPABASE_JWT_SECRET ""
  pastikan_komentar_env .env.local POSTGRES_DATABASE "postgres"
  pastikan_komentar_env .env.local POSTGRES_HOST "db.<ref>.supabase.co"
  pastikan_komentar_env .env.local POSTGRES_USER "postgres"
  pastikan_komentar_env .env.local POSTGRES_PASSWORD ""
  pastikan_komentar_env .env.local POSTGRES_PRISMA_URL ""
  pastikan_komentar_env .env.local POSTGRES_URL ""
  pastikan_komentar_env .env.local POSTGRES_URL_NON_POOLING ""
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
    # Tanpa --with-postgres: flag aktif tanpa DATABASE_URL = warning [config] tiap boot
    # (lib/server/config-validation.ts), jadi turunkan. Nilai lain dibiarkan.
    DB_URL_ISI="$(env_get .env.local DATABASE_URL)"
    if [[ -z "$DB_URL_ISI" ]]; then
      set_agent_runtime_flag false "Postgres dilewati (tanpa --with-postgres)"
      pastikan_var_env .env.local OPENMAIC_AGENT_RUNTIME_ENABLED "false"
    fi
    warn "Postgres dilewati: agent runtime/persistence tidak disiapkan (nilai .env.local Anda tidak diubah)."
  fi
fi

# ============================================================ 5a. instance secret
# Pin OPENMAIC_SECRET_KEY ke .env.local (baru maupun lama). Tanpa ini, rebuild
# menghapus secret acak di .next/standalone/data/ dan semua provider key
# ter-seal di DB menjadi tak terbaca (insiden 2026-10-08). Idempoten: nilai
# yang sudah ada tidak disentuh; file secret yang hidup diadopsi.
LANGKAH="instance-secret"
pastikan_instance_secret .env.local
chmod 600 .env.local 2>/dev/null || true

# ============================================================ 5b. pgAdmin4 web
# Default OFF (pasang dengan --with-pgadmin). Server headless -> varian
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
    # Tanpa systemd (container/docker/WSL), setup-web.sh SELALU mencetak:
    #   "System has not been booted with systemd..." / "Failed to connect to bus"
    #   "Error starting apache2. Please check the systemd logs"
    # Itu BUKAN kegagalan setup DB — hanya tahap `systemctl start apache2` di
    # dalam setup-web.sh yang memang tidak bisa jalan tanpa PID 1 systemd.
    # Konfigurasi DB + conf Apache tetap terbentuk; Apache dinyalakan via
    # fallback service/apache2ctl di langkah "pgAdmin4: apache" di bawah.
    if [[ ! -d /run/systemd/system ]]; then
      info "Lingkungan tanpa systemd terdeteksi — error 'Failed to connect to bus / Error starting apache2' dari setup-web.sh adalah normal dan diabaikan."
    fi
    # env di depan meneruskan kredensial lewat sudo yang env_reset
    # (run_as_root meneruskannya sebagai argumen env, bukan variabel shell).
    # Pada pgAdmin 9.x variabel ini diabaikan upstream, tapi tetap
    # diteruskan untuk kompatibilitas versi lama.
    # Output ditangkap lalu ditampilkan tersaring: UserWarning alembic
    # (CHECK tanpa nama di tabel sharedserver) + noise systemd-sysv-install
    # adalah benign dan selama ini menutupi status asli.
    PGADMIN_SETUP_LOG="$(mktemp)"
    PGADMIN_SETUP_RC=0
    if run_as_root env PGADMIN_SETUP_EMAIL="$PGADMIN_EMAIL" \
      PGADMIN_SETUP_PASSWORD="$PGADMIN_PASSWORD" \
      /usr/pgadmin4/bin/setup-web.sh --yes >"$PGADMIN_SETUP_LOG" 2>&1; then
      PGADMIN_SETUP_RC=0
    else
      PGADMIN_SETUP_RC=$?
    fi
    # Tampilkan log yang sudah disaring agar langkah penting tetap terlihat
    # (Creating configuration database, Apache successfully enabled).
    # `|| true` karena grep exit 1 bila semua baris tersaring (pipefail + set -e).
    grep -vE "UserWarning|batch\.py:[0-9]+|Naming CHECK constraints" "$PGADMIN_SETUP_LOG" 2>/dev/null \
      | grep -vE "Synchronizing state of apache2|systemd-sysv-install enable apache2|System has not been booted with systemd|Failed to connect to bus" || true
    # Kriteria sukses = DB konfigurasi ada ATAU conf Apache terdaftar.
    # Bila setup-web.sh gagal HANYA di tahap start apache (khas tanpa systemd)
    # tapi DB/conf sudah terbentuk, anggap berhasil — Apache ditangani fallback.
    if [[ "$PGADMIN_SETUP_RC" -ne 0 ]]; then
      if [[ -f "$PGADMIN_DB" || -f "$PGADMIN_DB_LEGACY" || -e /etc/apache2/conf-enabled/pgadmin4.conf || -e /etc/apache2/conf-available/pgadmin4.conf ]]; then
        warn "setup-web.sh exit ${PGADMIN_SETUP_RC} pada tahap start Apache (umum tanpa systemd) — konfigurasi DB/conf sudah ada, dilanjutkan."
        rm -f "$PGADMIN_SETUP_LOG"
      else
        warn "setup-web.sh gagal (exit ${PGADMIN_SETUP_RC}); log penuh tersimpan di ${PGADMIN_SETUP_LOG}. Jalankan manual: sudo /usr/pgadmin4/bin/setup-web.sh --yes"
        # Sengaja TIDAK dihapus agar bisa didiagnosis; run berikutnya memakai mktemp baru.
      fi
    else
      # Walau exit 0, setup-web.sh tanpa systemd selalu mencetak "Error starting
      # apache2" — tegaskan agar tidak dikira gagal bila DB/conf sudah ada.
      if grep -qE "Error starting apache2|Failed to connect to bus" "$PGADMIN_SETUP_LOG" 2>/dev/null; then
        info "setup-web.sh selesai (pesan 'Error starting apache2' di atas normal tanpa systemd; Apache dinyalakan via fallback service/apache2ctl di bawah)."
      fi
      rm -f "$PGADMIN_SETUP_LOG"
    fi
    # Pastikan modul/conf Apache terdaftar walau setup-web.sh berhenti di tahap
    # start (tanpa systemd). Idempoten: a2enmod/a2enconf exit 0 bila sudah aktif.
    if command -v a2enmod >/dev/null 2>&1; then
      run_as_root a2enmod wsgi >/dev/null 2>&1 || true
    fi
    if command -v a2enconf >/dev/null 2>&1; then
      run_as_root a2enconf pgadmin4 >/dev/null 2>&1 || true
    fi
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
  # Tanpa systemd, `systemctl` pasti gagal ("Host is down") — jangan coba dulu,
  # langsung pakai service/apache2ctl agar tidak menambah noise error.
  LANGKAH="pgAdmin4: apache"
  # Redam warning AH00558 (`Could not reliably determine the server's fully
  # qualified domain name`) yang muncul di tiap `apache2ctl configtest` /
  # `service apache2 start|reload`: tanpa ServerName global Apache menebak dari
  # /etc/hosts. Idempoten: hanya tambah bila belum ada.
  if [[ -f /etc/apache2/apache2.conf ]] \
    && ! grep -qsE '^[[:space:]]*ServerName' /etc/apache2/apache2.conf; then
    echo "ServerName localhost" | run_as_root tee -a /etc/apache2/apache2.conf >/dev/null
  fi
  PGADMIN_NO_SYSTEMD=0
  if [[ ! -d /run/systemd/system ]]; then PGADMIN_NO_SYSTEMD=1; fi
  if pgrep -x apache2 >/dev/null 2>&1; then
    info "Apache sudah berjalan."
  elif [[ "$PGADMIN_NO_SYSTEMD" -eq 0 ]] && command -v systemctl >/dev/null 2>&1; then
    if run_as_root systemctl enable --now apache2; then
      info "Apache dinyalakan."
    else
      warn "Apache gagal dinyalakan — cek: sudo systemctl status apache2"
    fi
  elif command -v service >/dev/null 2>&1; then
    # Validasi konfigurasi dulu agar pesan error jelas (mis. port bentrok),
    # bukan sekadar "gagal" tanpa sebab.
    run_as_root apache2ctl configtest 2>&1 || true
    if run_as_root service apache2 start; then
      info "Apache dinyalakan (via service, lingkungan tanpa systemd)."
    else
      warn "'service apache2 start' gagal; cek: sudo apache2ctl configtest && sudo service apache2 status. Nyalakan manual: sudo service apache2 start"
    fi
  elif command -v apache2ctl >/dev/null 2>&1; then
    run_as_root apache2ctl configtest 2>&1 || true
    if run_as_root apache2ctl start; then
      info "Apache dinyalakan (via apache2ctl, lingkungan tanpa systemd)."
    else
      warn "apache2ctl start gagal; cek: sudo apache2ctl configtest. Nyalakan manual: sudo apache2ctl start"
    fi
  else
    warn "Apache tidak terdeteksi berjalan; nyalakan manual: sudo service apache2 start (tanpa systemd) atau sudo systemctl start apache2"
  fi
  if pgrep -x apache2 >/dev/null 2>&1; then
    if [[ "$PGADMIN_NO_SYSTEMD" -eq 0 ]] && command -v systemctl >/dev/null 2>&1; then
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
    # Beri diagnosis yang bisa ditindaklanjuti, bukan sekadar "tunggu lalu coba".
    if ! pgrep -x apache2 >/dev/null 2>&1; then
      warn "pgAdmin4 belum merespons di http://localhost/pgadmin4 dan proses apache2 tidak jalan. Diagnosis: sudo apache2ctl configtest; sudo service apache2 status; tail -20 /var/log/apache2/error.log"
    else
      warn "pgAdmin4 belum merespons di http://localhost/pgadmin4 (Apache jalan tapi /pgadmin4 belum OK) — tunggu restart selesai lalu coba lagi. Bila tetap gagal: sudo apache2ctl configtest; ls /etc/apache2/conf-enabled/pgadmin4.conf; tail -20 /var/log/apache2/error.log"
    fi
  fi
else
  info "Lewati pgAdmin4 web (default; pasang dengan --with-pgadmin)."
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

  # Bootstrap skema database eager (28 tabel persistence + agent runtime) agar
  # boot pertama bersih — tanpa ini tabel LAZY dibuat saat server jalan dan
  # log dev pertama penuh error 42P01 (relation "agent_sessions" does not
  # exist, dst.) sampai tiap store terinisialisasi. Idempoten (IF NOT EXISTS);
  # runtime tetap lazy-bootstrap sendiri bila langkah ini dilewati/gagal.
  # Mencakup 4 tabel generation_runs*/generation_run_* (server-first 1.2.0).
  LANGKAH="bootstrap skema database"
  if [[ "$WITH_POSTGRES" -eq 1 && -f scripts/bootstrap-db-schema.mts ]]; then
    DB_URL_EFEKTIF="$(env_get .env.local DATABASE_URL)"
    if [[ -n "$DB_URL_EFEKTIF" ]]; then
      info "Bootstrap skema database (eager, via tsx)..."
      if DATABASE_URL="$DB_URL_EFEKTIF" pnpm exec tsx scripts/bootstrap-db-schema.mts; then
        info "Skema database: OK (boot pertama bersih)."
      else
        warn "Bootstrap skema database gagal; skema tetap dibuat lazy saat server jalan. Cek DATABASE_URL lalu ulangi manual: DATABASE_URL=\"\$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)\" pnpm exec tsx scripts/bootstrap-db-schema.mts"
      fi
    else
      info "Lewati bootstrap skema database (DATABASE_URL kosong di .env.local)."
    fi
  else
    info "Lewati bootstrap skema database (tanpa postgres/--no-install: butuh --with-postgres + node_modules)."
  fi
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
  # Login-aware: sudah `opencode auth login` -> SEMUA model tersedia diaktifkan;
  # belum login -> hanya model free (perilaku lama). Template seksi 5 dibuat
  # SEBELUM CLI terinstal sehingga nilainya masih fallback; segarkan di sini
  # dengan hasil live `opencode models` sebagai pemilik sesi (bukan /root).
  # Tombol pemilih model /workspace (GET/POST /api/agent/models) memakai daftar ini.
  if [[ -f .env.local ]]; then
    _live_tmp="$(mktemp)"
    if daftar_model_aktif_opencode "${OPENCODE_BIN_DETECTED:-}" >"$_live_tmp" 2>/dev/null; then
      OPENCODE_FREE_LIVE="$(cat "$_live_tmp")"
    else
      OPENCODE_FREE_LIVE="$OPENCODE_FREE_FALLBACK"
    fi
    rm -f "$_live_tmp"; unset _live_tmp
    [[ -n "$OPENCODE_FREE_LIVE" ]] || OPENCODE_FREE_LIVE="$OPENCODE_FREE_FALLBACK"
    # Kosong = grup Go disembunyikan (belum login); jangan diisi fallback.
    OPENCODE_GO_LIST="${OPENCODE_GO_LIST:-}"
    OPENCODE_GO_LIVE="$OPENCODE_GO_LIST"
    if [[ "${OPENCODE_LOGIN_DETECTED:-0}" -eq 1 ]]; then
      OPENCODE_LIVE_LABEL="semua model tersedia (sudah login)"
    else
      OPENCODE_LIVE_LABEL="semua model free"
    fi
    CUR_PIN_LIVE="$(env_get .env.local OPENCODE_MODELS)"
    if [[ -z "$CUR_PIN_LIVE" ]]; then
      echo "OPENCODE_MODELS=${OPENCODE_FREE_LIVE}" >> .env.local
      info "OPENCODE_MODELS disegarkan ke ${OPENCODE_LIVE_LABEL}: ${OPENCODE_FREE_LIVE}."
    else
      _live_milik_installer=1
      _ifs_live="$IFS"; IFS=','; set -f
      for _satu_live in $CUR_PIN_LIVE; do
        _satu_live="$(printf '%s' "$_satu_live" | tr -d '[:space:]' | sed -E 's|^opencode[/:]||')"
        case ",${OPENCODE_FREE_FALLBACK},gpt-6-luna,${OPENCODE_FREE_LIVE}," in
          *",${_satu_live},"*) ;;
          *) _live_milik_installer=0; break ;;
        esac
      done
      set +f; IFS="$_ifs_live"; unset _ifs_live _satu_live
      if [[ "$_live_milik_installer" -eq 1 ]]; then
        if [[ "$CUR_PIN_LIVE" != "$OPENCODE_FREE_LIVE" ]]; then
          PIN_LIVE_ESCAPED="$(sed_escape_replacement "$OPENCODE_FREE_LIVE")"
          sed -i -E "s|^[[:space:]]*OPENCODE_MODELS=.*|OPENCODE_MODELS=${PIN_LIVE_ESCAPED}|" .env.local
          info "OPENCODE_MODELS disegarkan ke ${OPENCODE_LIVE_LABEL}: ${OPENCODE_FREE_LIVE}."
        else
          info "OPENCODE_MODELS sudah memuat ${OPENCODE_LIVE_LABEL} (${CUR_PIN_LIVE})."
        fi
      else
        info "OPENCODE_MODELS kustom dipertahankan (${CUR_PIN_LIVE}); daftar live: ${OPENCODE_FREE_LIVE}."
      fi
      unset _live_milik_installer
    fi
    # Sinkronkan DEFAULT_MODEL tier3 bila masih pin lama single-id (jangan
    # timpa kustom non-opencode, hanya preset installer). Slot agent di
    # openmaic.yml ikut diselaraskan bila file milik installer dan modelnya
    # pin lama yang sama; MODEL_ROUTES warisan tidak disentuh lagi (mati).
    if grep -qE '^[[:space:]]*DEFAULT_MODEL=opencode:(space-bunny-free|muse-spark-1.3-contributor-free|big-pickle)$' .env.local 2>/dev/null; then
      TIER3_LIVE_DEFAULT="$(tier3_default_dari_daftar "$OPENCODE_FREE_LIVE")"
      TIER3_LIVE_ESCAPED="$(sed_escape_replacement "$TIER3_LIVE_DEFAULT")"
      sed -i -E "s|^[[:space:]]*DEFAULT_MODEL=.*|DEFAULT_MODEL=${TIER3_LIVE_ESCAPED}|" .env.local
      if grep -q "dibuat oleh install.sh" openmaic.yml 2>/dev/null && grep -qE '^[[:space:]]*model: opencode:(space-bunny-free|muse-spark-1.3-contributor-free|big-pickle)$' openmaic.yml 2>/dev/null; then
        sed -i -E "s#^([[:space:]]*model: )opencode:(space-bunny-free|muse-spark-1.3-contributor-free|big-pickle)\$#\1${TIER3_LIVE_ESCAPED}#" openmaic.yml
        info "Slot agent openmaic.yml diselaraskan ke default live ${TIER3_LIVE_DEFAULT}."
      fi
      info "DEFAULT_MODEL diselaraskan ke default live ${TIER3_LIVE_DEFAULT}."
    fi
    # OPENCODE_GO_MODELS (grup kedua pemilih workbench): segarkan dengan pola
    # milik-installer yang sama; kustom operator dipertahankan. Kosong = hidden.
    CUR_GO_LIVE="$(env_get .env.local OPENCODE_GO_MODELS)"
    if [[ "${OPENCODE_GO_LIVE:-}" == "" ]]; then
      GO_LIVE_LABEL="disembunyikan (belum login)"
    else
      GO_LIVE_LABEL="${OPENCODE_LIVE_LABEL}"
    fi
    if [[ -z "$CUR_GO_LIVE" ]]; then
      if grep -qE '^[[:space:]]*OPENCODE_GO_MODELS=' .env.local; then
        GO_LIVE_ESCAPED="$(sed_escape_replacement "$OPENCODE_GO_LIVE")"
        sed -i -E "s|^[[:space:]]*OPENCODE_GO_MODELS=.*|OPENCODE_GO_MODELS=${GO_LIVE_ESCAPED}|" .env.local
      else
        echo "OPENCODE_GO_MODELS=${OPENCODE_GO_LIVE}" >> .env.local
      fi
      if [[ -z "$OPENCODE_GO_LIVE" ]]; then
        info "OPENCODE_GO_MODELS disembunyikan (belum login; login lalu jalankan ulang installer)."
      else
        info "OPENCODE_GO_MODELS disegarkan ke ${GO_LIVE_LABEL}: ${OPENCODE_GO_LIVE}."
      fi
    else
      _go_live_milik=1
      _ifs_go_live="$IFS"; IFS=','; set -f
      for _satu_go_live in $CUR_GO_LIVE; do
        _satu_go_live="$(printf '%s' "$_satu_go_live" | tr -d '[:space:]' | sed -E 's|^opencode-go[/:]||')"
        case ",${OPENCODE_GO_FREE_FALLBACK},${OPENCODE_GO_ALL_FALLBACK},${OPENCODE_GO_LIVE}," in
          *",${_satu_go_live},"*) ;;
          *) _go_live_milik=0; break ;;
        esac
      done
      set +f; IFS="$_ifs_go_live"; unset _ifs_go_live _satu_go_live
      if [[ "$_go_live_milik" -eq 1 ]]; then
        if [[ "$CUR_GO_LIVE" != "$OPENCODE_GO_LIVE" ]]; then
          GO_LIVE_ESCAPED="$(sed_escape_replacement "$OPENCODE_GO_LIVE")"
          sed -i -E "s|^[[:space:]]*OPENCODE_GO_MODELS=.*|OPENCODE_GO_MODELS=${GO_LIVE_ESCAPED}|" .env.local
          info "OPENCODE_GO_MODELS disegarkan ke ${OPENCODE_LIVE_LABEL}: ${OPENCODE_GO_LIVE}."
        else
          info "OPENCODE_GO_MODELS sudah memuat ${OPENCODE_LIVE_LABEL} (${CUR_GO_LIVE})."
        fi
      else
        info "OPENCODE_GO_MODELS kustom dipertahankan (${CUR_GO_LIVE}); daftar live: ${OPENCODE_GO_LIVE}."
      fi
      unset _go_live_milik
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

# ============================================================ 12. PM2 (opsional)
# Produksi via PM2 (ecosystem.config.cjs -> server standalone Next.js):
# instal PM2 global, pastikan build produksi ada, sinkronkan aset standalone,
# lalu start/reload sebagai user pemilik sesi + save + unit systemd agar hidup
# setelah reboot. Idempoten: run ulang me-reload tanpa downtime (startOrReload).
# Ditempatkan SETELAH seksi 11 (kepemilikan) supaya artefak yang dibaca daemon
# PM2 (milik user, bukan root) sudah benar ownernya; build dadakan di seksi
# ini yang lahir sebagai root di-chown ulang ke pemilik sebelum start.
if [[ "$WITH_PM2" -eq 1 ]]; then
  if [[ "$WITH_INSTALL" -ne 1 ]]; then
    fail "--with-pm2 butuh dependensi terinstal; ulangi tanpa --no-install."
  fi
  # User pemilik sesi (bukan /root saat sudo): daemon PM2 + ~/.pm2 harus milik
  # user ini agar `pm2 logs/list` sebagai user biasa tetap bisa. Pola yang sama
  # dipakai Playwright (seksi 9) dan OpenCode CLI (seksi 8).
  PM2_USER="${SUDO_USER:-$(id -un)}"
  if ! id -u "$PM2_USER" >/dev/null 2>&1; then PM2_USER="$(id -un)"; fi
  pm2_sebagai_pemilik() {
    if [[ "$(id -un)" == "$PM2_USER" ]]; then
      "$@"
    else
      run_as_root -H -u "$PM2_USER" "$@"
    fi
  }
  LANGKAH="pm2: instalasi"
  if command -v pm2 >/dev/null 2>&1; then
    info "PM2 sudah terinstal ($(pm2 --version 2>/dev/null || echo '?'))."
  else
    info "Menginstal PM2 global via npm..."
    run_as_root npm install -g pm2 \
      || warn "Instalasi PM2 gagal; pasang manual: npm install -g pm2"
    hash -r 2>/dev/null || true
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    warn "PM2 tidak ditemukan setelah instalasi — lewati orkestrasi PM2. Pasang manual lalu: pm2 startOrReload ecosystem.config.cjs && pm2 save"
  else
    # PM2 butuh server standalone (.next/standalone/server.js). Build bila
    # belum ada; bila --build sudah jalan di seksi 10, pakai hasilnya.
    LANGKAH="pm2: build produksi"
    if [[ ! -f .next/standalone/server.js ]]; then
      info "Build produksi belum ada — menjalankan npm run build untuk PM2..."
      npm run build
    elif [[ "$WITH_BUILD" -eq 1 ]]; then
      info "Build produksi sudah dibuat di seksi --build; dipakai untuk PM2."
    else
      info "Memakai build produksi yang ada (.next/standalone/server.js)."
      warn "Bila NEXT_PUBLIC_* di .env.local berubah, build ulang agar ikut: npm run build"
    fi
    # Sinkronkan aset ke dalam standalone (lihat komentar ecosystem.config.cjs):
    # server.js standalone hanya membaca di dalam .next/standalone/.
    LANGKAH="pm2: sinkron aset standalone"
    if [[ -f .next/standalone/server.js ]]; then
      mkdir -p .next/standalone/.next
      cp -r .next/static .next/standalone/.next/static
      cp -r public .next/standalone/public
      # openmaic.yml dibaca server via process.cwd() (= .next/standalone setelah
      # server.js chdir). Tanpa salinan ini + OPENMAIC_CONFIG di ecosystem,
      # deployment layer jatuh ke legacy dan slot agent/classroom diabaikan
      # (diskusi classroom tetap pakai workspace llm=google -> 400/429).
      # OPENMAIC_CONFIG absolut (ecosystem) sudah cukup, salinan ini cadangan
      # bila env hilang.
      if [[ -f openmaic.yml ]]; then
        cp -f openmaic.yml .next/standalone/openmaic.yml
      fi
      info "Aset standalone disinkronkan (.next/static + public + openmaic.yml)."
      # Prompt PBL (@openmaic/generation/prompts-pbl) dibaca runtime via
      # readFileSync dengan path komputasi, jadi dikirim via
      # outputFileTracingIncludes di next.config.ts (bukan cp manual).
      # Verifikasi: bila file ini hilang, SEMUA scene PBL gagal ENOENT dan run
      # paused berulang (insiden 2026-10-08). Gagalkan cepat dengan pesan jelas
      # agar tidak disangka model/provider rusak.
      if [[ ! -f .next/standalone/packages/@openmaic/generation/prompts-pbl/planner-single-call-system.md ]]; then
        warn "prompts-pbl PBL tidak ada di standalone (.next/standalone/packages/@openmaic/generation/prompts-pbl/) — scene PBL akan gagal ENOENT. Pastikan next.config.ts outputFileTracingIncludes memuatnya lalu build ulang."
      fi
      # Build/sync di atas lahir sebagai root bila via sudo (seksi 11 sudah
      # lewat) — kembalikan ke pemilik sebelum daemon PM2 membacanya.
      if [[ -n "${SUDO_USER:-}" && "$PM2_USER" != "root" ]]; then
        chown -R "$PM2_USER" .next 2>/dev/null \
          || warn "Gagal chown .next ke ${PM2_USER}; jalankan manual: sudo chown -R ${PM2_USER} .next"
      fi
    else
      warn "server.js standalone tidak ada — lewati sinkron aset dan start PM2."
    fi
    LANGKAH="pm2: start/reload"
    if [[ -f .next/standalone/server.js ]]; then
      # -H agar HOME milik target (daemon + dump file di ~/.pm2 user, bukan
      # /root). cd ke root repo agar path relatif ecosystem.config.cjs benar.
      if [[ "$(id -un)" == "$PM2_USER" ]]; then
        (cd "$ROOT_DIR" && pm2 startOrReload ecosystem.config.cjs)
      else
        run_as_root -H -u "$PM2_USER" bash -c "cd $(printf '%q' "$ROOT_DIR") && pm2 startOrReload ecosystem.config.cjs"
      fi
      pm2_sebagai_pemilik pm2 save \
        || warn "pm2 save gagal; daftar proses tidak tersimpan — jalankan manual: pm2 save"
      info "Aplikasi berjalan via PM2 (nama proses: kelaska)."
      # Hidup setelah reboot via unit systemd (hanya bila systemd ada; tanpa
      # systemd — container/WSL — cukup cetak instruksi manual).
      LANGKAH="pm2: startup systemd"
      if [[ -d /run/systemd/system ]]; then
        PM2_HOME_OWNER="$(getent passwd "$PM2_USER" 2>/dev/null | cut -d: -f6 || true)"
        [[ -n "$PM2_HOME_OWNER" ]] || PM2_HOME_OWNER="/home/$PM2_USER"
        if run_as_root pm2 startup systemd -u "$PM2_USER" --hp "$PM2_HOME_OWNER" >/dev/null 2>&1; then
          info "Unit systemd PM2 terpasang — aplikasi hidup lagi setelah reboot."
        else
          warn "Unit systemd PM2 gagal dipasang otomatis; pasang manual: pm2 startup (lalu jalankan perintah sudo yang dicetak) && pm2 save"
        fi
      else
        info "Tanpa systemd — lewati unit startup (setelah reboot jalankan manual sebagai ${PM2_USER}: pm2 resurrect)."
      fi
    fi
  fi
else
  info "Lewati PM2 (pakai --with-pm2 untuk produksi via PM2)."
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
if [[ "$WITH_PLAYWRIGHT" -eq 1 ]]; then
  PW_CACHE_HOME="$(getent passwd "${SUDO_USER:-$(id -un)}" 2>/dev/null | cut -d: -f6 || true)"
  [[ -n "$PW_CACHE_HOME" ]] || PW_CACHE_HOME="$HOME"
  if [[ -d "$PW_CACHE_HOME/.cache/ms-playwright" ]]; then
    info "  Playwright Chromium: OK (e2e siap: pnpm test:e2e)"
  else
    warn "Playwright Chromium tidak terdeteksi — pasang dengan: pnpm exec playwright install --with-deps chromium (atau sudo ./install.sh --yes --full)"
  fi
fi
if [[ "$WITH_BUILD" -eq 1 || "$WITH_PM2" -eq 1 ]]; then
  if [[ -d .next ]]; then
    info "  Build produksi: OK (.next ada; jalankan via npm run start)"
  else
    warn "Build produksi tidak menghasilkan .next — ulangi: npm run build"
  fi
fi
if [[ "$WITH_PM2" -eq 1 ]]; then
  # Daemon PM2 milik pemilik sesi, bukan root saat sudo — tanya ke user itu.
  PM2_SUM_USER="${SUDO_USER:-$(id -un)}"
  if [[ "$(id -un)" == "$PM2_SUM_USER" ]]; then
    PM2_LIST="$(pm2 list 2>/dev/null || true)"
  else
    PM2_LIST="$(run_as_root -H -u "$PM2_SUM_USER" pm2 list 2>/dev/null || true)"
  fi
  if printf '%s' "$PM2_LIST" | grep -q 'kelaska'; then
    info "  PM2: OK (proses kelaska; kelola: pm2 logs kelaska | pm2 reload kelaska | pm2 stop kelaska)"
  else
    warn "PM2 tidak menjalankan kelaska — cek sebagai ${PM2_SUM_USER}: pm2 list && pm2 logs kelaska"
  fi
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
if [[ "$WITH_PM2" -eq 1 ]]; then
  echo ""
  echo "PM2 (produksi, sudah jalan sebagai ${SUDO_USER:-$(id -un)}):"
  echo "  pm2 logs kelaska    # lihat log"
  echo "  pm2 reload kelaska  # restart tanpa downtime (baca ulang .env.local)"
  echo "  pm2 stop kelaska    # hentikan"
  echo "  Ubah PORT di .env.local -> pm2 reload kelaska (runtime, tanpa build)."
  echo "  Ubah NEXT_PUBLIC_* -> npm run build -> sinkron aset standalone"
  echo "  (lihat ecosystem.config.cjs) -> pm2 reload kelaska."
fi
if [[ "$WITH_COLAB" -eq 1 ]]; then
  echo ""
  echo "Colab: ekspos port 3000 ke browser dengan sel Python:"
  echo "  from google.colab import output"
  echo "  output.serve_kernel_port_as_window(3000)"
  echo "  Runtime Colab itu ephemerial: data/ dan database hilang saat runtime"
  echo "  didaur ulang — unduh .env.local dan backup data/ sebelum menutup."
fi
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
echo "       SEMUA model dari \`opencode models\` diambil + diaktifkan di"
echo "       OPENCODE_MODELS (provider opencode; sudah login = semua tersedia,"
echo "       belum login = hanya free) + OPENCODE_GO_MODELS (provider"
echo "       opencode-go: sudah login = semua, belum login = KOSONG sehingga"
echo "       grup Go disembunyikan); tombol pemilih model di /workspace"
echo "       (dua grup + varian thinking per model)"
echo "       (tampilan sama dengan chat classic) memilih di antaranya"
echo "       (GET/POST /api/agent/models, tersimpan di"
echo "       data/agent-driver-model.json dan dipakai run berikutnya TANPA restart;"
echo "       hanya berlaku saat driver tier-3 CLI free, tier ber-key tak dibajak)."
echo "    Driver agen (slot agent openmaic.yml): tier ber-key via HTTP"
echo "    (openai-completions/responses); tier-3 gratis via driver khusus CLI"
echo "    (opencode-cli, tanpa key, envelope tool_calls). Slot agent tanpa"
echo "    model membuat agent runtime menolak start dengan pesan yang jelas."
echo "  - Agent runtime + workbench butuh Postgres ${PG_MAJOR} (--with-postgres; semua tier, termasuk tier-3 CLI)."
echo "  - Performa: PARALLEL_SCENE_CONCURRENCY=5 (scene paralel, maks kode 10;"
echo "    turunkan bila kena 429, naikkan s.d. 10 di server besar) + ffmpeg apt"
echo "    default terinstal (lewati via --no-ffmpeg). TTS tanpa pacing"
echo "    (default kode: interval 0) dan asset collector auto-aktif bila ada DB."
echo "  - TTS tanpa API key: browser-native (Web Speech API) default ON"
echo "    (TTS_BROWSER_NATIVE_ENABLED=true di .env.local + default client ON,"
echo "    fresh install langsung bersuara; matikan via --no-browser-tts bila"
echo "    ingin mewajibkan provider TTS ber-key seperti OpenAI/MiniMax)."
echo "  - Ekstraksi material audio/video lokal: ffmpeg (default ON)."
echo "  - pgAdmin4 web (hanya dengan --with-pgadmin): http://localhost/pgadmin4"
echo "    login awal = PGADMIN_EMAIL/PGADMIN_PASSWORD di .env.local (ambil:"
echo "    grep '^PGADMIN_' .env.local). Tambah server: Host localhost,"
echo "    Port <lihat DATABASE_URL>, user openmaic + password Postgres Anda."
echo "  - Video MP4 butuh: docker compose --profile video-export up (berat: Chromium+FFmpeg)."
echo "  - e2e: pnpm exec playwright install --with-deps chromium && pnpm test:e2e"
echo "  - Install ulang aman (idempoten): password Postgres dipakai ulang dari .env.local,"
echo "    kecuali dipaksa via --pg-password/PG_PASSWORD."
