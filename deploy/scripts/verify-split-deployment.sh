#!/usr/bin/env bash
#
# End-to-end check of the split deployment:
#
#   Cloudflare Worker (kelaska.riau.ai) -> Colab app (api.) -> Kaggle GPU (gpu.)
#   Vercel static fallback (kelaska.vercel.app)
#
# Run from an operator machine. The api./gpu. hostnames are Access-protected,
# so pass the service token when you have it:
#
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
#     bash deploy/scripts/verify-split-deployment.sh
#
# Exit status is 0 only when the Worker, Colab app, GPU proxy and Vercel page
# all answer. A failure prints the matching operator action.
set -uo pipefail

PUBLIC="${KELASKA_PUBLIC_URL:-https://kelaska.riau.ai}"
API="${KELASKA_API_URL:-https://api.kelaska.riau.ai}"
GPU="${KELASKA_GPU_URL:-https://gpu.kelaska.riau.ai}"
VERCEL="${KELASKA_VERCEL_URL:-https://kelaska.vercel.app}"
ACCESS_ID="${CF_ACCESS_CLIENT_ID:-}"
ACCESS_SECRET="${CF_ACCESS_CLIENT_SECRET:-}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAIL=0

ok() { printf '  OK    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
bad() { printf '  FAIL  %s\n' "$*"; FAIL=1; }
headline() { printf '\n%s\n' "$*"; }

# request <body-file> <url> [curl args...] -> prints the HTTP status
request() {
  local body="$1" url="$2"
  shift 2
  curl -sS -m 20 -o "$body" -w '%{http_code}' "$@" "$url" 2>"$WORK/curl.err" || true
}

json() {
  local path="$1" file="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r ".$path" "$file" 2>/dev/null
  else
    local leaf="${path##*.}"
    sed -n "s/.*\"$leaf\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^,\"}]*\).*/\1/p" "$file" | head -1
  fi
}

access_args=()
if [[ -n "$ACCESS_ID" && -n "$ACCESS_SECRET" ]]; then
  access_args=(-H "CF-Access-Client-Id: $ACCESS_ID" -H "CF-Access-Client-Secret: $ACCESS_SECRET")
else
  warn "CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET are empty; api./gpu. will answer 403 if Access is on"
fi

headline "1. DNS"
for host in "${PUBLIC#https://}" "${API#https://}" "${GPU#https://}" "${VERCEL#https://}"; do
  host="${host%%/*}"
  if getent hosts "$host" >/dev/null 2>&1; then
    ok "$host resolves"
  else
    bad "$host does not resolve"
  fi
done

headline "2. Cloudflare Worker ($PUBLIC)"
code="$(request "$WORK/worker.json" "$PUBLIC/__kelaska/health")"
if [[ "$code" == "200" ]] && grep -q '"ok":true' "$WORK/worker.json"; then
  ok "Worker health 200"
else
  bad "Worker health answered $code (deploy it: cd deploy/cloudflare-worker && npx wrangler deploy)"
fi

code="$(request "$WORK/status.json" "$PUBLIC/__kelaska/status")"
if [[ "$code" == "200" ]]; then
  colab="$(json 'colab.status' "$WORK/status.json")"
  gpu="$(json 'gpu.status' "$WORK/status.json")"
  kaggle="$(json 'kaggle.status' "$WORK/status.json")"
  queue="$(json 'queue' "$WORK/status.json")"
  ok "Worker status: colab=$colab gpu=$gpu kaggle=$kaggle queue=$queue"
  [[ "$colab" == "online" ]] || warn "Colab is $colab: start the notebook; generation starts are queued"
  [[ "$gpu" == "online" ]] || warn "GPU is $gpu: the Kaggle kernel starts on the first GPU request"
  if [[ "$kaggle" == "error" ]]; then
    warn "Kaggle coordinator error: $(json 'kaggle.lastError' "$WORK/status.json")"
    warn "  after deploying the current Worker, POST /__kelaska/admin/warmup to retry now"
  fi
else
  bad "Worker status answered $code"
fi

headline "3. Colab app ($API)"
code="$(request "$WORK/colab.json" "$API/api/health" ${access_args[@]+"${access_args[@]}"})"
if [[ "$code" == "200" ]] && grep -q '"success":true' "$WORK/colab.json"; then
  ok "Colab app health 200"
else
  bad "Colab app health answered $code"
  if grep -qi 'handshake failure' "$WORK/curl.err"; then
    warn "TLS handshake failed: the api. tunnel has no live connection or its public hostname is missing"
    warn "  check the cloudflared log on the app node and the tunnel ingress (api. -> http://127.0.0.1:3000)"
  fi
  warn "  check: tail -f /tmp/kelaska-cloudflared.log; pm2 logs kelaska"
fi

headline "4. Kaggle GPU ($GPU)"
code="$(request "$WORK/gpu.json" "$GPU/health" ${access_args[@]+"${access_args[@]}"})"
if [[ "$code" == "200" ]] && ! grep -q '"ok":false' "$WORK/gpu.json"; then
  ok "GPU proxy health 200 ($(json 'services' "$WORK/gpu.json" 2>/dev/null || echo 'services unknown'))"
else
  bad "GPU proxy health answered $code"
  if grep -qi 'handshake failure' "$WORK/curl.err"; then
    warn "TLS handshake failed: the gpu. tunnel has no live connection or its public hostname is missing"
    warn "  check the kernel log and the tunnel ingress (gpu. -> http://127.0.0.1:8790)"
  fi
  warn "  POST $PUBLIC/__kelaska/admin/warmup (bearer EDGE_ADMIN_TOKEN) or check the Kaggle kernel log"
fi

headline "5. Vercel static fallback ($VERCEL)"
code="$(request "$WORK/vercel.html" "$VERCEL/")"
if [[ "$code" == "200" ]] && grep -q 'Menunggu Backend' "$WORK/vercel.html"; then
  ok "Vercel status page 200"
else
  bad "Vercel status page answered $code (deploy deploy/vercel-status as the project root)"
fi

headline "Result"
if [[ "$FAIL" -eq 0 ]]; then
  printf 'All split-deployment endpoints answered.\n'
else
  printf 'One or more checks failed; see the hints above.\n'
fi
exit "$FAIL"
