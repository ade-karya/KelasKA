# Vercel (UI + light APIs)

The public site is a Cloudflare Worker in front of two origins. Vercel serves
the UI and the APIs that are cheap, short-lived and needed before any backend
is awake (auth, accounts, folders, library, model settings, `/api/health`).
The Worker sends heavy routes to the Colab app behind `api.kelaska.riau.ai`.

## Project setup

1. Import `ade-karya/KelasKA` into Vercel as a **Next.js** project. The repo's
   standalone output (`next.config.ts`) is fine; Vercel ignores the standalone
   server and builds its own functions from the same source.
2. Set the production domain to `kelaska.vercel.app` (or a stable
   `kelaska-app.vercel.app` alias) and copy it into the Worker's
   `VERCEL_ORIGIN`. It must not be the public `kelaska.riau.ai` hostname, or
   requests would loop through the Worker again.
3. Add **all** of `.env.local` as Vercel environment variables. The sensitive
   ones (database URL, Supabase keys, `GOOGLE_API_KEY`, HF S3 credentials,
   `OPENMAIC_SECRET_KEY`) go into Vercel Encrypted Environment Variables, not
   the repo. `AUTH_PUBLIC_URL` must be `https://kelaska.riau.ai`.
4. `openmaic.yml` is git-ignored, so Vercel will not have it. Provide a
   sanitized copy as a build-time file: base64-encode the deployment config
   (the Colab template in `deploy/colab/openmaic.colab.yml` is a good starting
   point but Vercel needs no local GPU URLs), store it as the secret
   `OPENMAIC_YML_B64`, and write it in `package.json`'s `postinstall` or use a
   Vercel build command such as:

   ```bash
   node -e "require('fs').writeFileSync('openmaic.yml', Buffer.from(process.env.OPENMAIC_YML_B64,'base64'))" && bun run build
   ```

   Keep `${GOOGLE_API_KEY}` in the file; the app expands it from the
   environment. Never commit the real config.

## What stays on Vercel

`deploy/cloudflare-worker/src/routing.ts` is the authoritative split. Roughly:

- **Vercel**: `/`, `/classroom/*`, `/docs/*`, `/api/auth/*`, `/api/admin/*`,
  `/api/stages`, `/api/folders`, `/api/materials` (GET/DELETE),
  `/api/generate-classroom/capabilities`, `/api/health`, `/api/model-config*`.
- **Colab (`api.`)**: `/api/generation-runs`, `/api/generate/*`, `/api/chat/*`,
  `/api/agent/*`, `/api/pbl/*`, `/api/parse-pdf`, `/api/transcription`,
  material uploads and extraction, SSE streams, video rendering.

A new light route keeps working when Colab is asleep; a new heavy route is one
prefix away from being moved. The Worker forwards the browser's `cookie`
header unchanged. `kelaska_session` is host-only and `SameSite=Lax`, so the
browser sends it on same-origin `kelaska.riau.ai/api/*` calls and the Worker's
proxy preserves it.

## Constraints

- Vercel Hobby is non-commercial. This deployment is for a school project;
  if it becomes commercial, move to Pro. Function duration on Hobby is short,
  which is exactly why no generation runs here.
- Vercel's request body limit is ~4.5 MB on Hobby. Material uploads are routed
  to Colab instead; the Worker's Free plan allows bodies up to 100 MB and the
  app's default cap is 50 MB. For larger files, the planned presigned S3 flow
  bypasses both.
- The Worker must set `x-forwarded-host: kelaska.riau.ai` (it does) so any
  absolute URL the light APIs build stays on the public hostname.
