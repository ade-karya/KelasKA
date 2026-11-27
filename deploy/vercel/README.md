# Deploy ke Vercel (Hobby) — SPA statis + satu function

Vercel **tidak bisa** menjalankan aplikasi Next.js penuh di paket Hobby:
deployment ditolak dengan `exceeded_serverless_functions_per_deployment` karena
app punya ~126 route, sementara Hobby hanya mengizinkan **12 Serverless Function** per
deployment. Build-nya berhasil, tapi tahap deploy gagal.

Jadi Vercel menjalankan:

- `deploy/spa` — static export (0 function) untuk seluruh halaman UI, dan
- **satu** function catch-all `deploy/spa/api/[[...path]].ts` yang:
  - `POST /api/kaggle/wake` memanggil Kaggle API untuk menjalankan kernel
    `deploy/kaggle` (pemicu worker on-demand),
  - semua `/api/*` lain diteruskan (streaming, termasuk SSE) ke
    `SPLIT_BACKEND_ORIGIN` — deployments Cloudflare Worker yang sudah ada —
    dengan cookie diteruskan dan `Domain=` pada `Set-Cookie` dihapus supaya
    cookie tetap host-only di `kelas.riau.ai`.

Halaman "Buat Kelas dari Materi" memanggil `/api/kaggle/wake` sebelum
mengantre run. Kernel Kaggleboot dalam beberapa menit, mengklaim run dari
PostgreSQL yang sama, lalu berhenti sendiri saat antrean kosong.

## Konfigurasi project

```
Root Directory   : deploy/spa
Framework        : Other
Install Command  : npm install
Build Command    : npm run build
Output Directory : out
Production Branch: deploy/vercel
Domain           : kelas.riau.ai (CNAME -> cname.vercel-dns.com di Cloudflare)
```

Env production yang dipakai function:

```
SPLIT_BACKEND_ORIGIN=https://kelaska.riau.ai
KAGGLE_USERNAME=<username kaggle>
KAGGLE_KEY=<kaggle.json key atau KGAT_...>
KAGGLE_KERNEL_REF=akjdev/kelaska-worker
KAGGLE_SESSION_TIMEOUT_SECONDS=14400
```

Sekali lagi: `api/` harus tetap satu file. Menambah route handler di
`deploy/spa/app/api` tidak akan ikut ke static export dan akan menambah
function — keduanya merusak deployment Hobby.

## Urutan kerja

1. Pastikan worker Kaggle sudah disiapkan (baca [`../kaggle/README.md`](../kaggle/README.md)):
   secret `KELASKA_ENV_B64` terpasang di Kaggle Secrets.
2. Deploy branch `deploy/vercel`; tambahkan domain `kelas.riau.ai` di project
   Vercel, lalu CNAME di Cloudflare.
3. Buka `https://kelas.riau.ai/api/health` — harus diteruskan ke backend dan
   mengembalikan `{ "success": true, "status": "ok" }`.
4. Buat satu kelas. `POST /api/kaggle/wake` harus mengembalikan
   `{ "success": true, "started": true, ... }` (atau `started: false` bila
   kernel sudah berjalan), lalu run muncul sebagai `preparing` dan diambil
   worker Kaggle.

## Kenapa tidak memakai aplikasi penuh di Vercel

Selain batas function, Vercel tidak punya filesystem awet, runner latar
belakang, dan GPU. Itu semua sudah ada di [`../kaggle/README.md`](../kaggle/README.md).
Kode seam `lib/config/deploy-target.ts` dan trigger untuk aplikasi penuh tetap
dipertahankan di branch ini untuk deployment self-hosted / Cloudflare
Containers; keduanya tidak dipakai oleh build `deploy/spa`.
