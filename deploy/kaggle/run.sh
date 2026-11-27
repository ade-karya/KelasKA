#!/usr/bin/env bash
# Pembungkus install.sh untuk notebook Kaggle.
# Jalankan dari root repo yang sudah di-clone ke /kaggle/temp/KelasKA.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# /kaggle/working adalah folder output notebook (20 GB) dan akan ikut tersimpan
# saat "Save Version". Bobot model diletakkan di /kaggle/temp agar tidak ikut.
exec bash install.sh --kaggle --gpu-dir=/kaggle/temp/gpu-models "$@"
