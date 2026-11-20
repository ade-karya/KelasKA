# Deploy web tier ke Vercel (`deploy/hybrid`)

Dokumen ini menjelaskan tier Vercel dari arsitektur produksi on-demand di
`docs/prd/PRD-produksi-kelaska-2026.md`. Jalankan dari branch gabungan
`deploy/hybrid` — satu checkout yang juga berisi Worker Cloudflare dan jalur
Kaggle/Colab. Vercel hanya menjalankan UI, auth callback, REST API, dan
SSE/polling. Generation runner dan media worker berjalan di Colab/Kaggle saat
operator menyalakan notebook.

> **Fallback:** bila paket masih Hobby (batas 12 function), lewati tier ini
> dan pakai Cloudflare + host Node di `kelaska.riau.ai`. Lihat
> `docs/deployment/fallback.md` untuk urutan lengkap Vercel → Cloudflare →
> Kaggle/Colab.

> **Status 2026-11-20:** alias `kelas-ka.riau.ai` masih melayani deployment
> produksi `0.1.0` dari 2026-10-04 (1 function). Setiap deploy dari branch ini
> berujung `Error` karena project `adekarya-projects` masih memakai paket
> **Hobby** (batas 12 Serverless Functions, sementara kode ini memancarkan
> ~144 route). Upgrade ke **Pro** adalah prasyarat sebelum `vercel deploy
> --prod`; env vars arsitektur on-demand sudah terpasang untuk Production
> maupun Preview.

## Prasyarat

- Project Vercel dengan framework Next.js dan region `sin1`.
- Node 24 (dari `engines.node`), Bun 1.3+.
- Supabase dengan session pooler (port **5432**) dan worker role terpisah.
- HF S3 bucket privat + token dengan akses `s3:ListBucket`.
- Cloudflare zone `riau.ai` sudah mengarahkan `kelas-ka.riau.ai` ke Vercel.

## Variabel penting

Salin `.env.vercel.example` ke Environment Variables. Yang paling kritikal:

| Variabel | Nilai | Alasan |
|---|---|---|
| `OPENMAIC_GENERATION_RUNNER_ENABLED` | `false` | Runner proses tidak boleh hidup di function 300 s |
| `DATABASE_URL` | session pooler 5432 | `LISTEN/NOTIFY` tidak jalan di transaction 6543 |
| `AUTH_PUBLIC_URL` | `https://kelas-ka.riau.ai` | Redirect balik tidak boleh pakai origin internal |
| `ASSET_BYTE_EGRESS` | `redirect` | Media dilayani Worker media dari HF S3 |
| `CRON_SECRET` | sama dengan Worker cron | Otentikasi `/api/internal/maintenance` |
| `MEDIA_TOKEN_SECRET` | sama dengan Worker media | Tanda tangan token media |

## Deploy

```bash
git switch deploy/hybrid

# sekali
vercel link
vercel env pull .env.vercel.local

# setiap rilis
vercel deploy --prod
```

`vercel.json` memakai `installCommand: bun install --frozen-lockfile` dan
`buildCommand: bun run build`. Script `postinstall` sudah membangun workspace
packages, jadi tidak perlu perintah tambahan. Jika build kehabisan memori,
set `NODE_OPTIONS=--max-old-space-size=6144` di environment Vercel.

## Migration database

Lakukan dari CI, bukan dari cold start:

```bash
export MIGRATION_DATABASE_URL="postgres://...@....pooler.supabase.com:5432/postgres?sslmode=require"
pg_dump "$MIGRATION_DATABASE_URL" | gzip | age -r <pubkey> > backup-$(date +%F).sql.gz
bun scripts/bootstrap-db-schema.mts
```

## Verifikasi

```bash
curl -s https://kelas-ka.riau.ai/api/health
# {"success":true,"status":"ok"}

curl -s -o /dev/null -w '%{redirect_url}\n' \
  https://kelas-ka.riau.ai/api/auth/supabase/callback
# harus https://kelas-ka.riau.ai/login?error=google_failed

curl -s -X POST https://api-kelas.riau.ai/api/internal/maintenance \
  -H "x-kelaska-cron-secret: <secret>"
# {"ok":true,"dbOk":true,"queued":...,"stuck":...,"workersOnline":...}
```

Gejala yang tidak boleh muncul: log `startGenerationRunner` di Vercel,
`AUTH_PUBLIC_URL` kosong, atau media 404 karena `/api/assets` tidak redirect
ke `media-kelas.riau.ai`.

## Rollback

`vercel rollback` kembali ke deployment sebelumnya secara instan. Data tetap
di Supabase/HF S3, sehingga rollback tidak memindahkan konten. Jika dibutuhkan
rollback penuh, aktifkan lagi jalur Opsi A (PM2) dan DNS ke host lama.

## Catatan kode di branch ini

- `lib/config/feature-flags.ts`: `isGenerationRunnerEnabled()`, default `true`.
- `instrumentation.node.ts`: runner hanya start bila flag itu true.
- `app/api/generation-runs/[id]/events/route.ts`: `maxDuration = 300`.
- `proxy.ts`: `/api/internal/maintenance` dibebaskan dari auth gate pengguna.
- `app/api/internal/maintenance/route.ts`: endpoint untuk cron Cloudflare.
- `next.config.ts`: `output: 'standalone'` hanya bila bukan Vercel; menambah
  `kelas-ka.riau.ai` ke `allowedDevOrigins`.
