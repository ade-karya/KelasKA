#!/bin/bash
# Wajib dijalankan setiap selesai `pnpm build` SEBELUM (re)start service:
# standalone server.js hanya me-serve /_next/static dari
# .next/standalone/.next/static (di-resolve saat STARTUP — copy setelah
# start tidak mempan tanpa restart). Tanpa ini semua <script> 404 dan
# halaman putih (insiden 2026-09-20).
set -euo pipefail
APP_DIR="${APP_DIR:-/content/KelasKA}"
cd "$APP_DIR"
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
if ! compgen -G ".next/standalone/.next/static/chunks/*.js" > /dev/null; then
  echo "sync gagal: chunks kosong"
  exit 1
fi
echo "standalone static OK: $(du -sh .next/standalone/.next/static | cut -f1)"
