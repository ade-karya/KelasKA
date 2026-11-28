#!/usr/bin/env bash
# Start (or reuse) the GPU worker from the CPU app session's shell.
#
# The CPU session only needs an outbound HTTPS request: Vercel's /api/wake
# function pushes deploy/kaggle/kelaska-vercel-kernel.py to a separate GPU
# kernel (KELASKA_MODE=gpu-worker) and starts it with SAVE_AND_RUN_ALL. The
# CPU app keeps serving api.kelaska.riau.ai; the worker publishes
# gpu.kelaska.riau.ai. No second Next app and no extra DB pool.
set -euo pipefail

WAKE_URL="${KELASKA_WAKE_URL:-https://kelaska-ui.vercel.app/api/wake}"
KERNEL_REF="${KAGGLE_GPU_KERNEL_REF:-akjdev/kelaska-gpu-worker}"

echo "[gpu] requesting worker via $WAKE_URL"
response="$(curl -fsS -m 60 -X POST -H 'content-type: application/json' \
  -d '{"gpu": true}' "$WAKE_URL")"
echo "[gpu] $response"

if command -v kaggle >/dev/null 2>&1; then
  for _ in $(seq 1 30); do
    status="$(kaggle kernels status "$KERNEL_REF" 2>/dev/null | tail -1 || true)"
    echo "[gpu] $status"
    case "$status" in
      *RUNNING*) echo "[gpu] worker is up at https://gpu.kelaska.riau.ai"; exit 0 ;;
      *ERROR*) echo "[gpu] worker failed; check $response" >&2; exit 1 ;;
    esac
    sleep 20
  done
  echo "[gpu] still starting; poll: kaggle kernels status $KERNEL_REF" >&2
fi
