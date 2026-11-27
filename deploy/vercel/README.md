# Vercel (Hobby) — the static UI

The `deploy/vercel` branch builds the **whole workbench UI as a static export**
and proxies every `/api/*` call to the Kaggle compute node. Vercel has zero
Serverless Functions, which is what makes this fit the Hobby plan: the app has
~128 API routes, far past Hobby's 12-function cap.

```
 browser ──▶ Vercel (static HTML/JS, 0 functions)
                 │  pages: /, /workspace, /login, /classroom, …
                 │  /api/* ── CDN rewrite ──▶ KAGGLE_ORIGIN/api/*
                 │                              + x-kelaska-proxy-token
                 ▼
              Kaggle 2× T4  ── full Next.js app on :3000
                            ── ComfyUI / VoxCPM / FunASR on loopback
```

The browser only ever talks to the Vercel domain. The session cookie
(`kelaska_session`) is host-only, so it is set on the Vercel domain by the
proxied response and sent back on every later API call. Supabase PKCE likewise
starts and ends on the Vercel domain; only the callback route runs on Kaggle.

## One-time project setup

1. Import the repo into Vercel and select the **`deploy/vercel`** branch.
2. Leave **Root Directory** at the repository root. `vercel.json` overrides the
   framework preset (`null`), install command (`bun install`) and build command
   (`bash deploy/scripts/build-vercel-static.sh`), with `out/` as output.
3. Add the environment variables below (Production and Preview). A template is
   in [`vercel.env.example`](./vercel.env.example).
4. Add `https://<project>.vercel.app/api/auth/supabase/callback` to Supabase →
   Authentication → URL Configuration → Redirect URLs. The exact URL matters:
   the browser's `redirectTo` has no query string, and the deep link rides in a
   short-lived cookie.
5. Deploy. `vercel deploy --prod --yes` from a clean checkout of the branch.

### Environment variables

| Variable | Baked | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | build | browser Supabase client (PKCE) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build | browser Supabase client (anon/publishable key) |
| `NEXT_PUBLIC_WORKBENCH_ENABLED` | build | `true` keeps the workbench as the home; `false` selects the classic home |
| `NEXT_PUBLIC_SITE_URL` | build | canonical URL in metadata; defaults to `VERCEL_PROJECT_PRODUCTION_URL` |
| `KAGGLE_ORIGIN` | request | tunnel base URL, e.g. `https://compute.kelaska.riau.ai` (no trailing `/api`) |
| `KAGGLE_PROXY_TOKEN` | request | shared secret injected as `x-kelaska-proxy-token`; must equal the Kaggle app's `KELASKA_PROXY_TOKEN` |

`NEXT_PUBLIC_*` values are compiled into the browser bundle, so only public
values belong there. `KAGGLE_*` are read by `vercel.json` routes at request
time; after changing them, redeploy to be safe.

### What the build does

`deploy/scripts/build-vercel-static.sh` temporarily parks what a static export
cannot contain (`app/api`, `app/docs`, the two dynamic `[id]` pages, `proxy.ts`,
instrumentation, and the generation-preview layout's `force-dynamic`), then
runs the same asset sync as `bun run build` and `next build`. It restores the
tree on exit, including on failure. The parked routes have query-string
equivalents (`/classroom?id=…`, `/project-workspace?id=…`), rewritten by
`vercel.json`. Nothing is deleted from the branch.

`STATIC_UI=1` switches the app code itself: the root layout no longer calls
`cookies()`/`headers()` at render time, and the server-gated pages delegate to
client components in `components/static-ui/` that route by `/api/auth/me`.
Those gates are cosmetic — every authorization decision is still made by the
Kaggle API behind the rewrite.

## API proxy notes

- `vercel.json` uses `routes` (not `rewrites`) because only `routes` can expand
  `$KAGGLE_ORIGIN` from an environment variable at request time. That means the
  tunnel hostname can change without editing the repository.
- A `request.headers` transform **sets** `x-kelaska-proxy-token`, so a visitor
  cannot supply their own. The Kaggle app's `proxy.ts` refuses any request
  without it (except `/api/health`), which keeps the tunnel closed to direct
  traffic.
- Vercel caches external rewrite responses by default on projects created after
  2026-04-06. The `/api/*` header rule disables that (`x-vercel-enable-rewrite-caching: 0`,
  `CDN-Cache-Control: no-store`) so session and generation responses are never
  served from the CDN.
- CDN-level rewrites do not go through a Serverless Function, so the 4.5 MB
  Function body limit does not apply. Still verify a large PDF upload and an
  SSE generation stream on the first real deployment; if either is clipped,
  the upload has to move to a direct-to-Kaggle path.

## Phased go-live

1. Deploy the static UI first, with `KAGGLE_ORIGIN` pointing at a placeholder or
   an old tunnel. Confirm `/`, `/login`, `/workspace` and the client assets load
   with **zero functions** in the Vercel deployment view.
2. Start the Kaggle node from [`deploy/kaggle`](../kaggle/README.md) (the
   notebook `KelasKA-Kaggle-Deploy.ipynb` generated by
   `node deploy/kaggle/make-notebook.mjs`). Confirm
   `curl -H 'x-kelaska-proxy-token: …' https://<tunnel>/api/health` answers 200.
3. Set `KAGGLE_ORIGIN` and `KAGGLE_PROXY_TOKEN`, redeploy, then sign in with
   Google and check `/api/auth/me`, a course list, one generation start, one
   PDF upload, and classroom playback.

## Legacy SPA + single-function setup

The branch also carries the earlier `deploy/spa` + one-function setup: a thin
static SPA whose catch-all function proxies `/api/*` to the Cloudflare Worker
and wakes an on-demand Kaggle worker through `POST /api/kaggle/wake`. See
`deploy/split-deployment.md` and `deploy/worker/README.md`. That setup targets
the `kelas.riau.ai` domain and uses `deploy/spa` as the Vercel root directory. It is kept as a fallback and for the
Worker-driven topology in `deploy/README.md`; **this branch's Vercel project uses
the repository root and the full static UI described above**. Do not switch the
project to `deploy/spa` unless you also switch `KAGGLE_ORIGIN` to the Worker
origin and give up the workbench UI.

## Local verification

```bash
bun install                       # postinstall builds the workspace packages
bash deploy/scripts/build-vercel-static.sh
node_modules/.bin/tsc -p tsconfig.build.json --noEmit
bun x vitest run tests/workbench/workspace-actions.test.ts
```

The static build needs a real `node_modules` directory, not a symlink pointing
outside the checkout: Turbopack panics on such a symlink. Vercel installs a
real one.

## Legacy status page

`deploy/vercel-status/` (the old "backend offline" page) and `deploy/spa/`
(the thin 13-route SPA) are kept for the Worker-driven topology in
`deploy/README.md`. This branch does not use them; do not switch the Vercel
project's root directory to those folders.
