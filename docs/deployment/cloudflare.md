# Deploy edge ke Cloudflare (`deploy/cloudflare`)

Branch ini berisi tiga Worker untuk arsitektur produksi on-demand:

| Worker | Hostname | Fungsi |
|---|---|---|
| `kelaska-gateway` | `api-kelas.riau.ai` | Routing ke Vercel dan ke worker on-demand, status worker |
| `kelaska-media` | `media-kelas.riau.ai` | Token + SigV4 + Range untuk HF S3 |
| `kelaska-cron` | cron `*/5 * * * *` | Reaper/keep-alive, status KV, notifikasi operator |

Rancangan lengkap ada di `docs/prd/PRD-produksi-kelaska-2026.md`. Worker **tidak** menjalankan SSR Next.js (Workers Free 10 ms CPU/128 MB).

## Prasyarat

- Zone `riau.ai` di akun Cloudflare, dengan `kelas.riau.ai` mengarah ke Vercel.
- `api-kelas.riau.ai` dan `media-kelas.riau.ai` belum dipakai hostname lain.
- KV namespace untuk status worker (dipakai gateway + cron).
- Token HF S3 dengan akses ke bucket privat `kelaska`.
- Endpoint `/api/internal/maintenance` dari branch `deploy/vercel` sudah live.
- Webhook notifikasi operator (WhatsApp/email/Sentry).

## 1. Buat KV namespace

```bash
wrangler kv namespace create KELASKA_WORKER_STATE
wrangler kv namespace create KELASKA_WORKER_STATE --preview
```

Salin `id` dan `preview_id` ke `wrangler.gateway.toml` **dan** `wrangler.cron.toml`. Keduanya harus memakai namespace yang sama.

## 2. Isi variabel dan secret

Edit bagian `[vars]`:

- `wrangler.gateway.toml`: `ORIGIN_VERCEL=https://kelas.riau.ai`, `ALLOWED_ORIGIN=https://kelas.riau.ai`.
- `wrangler.media.toml`: `S3_ENDPOINT=https://s3.hf.co/<namespace>`, `S3_BUCKET=kelaska`.
- `wrangler.cron.toml`: `MAINTENANCE_URL=https://api-kelas.riau.ai/api/internal/maintenance`, `KEEPALIVE_URL=https://<ref>.supabase.co/auth/v1/settings`.

Secret:

```bash
cd cloudflare
wrangler secret put MEDIA_TOKEN_SECRET -c wrangler.media.toml   # sama dengan Vercel
wrangler secret put S3_ACCESS_KEY_ID -c wrangler.media.toml
wrangler secret put S3_SECRET_ACCESS_KEY -c wrangler.media.toml
wrangler secret put CRON_SECRET -c wrangler.cron.toml           # sama dengan Vercel
wrangler secret put OPERATOR_WEBHOOK -c wrangler.cron.toml
wrangler secret put KEEPALIVE_ANON_KEY -c wrangler.cron.toml    # opsional
```

## 3. Deploy

```bash
wrangler deploy -c wrangler.gateway.toml
wrangler deploy -c wrangler.media.toml
wrangler deploy -c wrangler.cron.toml
```

Verifikasi:

```bash
curl -s https://api-kelas.riau.ai/worker/status
# {"workers":"offline","checkedAt":"..."}

curl -s -o /dev/null -w '%{http_code}\n' \
  "https://media-kelas.riau.ai/assets/contoh.png?exp=1&sig=00"
# 401

curl -s -X POST https://api-kelas.riau.ai/__cron \
  -H "x-kelaska-cron-secret: <secret>"
# Butuh secret yang sama; /__cron hanya untuk smoke test
```

## 4. DNS, Tunnel, Access

- `api-kelas.riau.ai` dan `media-kelas.riau.ai`: Worker route, proxy Cloudflare aktif.
- `colab.riau.ai` dan `gpu.riau.ai`: Cloudflare Tunnel. Salin `cloudflare/tunnel/config.yml.example` ke `~/.cloudflared/config.yml`, isi tunnel ID, dan jalankan `cloudflared tunnel run` **hanya saat notebook aktif**.
- Cloudflare Access:
  - Policy untuk `colab.riau.ai` dan `gpu.riau.ai`: email grup operator + service token.
  - Jangan beri akses siswa ke hostname operator; siswa masuk lewat `kelas.riau.ai` + Supabase Google.
  - Worker tidak membaca header `cf-access-*` untuk mengambil identitas; verifikasi terjadi di edge.

## 5. Mode on-demand

1. Permintaan buat/edit kelas, workspace, atau multimedia masuk ke Vercel → job `queued` di Supabase.
2. Cron Worker mendeteksi antrean tanpa worker aktif → kirim notifikasi ke operator.
3. Operator menyalakan notebook Colab (`course.generate`, `course.edit`) atau Kaggle (`course.media`).
4. Worker merekam heartbeat; cron menulis `online` ke KV; gateway mulai meneruskan `/worker/*`.
5. Saat notebook dimatikan, heartbeat hilang → cron menulis `offline`, gateway menjawab 503 dengan pesan jelas.

Endpoint `GET /worker/status` dipakai UI/Vercel untuk menampilkan banner "Menunggu operator/worker".

## Troubleshooting

| Gejala | Penyebab | Tindakan |
|---|---|---|
| `/worker/status` selalu offline | KV beda namespace | Samakan `id` di gateway dan cron |
| Media 401 | Token expired/secret beda | Samakan `MEDIA_TOKEN_SECRET` dengan Vercel |
| Media 403 | Path di luar prefix | Pastikan kunci `assets/`, `materials/`, `exports/` |
| Cron tidak jalan | Secret salah | Cek `wrangler secret list` + log cron |
| Worker online tapi job tidak diproses | Heartbeat >10 menit | Cek notebook worker + koneksi pooler 6543 |
| Notifikasi tidak sampai | Webhook salah | Cek `wrangler tail kelaska-cron` |

## Hubungan dengan branch lain

- `deploy/vercel` menyediakan `/api/internal/maintenance`, `CRON_SECRET`, dan `MEDIA_TOKEN_SECRET`.
- Tanpa branch Vercel, cron hanya bisa menjaga Supabase tetap aktif; status worker tidak diperbarui.
- Deploy keduanya sebelum cutover penuh dari Opsi A.
