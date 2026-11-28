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
QUEUE_LIMIT_SECONDS=60
MAX_ATTEMPTS=120

wake() {
  local response
  response="$(curl -fsS -m 60 -X POST -H 'content-type: application/json' \
    -d '{"gpu": true}' "$WAKE_URL")"
  echo "[gpu] wake: $response"
  # Vercel's function has a 5-minute cooldown between SaveKernel calls.
  if [[ "$response" == *cooldown* ]]; then sleep 30; fi
}

status_of() {
  kaggle kernels status "$KERNEL_REF" 2>/dev/null | tail -1 || true
}

echo "[gpu] requesting worker via $WAKE_URL"
wake

queued_since=""
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  status="$(status_of)"
  echo "[gpu] $status"

  case "$status" in
    *RUNNING*) echo "[gpu] worker is up at https://gpu.kelaska.riau.ai"; exit 0 ;;
    *ERROR*|*CANCEL*)
      echo "[gpu] $status; request a fresh session" >&2
      wake
      queued_since=""
      sleep 10
      ;;
    *QUEUED*)
      now="$(date +%s)"
      if [[ -z "$queued_since" ]]; then queued_since="$now"; fi
      if (( now - queued_since >= QUEUE_LIMIT_SECONDS )); then
        echo "[gpu] queued > ${QUEUE_LIMIT_SECONDS}s; starting a new session"
        wake
        queued_since=""
      fi
      ;;
  esac
  sleep 5
done

echo "[gpu] worker still not running after $MAX_ATTEMPTS checks" >&2
exit 1
