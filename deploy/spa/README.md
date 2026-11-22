# Static SPA shell (Vercel Hobby)

This is the **foundation** of the static UI, not the full app yet. It is a
client-only Next.js static export (`output: 'export'`) that demonstrates the
whole session seam end to end:

- Google sign-in via Supabase PKCE in the browser;
- `GET /__kelaska/status` polling (public Worker endpoint);
- **Mulai sesi** → `POST /api/session/start` (answered by the Worker, so it
  works while the app is asleep);
- **Aktifkan sesi aplikasi** → `POST /api/auth/spa/session` (answered by the
  live session app, sets an HttpOnly `kelaska_session` cookie);
- a probe button for `GET /api/stages` to verify `/api/*` really reaches the
  session;
- `/classes` — the first ported feature page: course list + create form backed
  by `GET/POST /api/stages`;
- `/classroom?id=<stageId>` — lightweight read-only player: scene list,
  prev/next, slide text and quiz questions from `GET /api/stages/:id`. Full
  narration/interactions still live in the main app.
- `/onboarding/api-key` — the BYOK gate: CAS provider save → verify → assign
  `llm`/`agent` slots, matching the main wizard's sequence.
- `/settings` — read-only model settings view (providers, key masks, slots).

Porting the remaining `force-dynamic` pages and the server root layout is still
pending.

## Build

```bash
cd deploy/spa
npm install
NODE_OPTIONS=--max-old-space-size=2048 npm run build   # → out/
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at build
time — Next bakes `NEXT_PUBLIC_*` into the static bundle. Register
`https://kelaska.riau.ai/` (the SPA root) as a Supabase Redirect URL.

Vercel project: root directory `deploy/spa`, framework Next.js, output `out/`.
There is no root `vercel.json` build command; the Worker provides all security
headers, so none are configured here (`headers()` is unsupported by static
export anyway).

## Worker prerequisites

- `STATIC_UI_ENABLED=1`
- `SESSION_APP_ORIGIN=https://app.kelaska.riau.ai`
- secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`

See `deploy/README.md` §7 and `deploy/kaggle/README.md` (APP_MODE).

## Security note

Unlike the full app, a static SPA must hold the short-lived Supabase token in
the browser until it is exchanged for the app cookie. The app cookie itself is
HttpOnly + SameSite=Lax and never readable by JavaScript. Do not put the
Supabase service-role key or `EDGE_ADMIN_TOKEN` in this bundle.
