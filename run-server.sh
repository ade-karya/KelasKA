#!/bin/sh
# Wrapper PM2 untuk runtime Bun: paksa bind ke semua interface.
# PM2 tidak meng-override env var HOSTNAME (dianggap sistem), jadi set di sini
# agar server Next.js standalone mendengar di 0.0.0.0:PORT, bukan di hostname
# container (yang membuat reverse proxy mendapat Bad Gateway).
export HOSTNAME=0.0.0.0
exec "${OPENMAIC_BUN_BIN:-/usr/local/bin/bun}" "$(dirname "$0")/.next/standalone/server.js"
EOF