# Vercel (Hobby) — static offline/status page only

This app has ~126 API routes, but Vercel's **Hobby** plan allows at most 12
Serverless Functions per deployment. Building the full Next.js app on Hobby
therefore fails at deploy time. The deployment uses Vercel for one thing only:
a static page served when the Colab app is offline.

- Project: `adekarya-projects/kelaska`
- Production URL: `https://kelaska.vercel.app`
- Root Directory: `deploy/vercel-status`
- Framework: none (plain static HTML), install/build commands: auto
- Functions in deployment: 0

`index.html` fetches `/__kelaska/status` from the Cloudflare Worker and shows
Colab/GPU/queue state. The Worker's own endpoint is intercepted before any
origin, so the static page can read it same-origin.

## Routing implication

`deploy/cloudflare-worker/src/routing.ts` sends **every** non-`__kelaska`
request to the full app on `api.kelaska.riau.ai` (Colab). When Colab is
offline:

- browser page requests (`Accept: text/html`) are proxied to this static page;
- generation starts are parked in the Worker's KV queue and replayed with the
  browser's session cookie when Colab returns;
- API calls get a small JSON `BACKEND_OFFLINE` response.

If the site ever moves to Vercel Pro, the full Next.js build can be restored;
until then do not remove `deploy/vercel-status` or set a root `vercel.json`
build command.

## CLI notes

```bash
vercel project update kelaska --root-directory deploy/vercel-status \
  --auto-detect build-command --auto-detect install-command \
  --framework other -y
vercel deploy --prod --yes
```
