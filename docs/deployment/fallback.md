# Runbook fallback produksi — Vercel → Cloudflare → Kaggle/Colab

Satu checkout `deploy/hybrid` dipakai untuk semua tier. Tujuannya sederhana:
**produksi harus jalan**, boleh di platform mana pun yang tidak sedang dibatasi.
Jangan menunggu upgrade paket atau DNS selesai untuk menyalakan layanan.

> **Ringkasan hari ini (2026-11-20):** produksi yang benar-benar live dan sehat
> ada di tier 3 — aplikasi penuh di host Node `kelaska.riau.ai` (HTTP 200).
> Tier 1 (Vercel) masih **Hobby** dan tidak bisa menerima kode saat ini
> (batas 12 Serverless Functions vs ~144 route); alias `kelas-ka.riau.ai`
> melayani deployment lama `0.1.0` dari 2026-10-04. Tier 2 (Cloudflare)
> siap dipakai sebagai edge, tetapi Workers Free **tidak bisa** menjalankan
> Next.js SSR, jadi selalu butuh satu origin aplikasi penuh (tier 3 atau
> Vercel Pro).

---

## 1. Pilih tier

| # | Tier | Dipakai bila | Batasan pemicu fallback | Domain |
|---|---|---|---|---|
| 1 | **Vercel** (web tier) | Akun **Pro**, ingin UI/auth/REST/SSE serverless | Hobby: `No more than 12 Serverless Functions can be added to a Deployment` — kode ini memancarkan ~144 route. Tidak ada workaround `vercel.json`. | `kelas-ka.riau.ai` |
| 2 | **Cloudflare** (edge) | Selalu, di depan origin mana pun: DNS/TLS/WAF/cache/media/cron | Workers Free 10 ms CPU / 128 MB — SSR Next.js tidak mungkin. Hanya routing + edge function. | `api-kelas.riau.ai`, `media-kelas.riau.ai` |
| 3 | **Kaggle / Colab** (app penuh) | Tier 1 tidak tersedia, atau butuh runner/GPU/disk persisten | On-demand: operator menyalakan notebook; bukan 24/7. | `kelaska.riau.ai` via Cloudflare Tunnel |

Aturan penting:

- Selalu ada **satu origin aplikasi penuh**. Cloudflare bukan pengganti SSR;
  ia adalah lapisan edge di depan origin (tier 1 atau tier 3).
- Jangan pernah membiarkan slot media/GPU menunjuk ke backend yang gagal
  health check. Matikan slotnya (skip) — backend mati yang terkonfigurasi
  lebih berbahaya daripada slot kosong.
- Perpindahan tier tidak boleh mengubah data: Supabase adalah sumber
  kebenaran, HF S3 menyimpan media. Semua tier memakai keduanya.

---

## 2. Preflight (lakukan dulu, sebelum deploy apa pun)

```bash
# 1. Cek paket & project Vercel (butuh token CLI)
vercel whoami
vercel project ls | grep kelas-ka
# konfirmasi paket: harus "pro" untuk tier 1
TOKEN=$(python3 -c "import json;print(json.load(open('/root/.local/share/com.vercel.cli/auth.json'))['token'])")
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.vercel.com/v1/teams/<teamId> \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['billing']['plan'])"

# 2. Cek domain yang benar-benar hidup
curl -s -o /dev/null -w 'kelas-ka %{http_code}\n' https://kelas-ka.riau.ai/api/health
curl -s -o /dev/null -w 'kelaska  %{http_code}\n' https://kelaska.riau.ai/api/health

# 3. Cek versi yang dilayani (0.1.0 = deployment lama)
curl -s https://kelas-ka.riau.ai/api/health
curl -s https://kelaska.riau.ai/api/health
```

Keputusan:

- `plan = pro` **dan** ingin serverless → lanjut **tier 1**.
- `plan = hobby` → lewati tier 1, pasang **tier 2**, pakai **tier 3** sebagai origin.
- `kelaska` HTTP 200 → tier 3 sudah jalan; tidak perlu apa-apa untuk "produksi jalan".

---

## 3. Tier 1 — Vercel (web tier)

```bash
git switch deploy/hybrid
vercel link            # sekali, jika belum ter-link
vercel deploy --prod
vercel inspect kelas-ka.riau.ai      # pastikan alias menunjuk deployment baru
curl -s https://kelas-ka.riau.ai/api/health   # versi harus != 0.1.0
```

Prasyarat environment (sudah terpasang di project `kelas-ka`, Production +
Preview): `AUTH_PUBLIC_URL`, `CRON_SECRET`, `MEDIA_TOKEN_SECRET`,
`OPENMAIC_GENERATION_RUNNER_ENABLED`, `DATABASE_URL` (session pooler 5432),
`HF_S3_*`, `GOOGLE_API_KEY`. Template lengkap: `.env.vercel.example`.

Gate wajib di kode (sudah ada di branch ini):

- `OPENMAIC_GENERATION_RUNNER_ENABLED=false` → runner tidak hidup di function.
- `maxDuration = 300` pada SSE `/api/generation-runs/[id]/events`.
- `POST /api/internal/maintenance` dibebaskan dari auth gate `proxy.ts`,
  diamankan dengan header `x-kelaska-cron-secret`.

**Jika deploy gagal dengan batas 12 function:** jangan ulang-ulang. Turun ke
tier 2 + 3. Catatan: auto-deploy GitHub integration juga ikut gagal; itu
tidak merusak alias produksi yang lama.

---

## 4. Tier 2 — Cloudflare (edge)

Tiga Worker dari satu checkout:

```bash
cd cloudflare
wrangler kv namespace create KELASKA_WORKER_STATE          # sekali
wrangler deploy -c wrangler.gateway.toml
wrangler deploy -c wrangler.media.toml
wrangler deploy -c wrangler.cron.toml
```

Secret (nilainya **harus sama** dengan tier 1 / origin):

```bash
wrangler secret put MEDIA_TOKEN_SECRET -c wrangler.media.toml
wrangler secret put S3_ACCESS_KEY_ID -c wrangler.media.toml
wrangler secret put S3_SECRET_ACCESS_KEY -c wrangler.media.toml
wrangler secret put CRON_SECRET -c wrangler.cron.toml
wrangler secret put OPERATOR_WEBHOOK -c wrangler.cron.toml
```

Arahkan edge ke origin yang aktif — `ORIGIN_VERCEL` di `wrangler.gateway.toml`
dan `ALLOWED_ORIGIN` di `wrangler.{gateway,media}.toml`:

- origin tier 3 (default, live sekarang): `https://kelaska.riau.ai`
- origin tier 1 (Vercel Pro): `https://kelas-ka.riau.ai`

Verifikasi:

```bash
curl -s https://api-kelas.riau.ai/worker/status     # {"workers":"offline",...}
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://media-kelas.riau.ai/assets/contoh.png?exp=1&sig=00"   # 401
```

> Route `api-kelas.riau.ai` / `media-kelas.riau.ai` perlu DNS record di
> dashboard Cloudflare. Wrangler OAuth memberi izin Workers/KV/Routes,
> **bukan** `Zone.DNS:Edit` — jadi DNS harus ditambahkan operator.

---

## 5. Tier 3 — Kaggle / Colab (aplikasi penuh, jalur yang live)

Jalankan **dari checkout utama** `/kaggle/temp/KelasKA` (installer membaca
`.env.local` dari CWD-nya — jangan jalankan dari worktree):

```bash
cd /kaggle/temp/KelasKA
bash install.sh --colab      # semua fitur ON, production + PM2
# atau
bash install.sh --kaggle     # default upstream, produksi + PM2
```

Detail penting:

- `--colab` = production build + PM2 preset + feature flags ON (workbench
  tetap opt-in). `--kaggle` = produksi tanpa forced flags. Keduanya membuild
  standalone dan menyalin aset sebelum restart PM2.
- Tanpa NVIDIA GPU, installer mematikan endpoint provider lokal dan slot
  media harus menunjuk ke `browser-native-tts`, bukan VoxCPM mati.
- Restart yang menyentuh `.env.local` butuh
  `HOSTNAME=0.0.0.0 pm2 restart ecosystem.bun.config.cjs --update-env`.
- Tunnel dijalankan operator bersama notebook (`colab.riau.ai` →
  LangGraph, `gpu.riau.ai` → ComfyUI); matikan saat sesi selesai.

Verifikasi:

```bash
curl -s https://kelaska.riau.ai/api/health     # 200, version kode saat ini
pm2 logs kelaska --lines 30
```

---

## 6. Kontrak bersama (jangan diubah per tier)

| Variabel | Dipakai di | Fungsi |
|---|---|---|
| `CRON_SECRET` | Vercel + cron Worker | Auth `x-kelaska-cron-secret` untuk `/api/internal/maintenance` |
| `MEDIA_TOKEN_SECRET` | Vercel + media Worker | Tanda tangan token `exp\|path` untuk HF S3 |
| `AUTH_PUBLIC_URL` | Vercel | Origin redirect Supabase yang benar (`kelas-ka.riau.ai` / `kelaska.riau.ai`) |
| `OPENMAIC_GENERATION_RUNNER_ENABLED` | Vercel | `false` di serverless, `true` di host Node |
| `DATABASE_URL` | semua | Supabase **session pooler 5432** (LISTEN/NOTIFY), bukan 6543 |
| `HF_S3_*` | semua | Byte store media + backup; `ASSET_BYTE_EGRESS=redirect` |

Perlakuan hostname (jangan di-bulk-rename):

- `kelas-ka.riau.ai` — alias Vercel (UI).
- `kelaska.riau.ai` — host Node produksi saat ini (origin aplikasi penuh).
- `api-kelas.riau.ai`, `media-kelas.riau.ai`, `docs.kelas.riau.ai` — hostname
  terpisah untuk edge dan docs; bukan entry point UI.

---

## 7. Berpindah tier (cutover)

1. **Vercel → Node host:** jalankan tier 3, lalu arahkan
   `ORIGIN_VERCEL`/`ALLOWED_ORIGIN` di Cloudflare ke `kelaska.riau.ai`,
   set `AUTH_PUBLIC_URL` sesuai host, restart PM2 dengan `--update-env`.
   Alias Vercel boleh dibiarkan (masih melayani deployment lama).
2. **Node host → Vercel Pro:** upgrade paket, `vercel deploy --prod`,
   verifikasi `/api/health` tidak lagi `0.1.0`, lalu arahkan edge ke
   `kelas-ka.riau.ai` dan matikan runner (`OPENMAIC_GENERATION_RUNNER_ENABLED=false`).
3. **Apa pun → Cloudflare:** deployWorker (tier 2) tidak mengubah origin;
   cukup samakan secret + `ALLOWED_ORIGIN` dengan origin aktif.

Rollback Vercel instan (`vercel rollback` / pointer alias). Rollback DB hanya
untuk migrasi aditif — selalu backup sebelum migrasi.

---

## 8. Checklist "produksi jalan"

- [ ] Satu origin aplikasi penuh menjawab `/api/health` dengan versi kode saat ini.
- [ ] `AUTH_PUBLIC_URL` cocok dengan domain yang dipakai pengguna.
- [ ] `CRON_SECRET` dan `MEDIA_TOKEN_SECRET` identik di semua tier.
- [ ] `OPENMAIC_GENERATION_RUNNER_ENABLED=false` di serverless; `true` di host Node.
- [ ] Slot media tidak menunjuk ke backend yang gagal health check.
- [ ] Cloudflare `ORIGIN_VERCEL` / `ALLOWED_ORIGIN` menunjuk ke origin aktif.
- [ ] Domain entry point yang dipakai: `kelas-ka.riau.ai` (Vercel) atau `kelaska.riau.ai` (Node).

## 9. Troubleshooting cepat

| Gejala | Penyebab | Tindakan |
|---|---|---|
| Deploy Vercel `Error` 12 functions | Akun Hobby | Turun ke tier 2 + 3; upgrade Pro bila ingin tier 1 |
| `/api/health` masih `0.1.0` | Alias menunjuk deployment lama | `vercel deploy --prod` (butuh Pro) atau pakai `kelaska.riau.ai` |
| `/worker/status` selalu offline | KV namespace beda | Samakan `id` gateway & cron |
| Media 401/403 | Secret beda / path di luar prefix | Samakan `MEDIA_TOKEN_SECRET`; prefix `assets/`, `materials/`, `exports/` |
| Narasi gagal `fetch failed` | Slot TTS ke VoxCPM mati | Set ke `browser-native-tts` di host tanpa GPU |
| Halaman 500 setelah build manual | Aset standalone tidak tersalin | Sinkan `.next/static` + `public`, restart PM2 |
