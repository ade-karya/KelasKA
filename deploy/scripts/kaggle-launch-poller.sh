#!/usr/bin/env bash
#
# Fallback GPU launcher for the split deployment.
#
# The Worker's Durable Object sets the KV flag `gpu:desired` whenever a request
# needs the Kaggle GPU box. When Kaggle's SaveKernel REST call is unavailable,
# this poller (running inside a Kaggle session with the Kaggle CLI configured)
# observes the flag and pushes the prepared kernel with `kaggle kernels push`,
# which is known to work. It never starts two kernels: it checks the live
# kernel status and a cooldown key before pushing.
set -uo pipefail

REPO_DIR="${KELASKA_REPO_DIR:-/kaggle/temp/KelasKA}"
WORKER_DIR="$REPO_DIR/deploy/cloudflare-worker"
KERNEL_REF="${KELASKA_KERNEL_REF:-akjdev/kelaska-gpu}"
POLL_SECONDS="${KELASKA_POLL_SECONDS:-30}"
COOLDOWN_SECONDS="${KELASKA_LAUNCH_COOLDOWN:-900}"

kv_get() {
  (cd "$WORKER_DIR" && npx wrangler kv key get --binding=STATE "$1" 2>/dev/null | tr -d '"' | tr -d '\n')
}
kv_put() {
  (cd "$WORKER_DIR" && npx wrangler kv key put --binding=STATE "$1" "$2" >/dev/null 2>&1)
}
log() { printf '[kaggle-launcher] %s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

log "started; watching gpu:desired every ${POLL_SECONDS}s"
while true; do
  desired="$(kv_get gpu:desired)"
  if [[ "$desired" != "1" ]]; then
    sleep "$POLL_SECONDS"
    continue
  fi

  last="$(kv_get gpu:launch:lastAt)"
  now="$(date +%s)"
  if [[ -n "$last" && "$last" =~ ^[0-9]+$ ]] && (( now - last < COOLDOWN_SECONDS )); then
    sleep "$POLL_SECONDS"
    continue
  fi

  status="$(kaggle kernels status "$KERNEL_REF" 2>/dev/null | tail -1)"
  if [[ "$status" == *RUNNING* || "$status" == *QUEUED* ]]; then
    log "kernel already $status; skipping"
    kv_put gpu:launch:lastAt "$now"
    sleep "$POLL_SECONDS"
    continue
  fi

  log "desired=1 and kernel is $status; pushing $KERNEL_REF"
  if (cd "$REPO_DIR" && kaggle kernels push -p deploy/kaggle); then
    kv_put gpu:launch:lastAt "$now"
    log "push succeeded"
  else
    log "push failed; will retry after cooldown"
  fi
  sleep "$POLL_SECONDS"
done
