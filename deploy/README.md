# KelasKA split deployment

```
                       ┌───────────────────────┐
     browser ─────────▶│ Cloudflare Worker     │  kelaska.riau.ai/*
                       │ (routes + queue +     │  KV + Durable Object
                       │  Kaggle lifecycle)    │  cron every 2 min
                       └───┬───────────┬───────┘
                           │ fallback  │ all pages + APIs
                   ┌───────▼───┐   ┌───▼────────────────┐
                   │  Vercel   │   │ Cloudflare Tunnel  │  api.kelaska.riau.ai
                   │ static    │   │ → Colab Next.js app│  (manual start)
                   │ status page│  └───┬────────────────┘
                   └───────────┘       │ 127.0.0.1:8787 loopback proxy
                                       │ (adds Access service token)
                                   ┌───▼────────────────┐
                                   │ Cloudflare Tunnel  │  gpu.kelaska.riau.ai
                                   │ → Kaggle proxy     │  (2× T4, API-started)
                                   │   /comfyui /tts    │
                                   │   /asr /ollama     │
                                   └────────────────────┘
```

The browser only ever talks to `kelaska.riau.ai`. The Worker keeps the
`kelaska_session` cookie flow unchanged because the cookie is host-only and
`SameSite=Lax`; there is no CORS or cross-site auth work.

## 0. The two Google (Gmail) identities

Colab and Kaggle are each signed in with a Gmail account. They are separate
identities and their credentials are **not** interchangeable:

- **Colab**: the Gmail account that opens the notebook owns its Colab Secrets.
  The operator must be signed into that same account, or `KELASKA_ENV_B64`,
  `KELASKA_COLAB_TUNNEL_TOKEN` and the Access token will be missing. Sharing a
  notebook link does not share secrets.
- **Kaggle**: "Continue with Google" only creates the Kaggle account. The
  Worker authenticates to Kaggle with a **Kaggle API token**, not the Gmail
  password: generate one in Kaggle → Settings → API → Create New Token. Use the
  Kaggle **username** (not the Gmail address) in `KAGGLE_USERNAME`, and the
  `key` field of the downloaded `kaggle.json` as `KAGGLE_KEY`. The kernel and
  dataset must belong to that same Kaggle account, and Kaggle Secrets are read
  from it as well.
- The weekly 2× T4 quota belongs to that Kaggle account. Check it before
  promising capacity. Cloudflare Access uses service tokens only — no Gmail
  address needs to be added to an Access policy.

Never commit `kaggle.json`, a Colab `.env.local` snapshot, or an `.ipynb` with
secrets; all of them stay in the two platforms' secret stores and Worker
secrets.

## 1. DNS and hostnames

| Hostname | Target | Owner |
| --- | --- | --- |
| `kelaska.riau.ai` | proxied (orange cloud), Worker route `kelaska.riau.ai/*` | this repo's Worker |
| `api.kelaska.riau.ai` | CNAME `<tunnel-id>.cfargotunnel.com`, proxied | Colab named tunnel |
| `gpu.kelaska.riau.ai` | CNAME `<tunnel-id>.cfargotunnel.com`, proxied | Kaggle named tunnel |

Create two **named tunnels** in Cloudflare → Zero Trust → Networks → Tunnels.
Configure their public hostnames in the dashboard (token-based tunnels take
ingress rules from the dashboard, not from a local config file):

- `api.kelaska.riau.ai` → HTTP `localhost:3000`
- `gpu.kelaska.riau.ai` → HTTP `localhost:8790`

Do **not** add `kelaska.riau.ai` to either tunnel. The Worker route owns that
hostname and takes precedence over the tunnel, so an app published there is
shadowed by the Worker and the Worker's `COLAB_ORIGIN` (`api.`) never answers.
A tunnel ingress of `kelaska.riau.ai -> localhost:3000` is the symptom to look
for when `/__kelaska/status` reports `colab: offline` while the app is running.

Copy each tunnel token. They are the only credentials the two compute nodes
need to publish themselves; no dynamic URL registration is involved.

## 2. Cloudflare Access

Create an Access application covering `api.kelaska.riau.ai` and
`gpu.kelaska.riau.ai` with a single policy: **Service Auth**, allow the one
service token. Set the token's client id/secret as Worker secrets
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`, and give the same pair to
the Colab GPU proxy (`deploy/colab/gpu-proxy.mjs` reads them from the
environment). `deploy/colab/kelaska-colab.py` exports them from Colab Secrets
to `start.sh`; putting them in `.env.local` works too. Without the pair the
proxy sends no Access headers and `gpu.` answers 403 even though the tunnel is
connected. The browser never receives these headers.

## 3. Cloudflare KV + Durable Object

```bash
cd deploy/cloudflare-worker
cp wrangler.toml.example wrangler.toml
# replace REPLACE_WITH_KV_NAMESPACE_ID with:
npx wrangler kv namespace create STATE

# secrets
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
npx wrangler secret put KAGGLE_USERNAME
npx wrangler secret put KAGGLE_KEY
npx wrangler secret put EDGE_ADMIN_TOKEN
npx wrangler secret put GPU_LEASE_KEY

npx wrangler deploy
```

`wrangler.toml` is git-ignored because it holds account-specific ids. The Durable
Object `Coordinator` serializes Kaggle starts (two simultaneous generation
requests can never push two kernels) and owns the alarm that polls the session
and GPU health.

Useful endpoints:

- `GET /__kelaska/health` — the Worker itself.
- `GET /__kelaska/status` — public, non-secret health/queue for the UI banner.
- `GET /__kelaska/gpu/lease` — Kaggle keep-alive (needs `x-kelaska-gpu-key`).
- `GET /__kelaska/jobs/:id` — queued start replay (needs `x-kelaska-job-secret`).
- `POST /__kelaska/admin/{warmup,stop,clear-stop,check,state}` — bearer
  `EDGE_ADMIN_TOKEN`.

## 4. Colab (manual)

See [colab/README.md](./colab/README.md). Operator starts the cell-paste
notebook; it runs `install.sh --colab --no-gpu`, the loopback GPU proxy and the
tunnel, then keeps the tab open. The Worker marks Colab online at the next
2-minute cron (or within 15 s via a queued job's stale probe).

## 5. Kaggle (automatic)

See [kaggle/README.md](./kaggle/README.md) and
[prepare-dataset.md](./kaggle/prepare-dataset.md). The Worker pushes
`deploy/kaggle/kelaska-gpu.py` to the prepared kernel with `SaveKernel` —
`slug` is the full `owner/kernel-slug` ref from `KAGGLE_KERNEL_REF`, and
`kernelExecutionType: "SAVE_AND_RUN_ALL"` (the SDK serializes enums by name,
not by number). Kaggle Secrets hold the tunnel token and the lease key; the
model weights come from the private dataset.

The Kaggle account's API key lives only in Worker secrets. `machineShape` is
`NvidiaTeslaT4` (Kaggle's 2× T4 shape). Weekly GPU quota is limited, so the
kernel exits itself on an idle lease or after 11h40m. The Worker's
`KAGGLE_SESSION_TIMEOUT_SECONDS` is `42000` (11h40m) because the API requires a
value below Kaggle's 12 h cap; the kernel's own `MAX_RUNTIME_SECONDS` uses the
same number.

A Worker code change is **not** part of `install.sh`: deploy it with
`cd deploy/cloudflare-worker && npx wrangler deploy`. If `/__kelaska/status`
reports `kaggle.status: "error"` with `lastError: "Invalid slug: ..."`, the
Worker is sending the bare kernel slug; deploy the current Worker and call
`POST /__kelaska/admin/warmup` (bearer `EDGE_ADMIN_TOKEN`) to retry at once.
The coordinator also re-arms its alarm after a failed start, so the 2-minute
cron retries automatically once the cooldown has passed.

## 6. Vercel (Hobby)

Vercel hosts only the static offline/status page
(`deploy/vercel-status/index.html`) because the Hobby plan's 12-function cap
cannot fit this app's ~126 API routes. All pages and APIs go to Colab; when
Colab is down, document requests fall back to the Vercel status page and
generation starts are queued. See [vercel/README.md](./vercel/README.md). The
Worker's `VERCEL_ORIGIN` must be `https://kelaska.vercel.app`, never the public
hostname. Do not confuse it with `kelas-ka.riau.ai`: that is a separate
full-app deployment, not this split setup's fallback.

## Operational runbook

| Symptom | Check | Action |
| --- | --- | --- |
| Banner "backend offline" | `/__kelaska/status` → `colab.status` | Start the Colab notebook; check `tail /tmp/kelaska-cloudflared.log` |
| Generations queued but never start | `/__kelaska/status` → `queue`, `colab.status` | Colab did not come up: start it, then jobs replay automatically |
| GPU never comes online | `kaggle.status`, `kaggle.lastError` | Verify `KAGGLE_*` secrets, kernel id, dataset id and weekly quota |
| GPU online but images/TTS fail | `curl .../health` on `gpu.` → `services` | Check `logs/gpu-services.log` and `logs/{comfyui,voxcpm}.log` in the kernel |
| GPU burns quota while idle | `gpu.lastRequest`, `kaggle.desired` | `POST /__kelaska/admin/stop`, then check the kernel exited |
| Stuck stop flag on next start | `kaggle.status` = offline, desired false | `POST /__kelaska/admin/clear-stop` (bearer token) |

## CLI-first go-live

The whole go-live above has a copy-paste CLI version in
[operator-cli.md](./operator-cli.md): `vercel login` / `vercel deploy --prod`,
`wrangler login` / `wrangler deploy`, `cloudflared tunnel create` + Cloudflare
REST API for remote tunnel config and Access service tokens, and `kaggle`
CLI for the dataset/kernel. Each login opens a browser once; after that the
CLIs are non-interactive. The Kaggle API token and the two Gmail identities
are still needed as described in §0.

Both compute nodes are deliberately outside CI: Colab is operator-started and
Kaggle is API-started, so neither can be reached from a local dry run. Verify
the Worker with `npm run dry-run` and the shell scripts with `bash -n` before
deploying.
