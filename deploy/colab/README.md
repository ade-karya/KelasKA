# Colab app node (manual start)

Colab runs the **full Next.js app** and publishes it at
`api.kelaska.riau.ai` through a named Cloudflare Tunnel. It does not run any
GPU service — those live on Kaggle and are reached through the loopback proxy
with Cloudflare Access headers.

## The Gmail account

Colab Secrets are stored **per Google account**. Start the notebook while
signed into the Gmail account that owns them; another account opening the same
link sees an empty secret list and the startup script stops with a clear
message. If two operators need to start the app, either share that one Google
account deliberately or provision the same secrets in each operator's account.
The Colab runtime can stay on CPU — the GPU belongs to Kaggle.

## One-time setup

1. In Colab → Secrets (key icon), add:
   - `KELASKA_ENV_B64` — base64 of the production `.env.local` (the same values
     Vercel uses). Generate with `base64 -w0 .env.local`.
   - `KELASKA_COLAB_TUNNEL_TOKEN` — token of the named tunnel whose public
     hostname `api.kelaska.riau.ai` routes to `localhost:3000`.
   - `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` — the Access service
     token used by the loopback GPU proxy.
   - Optional: `KELASKA_OPENMAIC_YML_B64` — base64 of a full `openmaic.yml`.
     Without it, `openmaic.colab.yml` in this directory is used, whose GPU base
     URLs point at `http://127.0.0.1:8787/...`.
2. Use a **CPU** runtime. The Colab GPU is not needed and only shortens the
   idle timeout.
3. Make sure `AUTH_PUBLIC_URL=https://kelaska.riau.ai` is in the encoded env:
   the notebook adds it if absent, because the app otherwise builds sign-in
   redirects from PM2's internal `0.0.0.0:3000`.

## Starting

Paste `kelaska-colab.py` into a Colab notebook (its `# %%` markers make it a
valid notebook when imported with `--to notebook` too, but the file itself is
plain Python and is committed — notebooks with secrets never are). Run all
cells. The script:

1. clones/checks out the `Colab` branch into `/content/KelasKA`,
2. writes `.env.local` and `openmaic.yml` from Secrets,
3. runs `install.sh --colab --no-gpu` once per runtime (a fresh build is
   10–15 min on Colab's 2 vCPU),
4. starts `gpu-proxy.mjs` on `127.0.0.1:8787`, the tunnel, and PM2,
5. checks the local `/api/health` and prints where the logs are.

Keep the tab open. Closing it, or the Colab idle timeout, stops the app; the
Worker then marks Colab offline and queues generation starts. The next run of
the notebook replays them with the submitting user's session cookie.

## Files

- `kelaska-colab.py` — cell-marked startup script (the "notebook").
- `start.sh` — idempotent proxy/tunnel/PM2 launcher.
- `gpu-proxy.mjs` — Node loopback reverse proxy; maps
  `/comfyui`, `/asr`, `/tts`, `/ollama` to the Access-protected `gpu.` tunnel.
- `openmaic.colab.yml` — sanitized model config using the loopback URLs.

## Troubleshooting

```bash
tail -f /tmp/kelaska-cloudflared.log     # tunnel connect / ingress errors
tail -f /tmp/kelaska-gpu-proxy.log       # forwarding errors, 502s
pm2 logs kelaska                         # app / generation engine
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8787/health    # -> gpu tunnel health
```

A fresh runtime rebuilds the app. `KELASKA_REINSTALL=1` forces a rebuild on a
warm one. Do not run `bun run build` manually while PM2 serves
`.next/standalone`; `install.sh` stops PM2 around the build and re-syncs static
assets for you.
