# Deploy ke Cloudflare (mode terbatas, lewat Containers)

Cloudflare dipakai lewat **Cloudflare Containers**: satu Worker (Durable Object)
menerima request dan meneruskannya ke kontainer yang menjalankan Dockerfile
repo yang sama seperti Docker Compose/PM2. Kontainer itu berjalan sebagai
proses Node penuh, jadi tidak kena batasan lingkungan Workers.

## Kenapa bukan Cloudflare Workers / OpenNext

Aplikasi menyimpan satu `pg.Pool` global per proses
(`lib/persistence/server-provider.ts`). Workers melarang I/O yang dimulai atas
nama request lain (`Cannot perform I/O on behalf of a different request`), dan
OpenNext juga belum bisa menjalankan worker latar belakang yang mengklaim
generation run. Memindahkan profile ini ke Workers butuh refactor pool
per-request (`maxUses: 1`) dan resource binding Hyperdrive/R2—di luar cakupan
pemecahan ini. Containers adalah jalur yang bisa dipakai sekarang.

Container berjalan dengan `OPENMAIC_DEPLOY_TARGET=cloudflare`, sehingga
`instrumentation.node.ts` tidak memulai runner. Generation run tetap dibuat di
database dan dikerjakan oleh [worker eksternal](../worker/README.md).

## Prasyarat

- Akun Cloudflare dengan akses **Containers** (fitur berbayar), `wrangler`
  `>= 3.99` (pakai `^4.166.0` di `containers/package.json`), dan Docker untuk
  build image.
- Node `>= 22.12` untuk menjalankan wrangler.
- PostgreSQL + byte store `HF_S3_*` yang juga dipakai worker.

## Langkah

1. Isi env dari [`../shared/env.serverless.example`](../shared/env.serverless.example)
   sebagai **secret** Worker, jangan ditaruh di `wrangler.jsonc`:

   ```bash
   cd deploy/cloudflare/containers
   wrangler secret put DATABASE_URL
   wrangler secret put OPENMAIC_SECRET_KEY
   wrangler secret put ACCESS_CODE            # bila memakai kode akses
   # atau, untuk akun Google: AUTH_ENABLED, AUTH_SECRET, AUTH_PUBLIC_URL,
   # AUTH_ADMIN_EMAILS, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
   wrangler secret put GOOGLE_API_KEY
   ```

   `worker.ts` meneruskan daftar kunci yang dikenal ke container. Kunci lain
   bisa dimasukkan lewat satu secret JSON `KELASKA_EXTRA_ENV`.

2. Deploy:

   ```bash
   ./deploy.sh                 # dari direktori ini, atau lewat path penuh
   ./deploy.sh --env staging   # argumen diteruskan ke wrangler
   ```

   Skrip ini memasang dependensinya sendiri, mengetik-cek `worker.ts`, lalu
   `wrangler deploy`. Build Dockerfile pertama bisa memakan 10–15 menit karena
   repo membangun paket workspace dan menjalankan `next build`.

3. Pasang custom domain / route di Cloudflare dan arahkan ke Worker
   `kelaska`. Semua path diteruskan ke container; tidak ada routing khusus.

4. Nyalakan worker eksternal dengan `DATABASE_URL` dan `OPENMAIC_SECRET_KEY`
   yang **sama persis**.

## Detail konfigurasi

- `containers[].image` dan `image_build_context` di `wrangler.jsonc` menunjuk
  ke `Dockerfile` dan root repo (tiga level di atas file config). Jika
  wrangler di akun Anda menolak path relatif, build image sendiri lalu
  `docker push` ke registry dan ganti `image` dengan referensi registry itu.
- `instance_type: "standard-2"` = 1 vCPU / 6 GiB / 12 GB. Build butuh ~1 GiB
  heap; naikkan ke `standard-3` bila build atau runtime kehabisan memori.
- Kebijakan penjadwalan `default` dipakai agar helper `Container` menyalakan
  image otomatis. Cloudflare menandainya deprecated; migrasi ke
  `durable_object` bisa dilakukan belakangan dengan memanggil `start()` dari
  kode Durable Object.
- `sleepAfter = '2h'` dimulai ulang setiap request. Container tidak punya GPU
  dan disk episodik; media/GPU tetap diarahkan ke cloud provider atau ke host
  worker.
- `pingEndpoint = '/api/health'` memakai respons publik `{success,status}`
  yang memang 200 tanpa cookie.

## Penting: target saat build vs saat runtime

Jangan menyetel `OPENMAIC_DEPLOY_TARGET=cloudflare` sebagai **build arg/env
Docker**. `next.config.ts` akan menghilangkan `output: 'standalone'`, sehingga
`COPY .next/standalone` di Dockerfile gagal. Nilai itu disuntikkan oleh
`worker.ts` lewat `envVars` saat container **start**.

## Verifikasi

```bash
curl https://<domain>/api/health     # {"success":true,"status":"ok"}
npm run --silent typecheck           # dari direktori containers/
wrangler tail                        # log Worker; log aplikasi ada di container
```
