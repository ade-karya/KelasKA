# Deploy ke Vercel (Hobby) — aplikasi penuh, worker di Kaggle

Vercel menjalankan **aplikasi Next.js penuh**: UI, perpustakaan/pemutaran
kursus, auth, dan seluruh API berbasis PostgreSQL. Pembuatan kursus, agen, dan
media/GPU **diantre** ke PostgreSQL lalu dikerjakan oleh
[worker eksternal](../worker/README.md) — untuk deployment ini, notebook Kaggle
on-demand ([`../kaggle/README.md`](../kaggle/README.md)).

Ini bukan lagi mode "static status page" yang lama. Sejak 2026 Vercel
menggabungkan dynamic code Next.js ke **sedikit mungkin** function, jadi 126
route API tidak lagi menabrak batas 12 function Hobby; `maxDuration` Hobby juga
300 detik (cukup untuk SSE/chat). Yang tetap tidak bisa dijalankan di Vercel
adalah proses yang hidup lebih lama dari satu request.

## Yang tidak bisa jalan di Vercel

- runner generasi dan agen (timer proses tidak selamat setelah response),
- filesystem lokal yang awet (`data/`), komando CLI agen, dan layanan GPU,
- endpoint media lokal (ComfyUI/Ollama/FunASR/VoxCPM).

Semua itu pindah ke worker Kaggle. Classroom chat per-request (`/api/chat/pi`)
tetap bisa karena hanya streaming LLM biasa, asalkan provider dikonfigurasi.

## Langkah

1. Siapkan PostgreSQL dengan **connection pooler** (Supabase transaction
   pooler port 6543 atau Neon pooled). `pg` di sini memakai pool per instance;
   koneksi langsung cepat habis ketika banyak fungsi aktif.
   `?sslmode=require` disarankan. `pgbouncer=true` bukan opsi `node-postgres`,
   jangan dipakai.
2. Siapkan byte store `HF_S3_*` (atau biarkan asset store PostgreSQL). Jangan
   mengandalkan `data/`—hilang saat instance didaur ulang.
3. Di Vercel → Project → Settings → Environment Variables, isi env dari
   [`../shared/env.serverless.example`](../shared/env.serverless.example)
   **ditambah** variabel `NEXT_PUBLIC_*` yang dipakai build. `VERCEL=1` sudah
   disetel platform, jadi `OPENMAIC_DEPLOY_TARGET` boleh dibiarkan kosong
   (otomatis `vercel`) atau diisi eksplisit.
4. Set `AUTH_PUBLIC_URL=https://kelas.riau.ai` bila memakai akun. Tanpa itu,
   callback Supabase membangun redirect dari origin internal Vercel dan
   pengguna dilem ke host yang salah. Daftarkan juga
   `https://kelas.riau.ai/api/auth/supabase/callback` di Supabase → Auth → URL
   Configuration.
5. Nyalakan worker Kaggle lebih dulu. **Nilai `DATABASE_URL`,
   `OPENMAIC_SECRET_KEY`, `HF_S3_*`, dan kredensial akun harus identik** di
   kedua host. Worker memakai `OPENMAIC_DEPLOY_TARGET=kaggle` (terdeteksi
   otomatis di kernel) dan `OPENMAIC_AGENT_RUNTIME_ENABLED=true`.
6. Deploy:

   ```bash
   # dari root repo, memakai config ini (tidak perlu menyalin vercel.json)
   vercel deploy --local-config deploy/vercel/vercel.json --prod
   ```

   Atau, jika project diimport lewat dashboard, salin isi `vercel.json` ke
   root repo (Vercel hanya membaca `vercel.json` di root saat build lewat Git).
   `--local-config` hanya dipakai untuk deploy lewat CLI.

7. Tambahkan domain `kelas.riau.ai` ke project Vercel, lalu buat CNAME
   `kelas` → `cname.vercel-dns.com` di Cloudflare (proxied). Jangan arahkan
   `kelas.riau.ai` ke tunnel Kaggle.

## Durasi fungsi

Berkas `vercel.json` menaikkan `maxDuration` untuk route SSE
(`/api/generation-runs/**/events`) dan streaming chat menjadi 300 detik —
batas maksimum Hobby saat ini. Klien memakai `FetchEventSource` yang menyambung
kembali dengan `Last-Event-ID`, jadi stream yang terputus karena batas waktu
fungsi tetap melanjutkan dari event terakhir; biaya yang naik hanya jumlah
invocation.

## Ukuran function

Batas bundle function Hobby adalah 250 MB (uncompressed). Repo ini membawa
`sharp`, `@napi-rs/canvas`, dan beberapa paket native; bila build gagal karena
ukuran, aktifkan large functions beta dengan env
`VERCEL_SUPPORT_LARGE_FUNCTIONS=1` (sampai 5 GB) lalu redeploy. Untuk melihat
penyebabnya, set `VERCEL_ANALYZE_BUILD_OUTPUT=1`.

## Verifikasi

- `GET /api/health` → `200` dengan body `{ "success": true, "status": "ok" }`.
- `POST /api/generation-runs` → `202`, lalu cek di worker bahwa run muncul
  sebagai `queued` lalu berpindah ke `preparing`/`generating`.
- Buka halaman progres kursus: SSE harus menampilkan event yang ditulis worker.
- Pastikan tidak ada permintaan ke endpoint GPU lokal dari Vercel; bila perlu,
  matikan `IMAGE_COMFYUI_ENABLED` dan arahkan TTS ke browser-native.

## Catatan build

`buildCommand` menjalankan skrip pra-build repo (sinkronisasi aset interaktif,
player standalone, dan pengecekan vendor). Karena modul
`lib/config/deploy-target.ts` membaca `VERCEL`, `next build` di Vercel tidak
menghasilkan `.next/standalone`—itu memang yang diharapkan. Build Docker untuk
worker tidak boleh menyetel `OPENMAIC_DEPLOY_TARGET=vercel`, kalau tidak
`COPY .next/standalone` di Dockerfile akan gagal.
