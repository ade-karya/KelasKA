#!/usr/bin/env bash
# Pembungkus install.sh untuk runtime Google Colab.
# Jalankan dari root repo yang sudah di-clone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# --colab = build produksi + PM2 + seluruh feature flag aplikasi, tanpa
# Docker/SearXNG/Lemonade. Jangan digabung dengan --dev (sama-sama port 3000).
exec bash install.sh --colab "$@"
