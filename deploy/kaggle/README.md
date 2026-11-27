# Kaggle — worker penuh + GPU (on-demand)

Ada dua peran Kaggle. **Peran yang dipakai sekarang** adalah worker penuh untuk
Vercel: halaman Vercel hanya SPA statis, dan function `/api/kaggle/wake`-nya
menjalankan kernel ini lewat Kaggle API. Kernel
[`worker-kernel.py`](./worker-kernel.py) meng-clone branch `deploy/kaggle`,
menjalankan `install.sh --kaggle` (aplikasi penuh + generation runner + GPU),
lalu mengklaim generation run dari `DATABASE_URL` yang sama dengan Vercel.

## Menyiapkan worker penuh

1. Buat Kaggle Secret `KELASKA_ENV_B64` — base64 dari `.env.local` produksi.
   Nilainya harus memuat `DATABASE_URL`, `OPENMAIC_SECRET_KEY`, `GOOGLE_API_KEY`,
   `HF_S3_*`, dan `WORKER_STATUS_TOKEN` yang sama dengan yang dipakai aplikasi.
   Base64 ini dibuat operator dari `.env.local` produksi dan **jangan**
   di-commit ke repo. Nilai `DATABASE_URL` port 6543 akan diganti kernel ke
   5432 untuk koneksi panjang.
2. Vercel menyimpan `KAGGLE_USERNAME`, `KAGGLE_KEY`, dan
   `KAGGLE_KERNEL_REF=akjdev/kelaska-worker`. Saat ada kelas dibuat, Vercel
   memanggil `SaveKernel` dengan `kernelExecutionType: SAVE_AND_RUN_ALL` dan
   source `worker-kernel.py` dari branch `deploy/kaggle`.
3. Kernel memilih `openmaic.yml` dari `deploy/kaggle/openmaic.yml` bila GPU
   terlihat, atau `openmaic.cpu.yml` bila tidak. Slot media tidak pernah
   diarahkan ke endpoint yang tidak lolos health check.
4. Setelah `install.sh` selesai, kernel menunggu `/api/health`, lalu polling
   `/api/worker/status` dengan `WORKER_STATUS_TOKEN`. Bila tidak ada run
   `claimable`/`active` selama 10 menit, kernel keluar dan kuota GPU berhenti.

Verifikasi: `POST https://kelas.riau.ai/api/kaggle/wake` →
`{ "success": true, "started": true }`, lalu log kernel menampilkan
`[GenerationRunner] claimed`.

### Menjalankan manual dari notebook

Tanpa pemicu Vercel, worker yang sama bisa dijalankan langsung:

```python
!git clone --depth 1 --branch deploy/kaggle https://github.com/ade-karya/KelasKA.git /kaggle/temp/KelasKA
%cd /kaggle/temp/KelasKA
!bash deploy/kaggle/run.sh
```

Isi `.env.local` lebih dulu dari
[`../shared/env.worker.example`](../shared/env.worker.example) — terutama
`DATABASE_URL`, `OPENMAIC_SECRET_KEY`, `HF_S3_*`, `GOOGLE_API_KEY`, dan
`OPENMAIC_AGENT_RUNTIME_ENABLED=true`. Nilai `DATABASE_URL` dan
`OPENMAIC_SECRET_KEY` **harus sama persis** dengan Vercel.

## Kaggle GPU node (mode split lama)

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
