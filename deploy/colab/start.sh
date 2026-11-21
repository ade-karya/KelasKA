#!/usr/bin/env bash
#
# Start the Colab half of the deployment after `install.sh --colab` has built
# the app once:
#
#   - the loopback GPU proxy (the app calls Kaggle through Cloudflare Access),
#   - the Cloudflare Tunnel that publishes the app at api.kelaska.riau.ai,
#   - PM2 for the Next.js server.
#
# The notebook calls this script. It is idempotent: running it again reloads
# PM2 and leaves the tunnel/proxy alone if their PID files are alive.
set -euo pipefail

APP_DIR="${KELASKA_APP_DIR:-/content/KelasKA}"
cd "$APP_DIR"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

: "${KELASKA_COLAB_TUNNEL_TOKEN:?Set KELASKA_COLAB_TUNNEL_TOKEN (Cloudflare Tunnel token) first.}"
export KELASKA_GPU_ORIGIN="${KELASKA_GPU_ORIGIN:-https://gpu.kelaska.riau.ai}"
export KELASKA_GPU_PROXY_PORT="${KELASKA_GPU_PROXY_PORT:-8787}"

PID_DIR="${KELASKA_PID_DIR:-/tmp}"
PROXY_PID="$PID_DIR/kelaska-gpu-proxy.pid"
TUNNEL_PID="$PID_DIR/kelaska-cloudflared.pid"
PROXY_LOG="$PID_DIR/kelaska-gpu-proxy.log"
TUNNEL_LOG="$PID_DIR/kelaska-cloudflared.log"

alive() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_proxy() {
  if alive "$PROXY_PID"; then
    echo "[colab] GPU proxy already running (PID $(cat "$PROXY_PID"))"
    return
  fi
  local runtime
  if command -v node >/dev/null 2>&1; then
    runtime=node
  elif command -v bun >/dev/null 2>&1; then
    runtime=bun
  else
    echo "[colab] neither node nor bun is available for the GPU proxy" >&2
    return 1
  fi
  : >"$PROXY_LOG"
  nohup "$runtime" deploy/colab/gpu-proxy.mjs >>"$PROXY_LOG" 2>&1 </dev/null &
  echo $! >"$PROXY_PID"
  sleep 1
  if ! alive "$PROXY_PID"; then
    echo "[colab] GPU proxy failed to start; see $PROXY_LOG" >&2
    tail -n 40 "$PROXY_LOG" >&2 || true
    return 1
  fi
  echo "[colab] GPU proxy started (PID $(cat "$PROXY_PID"), log $PROXY_LOG)"
}

install_cloudflared() {
  command -v cloudflared >/dev/null 2>&1 && return 0
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "[colab] unsupported architecture for cloudflared: $arch" >&2; return 1 ;;
  esac
  local target=/usr/local/bin/cloudflared
  echo "[colab] downloading cloudflared ($arch)..."
  if [[ -w /usr/local/bin ]]; then
    curl -fsSL --retry 3 "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" -o "$target"
    chmod 0755 "$target"
  else
    curl -fsSL --retry 3 "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" -o /tmp/cloudflared
    chmod 0755 /tmp/cloudflared
    sudo install -m 0755 /tmp/cloudflared "$target"
  fi
}

start_tunnel() {
  if alive "$TUNNEL_PID"; then
    echo "[colab] cloudflared already running (PID $(cat "$TUNNEL_PID"))"
    return
  fi
  install_cloudflared
  : >"$TUNNEL_LOG"
  nohup cloudflared tunnel --no-autoupdate run --token "$KELASKA_COLAB_TUNNEL_TOKEN" \
    >>"$TUNNEL_LOG" 2>&1 </dev/null &
  echo $! >"$TUNNEL_PID"
  sleep 2
  if ! alive "$TUNNEL_PID"; then
    echo "[colab] cloudflared failed to start; see $TUNNEL_LOG" >&2
    tail -n 60 "$TUNNEL_LOG" >&2 || true
    return 1
  fi
  echo "[colab] cloudflared started (PID $(cat "$TUNNEL_PID"), log $TUNNEL_LOG)"
}

start_app() {
  if command -v pm2 >/dev/null 2>&1; then
    pm2 startOrReload ecosystem.bun.config.cjs --update-env
    pm2 save >/dev/null 2>&1 || true
    echo "[colab] PM2 process 'kelaska' reloaded"
  elif [[ -x ./run-server.sh ]]; then
    echo "[colab] PM2 not found; starting run-server.sh in the background"
    nohup ./run-server.sh >>"$PID_DIR/kelaska-app.log" 2>&1 </dev/null &
    echo $! >"$PID_DIR/kelaska-app.pid"
  else
    echo "[colab] no PM2 and no run-server.sh; start the app manually" >&2
    return 1
  fi
}

start_proxy
start_tunnel
start_app

echo "[colab] waiting for the app health endpoint..."
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[colab] app is healthy at http://127.0.0.1:3000"
    break
  fi
  sleep 2
done

cat <<EOF

[colab] Public endpoints:
  app     https://kelaska.riau.ai       (Worker -> Vercel + this app)
  api     https://api.kelaska.riau.ai   (this tunnel, Access-protected)
  gpu     https://gpu.kelaska.riau.ai   (Kaggle tunnel, Access-protected)

[colab] Logs:
  app      pm2 logs kelaska
  tunnel   tail -f $TUNNEL_LOG
  proxy    tail -f $PROXY_LOG
EOF
