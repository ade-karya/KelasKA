# Kaggle GPU node

This half of the deployment owns every GPU workload (ComfyUI/SDXL, VoxCPM2
TTS, FunASR ASR, Ollama). It is started **only by the Cloudflare Worker**, via
the Kaggle API, when a generation asks for a GPU. There is no always-on Kaggle
server.

## One-time setup

1. Create a private Kaggle dataset named `kelaska-gpu-models` with the layout in
   [prepare-dataset.md](./prepare-dataset.md). The Worker mounts it into every
   kernel run so a cold start never re-downloads ~10 GB of weights.
2. Create a private **script** kernel `ade-karya/kelaska-gpu` (or let the
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
