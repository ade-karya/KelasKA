# Operator runbook — CLI only (web login, then CLI)

Everything below is done from a machine with the three CLIs. Each login opens
a browser once ("web login"); after that the CLIs keep their own credentials.
The Gmail accounts are separate: Vercel/Cloudflare use your operator Google
login, Kaggle uses its own account + API token (see `deploy/README.md` §0).

```bash
npm i -g vercel
npm i -g wrangler           # or: npx wrangler <cmd> from deploy/cloudflare-worker
# cloudflared is already installed in this environment; otherwise:
# curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
kaggle --version
jq --version                # used to parse Cloudflare/Kaggle CLI JSON
```

## Order

1. Vercel project + env + deploy.
2. Cloudflare tunnels + Access + Worker.
3. Kaggle dataset + kernel + secrets.
4. Colab notebook (operator starts it manually).
5. Only then point `kelaska.riau.ai/*` at the Worker.

---

## 1. Vercel CLI

```bash
cd /kaggle/temp/KelasKA
npx vercel login                 # browser: sign in with your Google/Gmail account
npx vercel link                  # link this directory (creates .vercel/, git-ignored)
```

Import the production environment from the existing `.env.local` (the helper
pipes values on stdin so no secret is echoed or stored in history):

```bash
bash deploy/scripts/vercel-env-import.sh .env.local
# If a name already exists: npx vercel env rm NAME production -y, then re-run.
```

`AUTH_PUBLIC_URL` must be `https://kelaska.riau.ai`. Verify with
`npx vercel env ls`.

Optional sanitized model config (the app can otherwise run on the legacy
`GOOGLE_API_KEY` / `GOOGLE_MODELS` provider):

```bash
# Edit deploy/colab/openmaic.colab.yml first: drop localhost GPU URLs for Vercel.
base64 -w0 deploy/colab/openmaic.colab.yml | vercel env add OPENMAIC_YML_B64 production
```

`vercel.json` already sets the build command that materialises it at build
time. Deploy:

```bash
npx vercel deploy --prod
npx vercel ls                    # note the deployment hostname
```

Set that hostname (not `kelaska.riau.ai`) as `VERCEL_ORIGIN` in
`deploy/cloudflare-worker/wrangler.toml` before step 2.

## 2. Cloudflare CLI (wrangler + cloudflared + REST for Access)

```bash
npx wrangler login               # browser: Cloudflare login
npx wrangler whoami
export CF_ACCOUNT_ID="$(npx wrangler whoami | grep -i 'Account ID' | head -1 | awk '{print $NF}')"
export CF_API_TOKEN='<token with Tunnel/Workers-KV/DO/Access/DNS edit permissions>'
curl -fsS https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result.status'
```

### 2a. Tunnels

`cloudflared tunnel login` performs the one-time browser authorization. The
tunnels are then created from the CLI; the public hostname mapping is written
through the REST API so the runners can stay token-based (no local config file
on Colab/Kaggle).

```bash
cloudflared tunnel login
cloudflared tunnel create kelaska-api
cloudflared tunnel create kelaska-gpu
cloudflared tunnel token kelaska-api   > /tmp/kelaska-api-token
cloudflared tunnel token kelaska-gpu   > /tmp/kelaska-gpu-token
cloudflared tunnel route dns kelaska-api api.kelaska.riau.ai
cloudflared tunnel route dns kelaska-gpu gpu.kelaska.riau.ai

API="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel"
API_ID="$(curl -fsS "$API" -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | select(.name=="kelaska-api") | .id')"
GPU_ID="$(curl -fsS "$API" -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | select(.name=="kelaska-gpu") | .id')"

curl -fsS -X PUT "$API/$API_ID/configurations" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' \
  --data '{"config":{"ingress":[{"hostname":"api.kelaska.riau.ai","service":"http://127.0.0.1:3000"},{"service":"http_status:404"}]}}' | jq '.success'

curl -fsS -X PUT "$API/$GPU_ID/configurations" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' \
  --data '{"config":{"ingress":[{"hostname":"gpu.kelaska.riau.ai","service":"http://127.0.0.1:8790"},{"service":"http_status:404"}]}}' | jq '.success'
```

The two token files are the `KELASKA_COLAB_TUNNEL_TOKEN` (Colab Secrets) and
`KELASKA_GPU_TUNNEL_TOKEN` (Kaggle Secrets).

### 2b. Access service token + apps + policies

```bash
AUTH="Authorization: Bearer $CF_API_TOKEN"
ACCESS="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access"

curl -fsS -X POST "$ACCESS/service_tokens" -H "$AUTH" -H 'Content-Type: application/json' \
  --data '{"name":"kelaska-edge","duration":"8760h"}' > /tmp/kelaska-access.json
TOKEN_ID=$(jq -r '.result.id' /tmp/kelaska-access.json)
CLIENT_ID=$(jq -r '.result.client_id' /tmp/kelaska-access.json)
CLIENT_SECRET=$(jq -r '.result.client_secret' /tmp/kelaska-access.json)

for HOSTNAME in api.kelaska.riau.ai gpu.kelaska.riau.ai; do
  APP_ID=$(curl -fsS -X POST "$ACCESS/apps" -H "$AUTH" -H 'Content-Type: application/json' \
    --data "{\"name\":\"KelasKA $HOSTNAME\",\"domain\":\"$HOSTNAME\",\"type\":\"self_hosted\",\"session_duration\":\"24h\"}" \
    | jq -r '.result.id')
  curl -fsS -X POST "$ACCESS/apps/$APP_ID/policies" -H "$AUTH" -H 'Content-Type: application/json' \
    --data "{\"name\":\"kelaska-edge-service\",\"decision\":\"non_identity\",\"include\":[{\"service_token\":{\"token_id\":\"$TOKEN_ID\"}}]}" \
    | jq '.success'
done
```

`decision: non_identity` is the API form of the **Service Auth** action, so
there is no browser login prompt. The browser never sees these headers.

### 2c. Worker

```bash
cd /kaggle/temp/KelasKA/deploy/cloudflare-worker
cp wrangler.toml.example wrangler.toml
# Set VERCEL_ORIGIN, KAGGLE_KERNEL_REF, KAGGLE_DATASET and the KV id.
npx wrangler kv namespace create STATE        # paste the id into wrangler.toml
# Replace REPLACE_WITH_KV_NAMESPACE_ID in wrangler.toml.

for PAIR in \
  "CF_ACCESS_CLIENT_ID:$CLIENT_ID" \
  "CF_ACCESS_CLIENT_SECRET:$CLIENT_SECRET" \
  "KAGGLE_USERNAME:<kaggle username>" \
  "KAGGLE_KEY:<key from kaggle.json>" \
  "EDGE_ADMIN_TOKEN:<long random token>" \
  "GPU_LEASE_KEY:<another long random token>"; do
  name="${PAIR%%:*}"; value="${PAIR#*:}"
  printf '%s' "$value" | npx wrangler secret put "$name"
done

npx wrangler deploy --dry-run
npx wrangler deploy
npx wrangler tail kelaska-edge --format pretty
```

Verify before switching the main hostname:

```bash
curl -fsS https://api.kelaska.riau.ai/api/health \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET"
```

## 3. Kaggle CLI

The Gmail login happens in the browser at kaggle.com. The CLI needs a separate
**Kaggle API token**, created in Kaggle → Settings → API → Create New Token.

```bash
mkdir -p ~/.kaggle && chmod 700 ~/.kaggle
cp ~/Downloads/kaggle.json ~/.kaggle/kaggle.json && chmod 600 ~/.kaggle/kaggle.json
KAGGLE_USER="$(jq -r .username ~/.kaggle/kaggle.json)"
kaggle config set -n username -v "$KAGGLE_USER"
kaggle config set -n key -v "$(jq -r .key ~/.kaggle/kaggle.json)"
kaggle competitions list | head -3       # proves the token works
```

Model dataset — build the staging directory first as described in
`deploy/kaggle/prepare-dataset.md`:

```bash
STAGE=/tmp/kelaska-gpu-models
kaggle datasets create -p "$STAGE" --dir-mode zip --private \
  -m 'KelasKA GPU model weights'
# Later refreshes:
kaggle datasets version -p "$STAGE" --dir-mode zip -m 'refresh weights'
```

Kernel metadata uses the default `ade-karya` owner; edit it to the actual
Kaggle username before the first push:

```bash
sed -i "s/ade-karya\\/kelaska-gpu/${KAGGLE_USER}\\/kelaska-gpu/g" deploy/kaggle/kernel-metadata.json
sed -i "s/ade-karya\\/kelaska-gpu-models/${KAGGLE_USER}\\/kelaska-gpu-models/g" deploy/kaggle/kernel-metadata.json
kaggle kernels push -p deploy/kaggle
kaggle kernels status "$KAGGLE_USER/kelaska-gpu"
kaggle kernels output "$KAGGLE_USER/kelaska-gpu" -p /tmp/kelaska-kernel-out
```

Set the Kaggle Secrets in the **web UI** once (`Account → Secrets`):
`KELASKA_GPU_TUNNEL_TOKEN` (contents of `/tmp/kelaska-gpu-token`) and
`KELASKA_GPU_LEASE_KEY` (same value as the Worker secret). There is no Kaggle
CLI command for secrets.

The Worker itself starts the kernel through the Kaggle REST API on the first
GPU-needing request. The CLI push above only creates/updates the kernel so the
Worker has something to run and so you can inspect its logs.

## 4. Colab

Start the notebook from `deploy/colab/kelaska-colab.py` while signed into the
Gmail account that owns its secrets. Put `/tmp/kelaska-api-token` into
`KELASKA_COLAB_TUNNEL_TOKEN`, plus `CF_ACCESS_CLIENT_ID` /
`CF_ACCESS_CLIENT_SECRET` from `/tmp/kelaska-access.json`. Keep the tab open.

## 5. Verification

```bash
curl -fsS https://kelaska.riau.ai/__kelaska/health
curl -fsS https://kelaska.riau.ai/__kelaska/status | jq
curl -fsS -X POST https://kelaska.riau.ai/__kelaska/admin/check \
  -H "Authorization: Bearer $EDGE_ADMIN_TOKEN" | jq
curl -fsS https://gpu.kelaska.riau.ai/health \
  -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" | jq
```

Only after all four pass, add the Worker route `kelaska.riau.ai/*` (Wrangler
already does it from `wrangler.toml` on deploy) and confirm the public site
still serves the UI.
