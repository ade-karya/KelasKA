# Deploy ke Vercel (mode terbatas)

Vercel menjalankan UI, perpustakaan kursus, auth, dan API berbasis database.
Pembuatan kursus **diantre** ke PostgreSQL lalu dikerjakan oleh
[worker eksternal](../worker/README.md). Ini berbeda dengan dukungan Vercel
1.1.x yang lama: versi sekarang memang membutuhkan proses Node yang hidup
lebih lama dari request.

## Yang tidak bisa jalan di Vercel

- runner generasi dan agen (timer proses tidak selamat setelah response),
- filesystem lokal yang awet (`data/`), komando CLI agen, dan layanan GPU,
- endpoint media lokal (ComfyUI/Ollama/FunASR/VoxCPM).

Semua itu pindah ke worker. Classroom chat per-request (`/api/chat/pi`) tetap
bisa karena hanya streaming LLM biasa, asalkan provider dikonfigurasi.

## Langkah

1. Siapkan PostgreSQL dengan **connection pooler** (Supabase transaction
   pooler port 6543 atau Neon pooled). `pg` di sini memakai pool per instance;
   koneksi langsung cepat habis ketika banyak fungsi aktif.
   `?sslmode=require` disarankan. `pgbouncer=true` bukan opsi `node-postgres`,
   jangan dipakai.
2. Siapkan byte store `HF_S3_*` (atau biarkan asset store PostgreSQL). Jangan
   mengandalkan `data/`—hilang saat instance didaur ulang.
3. Di Vercel → Project → Settings → Environment Variables, isi env dari
   [`../shared/env.serverless.example`](../shared/env.serverless.example).
   `VERCEL=1` sudah disetel platform, jadi `OPENMAIC_DEPLOY_TARGET` bisa
   dibiarkan `vercel` atau tidak diisi sama sekali.
4. Set `AUTH_PUBLIC_URL` ke origin publik (mis. `https://kelaska.riau.ai`)
   bila memakai akun. Tanpa itu, callback Supabase membangun redirect dari
   origin internal Vercel dan pengguna dilem ke host yang salah.
5. Nyalakan worker eksternal lebih dulu. **Nilai `DATABASE_URL`,
   `OPENMAIC_SECRET_KEY`, dan kredensial akun harus identik** di kedua host.
6. Deploy:

   ```bash
   # dari root repo, memakai config ini (tidak perlu menyalin vercel.json)
   vercel deploy --local-config deploy/vercel/vercel.json --prod
   ```

   Atau, jika project diimport lewat dashboard, salin isi `vercel.json` ke
   root repo (Vercel hanya membaca `vercel.json` di root saat build lewat Git).
   `--local-config` hanya dipakai untuk deploy lewat CLI.

## Durasi fungsi

Berkas `vercel.json` menaikkan `maxDuration` untuk route SSE
(`/api/generation-runs/**/events`) dan streaming chat menjadi 300 detik.
`maxDuration` di atas 60 detik butuh paket Pro/Fluid compute; pada Hobby,
setel 60. Klien memakai `FetchEventSource` yang menyambung kembali dengan
`Last-Event-ID`, jadi stream yang terputus karena batas waktu fungsi tetap
melanjutkan dari event terakhir — biaya yang naik hanya jumlah invocation.

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
