# Kaggle GPU node

## Vercel-node mode (this branch: `deploy/kaggle`)

On the `deploy/kaggle` branch the kernel is **not** started by the Cloudflare
Worker. It is a notebook you run once: `KelasKA-Kaggle-Deploy.ipynb`, generated
from the committed plain-Python source with:

```bash
node deploy/kaggle/make-notebook.mjs     # writes ./KelasKA-Kaggle-Deploy.ipynb
```

Upload that notebook to Kaggle, switch the accelerator to **GPU T4 x2**, add the
secrets below, and run all cells. The kernel clones `deploy/kaggle`, writes
`.env.local` from `KELASKA_ENV_B64` (and merges it into the server process
environment), starts the standalone Next.js app on `:3000`, starts ComfyUI /
FunASR / VoxCPM2 through `scripts/gpu-services.sh`, and publishes the app on one
Cloudflare Tunnel:

| Kaggle Secret | Purpose |
| --- | --- |
| `KELASKA_ENV_B64` | `base64 -w0 .env.local` (Supabase, DB, Gemini, `AUTH_ENABLED`, …) |
| `KELASKA_AUTH_PUBLIC_URL` | Vercel origin — the Google callback must land here |
| `KELASKA_PROXY_TOKEN` | matches Vercel's `KAGGLE_PROXY_TOKEN`; closes the tunnel to direct traffic |
| `KELASKA_APP_TUNNEL_TOKEN` | named tunnel token (optional; otherwise a quick `trycloudflare.com` URL is printed) |
| `KELASKA_GITHUB_TOKEN` | only if `ade-karya/KelasKA` is private |
| `KELASKA_OPENMAIC_YML_B64` | optional override of `deploy/kaggle/openmaic.kaggle.yml` |

Set `KAGGLE_ORIGIN` (tunnel URL) and `KAGGLE_PROXY_TOKEN` in Vercel to finish the
link. A prebuilt app can be mounted as `<dataset>/app` via
`deploy/scripts/package-kaggle-app.sh`; without it the kernel builds in-place
(10–15 min). Logs are in `/kaggle/temp/kelaska-logs/`.

Everything below describes the **Worker-driven** kernel (`kelaska-gpu.py`) used
by the older topology on the `Colab` branch; it also remains in this branch for
reference.

## Worker-driven mode (legacy)

This half of the deployment owns every GPU workload (ComfyUI/SDXL, VoxCPM2
TTS, FunASR ASR, Ollama). It is started **only by the Cloudflare Worker**, via
the Kaggle API, when a generation asks for a GPU. There is no always-on Kaggle
server.

## The Gmail sign-in and the API token

Kaggle may be signed in with Gmail ("Continue with Google"), but the Worker
cannot use that session: it calls the Kaggle API with a **Kaggle API key**.
Generate it once in Kaggle → Settings → API → Create New Token. The downloaded
`kaggle.json` has two fields:

- `username` → the Worker secret `KAGGLE_USERNAME` (this is the Kaggle username,
  **not** the Gmail address);
- `key` → the Worker secret `KAGGLE_KEY`.

Everything below must use the same Kaggle account: the kernel slug
`KAGGLE_KERNEL_REF=<username>/kelaska-gpu`, the dataset
`KAGGLE_DATASET=<username>/kelaska-gpu-models`, the Kaggle Secrets
(`KELASKA_GPU_TUNNEL_TOKEN`, `KELASKA_GPU_LEASE_KEY`) and the weekly GPU quota.
If the weights dataset was created by a different Gmail/Kaggle account, share
it with this account or move it before going live. Delete `kaggle.json` after
copying its key into Worker secrets; do not commit it.

## One-time setup

1. Create a private Kaggle dataset named `kelaska-gpu-models` with the layout in
   [prepare-dataset.md](./prepare-dataset.md). The Worker mounts it into every
   kernel run so a cold start never re-downloads ~10 GB of weights.
2. Create a private **script** kernel `akjdev/kelaska-gpu` (or let the
   Worker's `SaveKernel` call create it on first start). `machine_shape` must be
   `NvidiaTeslaT4` — Kaggle's 2× T4 shape.
3. Create a **named Cloudflare Tunnel** for `gpu.kelaska.riau.ai`. Its public
   hostname must route to `http://127.0.0.1:8790` on the Kaggle container. The
   tunnel token goes into Kaggle Secrets as `KELASKA_GPU_TUNNEL_TOKEN`.
4. Put the same value as the Worker's `GPU_LEASE_KEY` into Kaggle Secrets as
   `KELASKA_GPU_LEASE_KEY`.
5. Protect the tunnel with a Cloudflare Access application that accepts only
   the Worker's (and Colab proxy's) service token.

Kaggle Secrets are set in **Kaggle → Account → Secrets** (or via the notebook
`UserSecretsClient.set_secret`); they are never placed in the kernel source.

## Runtime flow

`deploy/kaggle/kelaska-gpu.py` is the file the Worker pushes on every start.
It clones the repo, links the dataset into `/kaggle/temp/gpu-models`, calls
`scripts/gpu-services.sh`, starts an aiohttp reverse proxy (path routing to the
four service ports), starts `cloudflared`, then polls
`GET /__kelaska/gpu/lease` every 60 seconds. When the Worker sets
`gpu:stopRequested` or detects 30 minutes without a GPU request, the lease
answers `keepAlive: false` and the kernel exits, ending the session and
stopping the GPU quota clock. A hard 11h40m backstop prevents an orphan.

The proxy exposes:

- `/health` — `{ok, ready, services}`; the Worker's cron reads this.
- `/comfyui/*` → `127.0.0.1:8188/*`
- `/asr/*` → `127.0.0.1:8000/*`
- `/tts/*` → `127.0.0.1:8001/*`
- `/ollama/*` → `127.0.0.1:11434/*`

The Colab app reaches these through its own loopback proxy
(`deploy/colab/gpu-proxy.mjs`), which adds the Cloudflare Access service-token
headers, so `openmaic.yml` keeps plain `http://127.0.0.1:8787/...` base URLs.

## App mode (SPA backend on the same kernel)

Set `KELASKA_APP_MODE=1` on the kernel to also run the **standalone Next.js app**
on `:3000` behind a second tunnel (`app.kelaska.riau.ai` → `127.0.0.1:3000`).
That is the backend the static SPA calls through `SESSION_APP_ORIGIN`; GPU
services remain on the same 2× T4 box and are reached over loopback
(`deploy/kaggle/openmaic.kaggle.yml`).

Extra Kaggle Secrets:

- `KELASKA_APP_TUNNEL_TOKEN` — named tunnel for `app.kelaska.riau.ai`;
- `KELASKA_ENV_B64` — `base64 -w0 .env.local` from the production checkout;
- `KELASKA_OPENMAIC_YML_B64` — optional; without it the shipped
  `openmaic.kaggle.yml` is used.

The app is **not built in the kernel** (10–15 min on 2 vCPU). Build once with
the PM2 app stopped, package, and upload the folder as `app/` inside the
private model dataset:

```bash
bash install.sh --colab --no-start          # from /kaggle/temp/KelasKA
bash deploy/scripts/package-kaggle-app.sh --out /kaggle/temp/kelaska-app-artifact
# then upload /kaggle/temp/kelaska-app-artifact as <dataset>/app
kaggle datasets version -p /kaggle/temp/kelaska-app-artifact -m 'app artifact v1'
```

`KELASKA_APP_ARTIFACT_DIR` can point at a different mounted location. The
kernel copies it to `/kaggle/temp/kelaska-app`, writes `.env.local` from the
secret (adding `AUTH_PUBLIC_URL` if absent) and starts it with the bundled
`bun` (falls back to `node`). `logs/app.log` and `logs/cloudflared-app.log`
hold its output. `/health` on `gpu.` stays 503 until **both** the app and every
configured GPU service answer, so the Worker never sends the first API call to
a half-started session.

Only flip `STATIC_UI_ENABLED=1` on the Worker after this mode is verified.

## Manual smoke test

With the secrets set, run the kernel once from Kaggle's editor and watch the
log. Expected order: repo clone, service install (~10 min on a fresh kernel),
`gpu-services.env` printing `up` for each service, proxy on 8790, cloudflared
connected. Then from a machine with the Access token:

```bash
curl -H "CF-Access-Client-Id: ..." -H "CF-Access-Client-Secret: ..." \
  https://gpu.kelaska.riau.ai/health
curl -H "CF-Access-Client-Id: ..." -H "CF-Access-Client-Secret: ..." \
  https://gpu.kelaska.riau.ai/comfyui/system_stats
```

Verify `machine_shape` on the first real run: Kaggle must report two T4s in
`nvidia-smi`. `NvidiaTeslaT4` is the documented shape, but a Kaggle API change
would show up here immediately.

## GPU placement

`scripts/gpu-services.sh` pins ComfyUI to GPU 0 and Ollama + FunASR + VoxCPM to
GPU 1 (SDXL peaks ~10.4 GiB, so it must not share a card with a resident Ollama
model). Ollama and VoxCPM together can approach the 15 GiB limit of GPU 1;
they are rarely active at the same time (titles vs. narration). If OOM shows
up in `logs/voxcpm.log`, remove `ollama` from `KELASKA_GPU_SERVICES` and let
`agent.title` fall back to Gemini.
