# Worker eksternal (penjalankan generation run)

Worker bukan aplikasi terpisah dalam arti kode: ia adalah **build penuh yang
sama**, dijalankan di host yang hidup terus, dan terhubung ke database yang
sama dengan deployment serverless. Generation run dan event progresnya ada di
PostgreSQL (`generation_runs`), jadi proses manapun dengan runner aktif bisa
mengambilnya.

## Yang dibutuhkan

- `DATABASE_URL` **sama persis** dengan Vercel/Cloudflare (host, database, dan
  kredensial). Ini satu-satunya kabel antar host.
- `OPENMAIC_SECRET_KEY` sama bila akun/pengguna diakses lintas host.
- `HF_S3_*` atau asset store lain yang sama, supaya berkas hasil generasi bisa
  dibaca UI di serverless.
- Kunci model (`GOOGLE_API_KEY` / `GOOGLE_MODELS`) untuk menjalankan tiap
  langkah generasi.
- `OPENMAIC_AGENT_RUNTIME_ENABLED=true` bila antrean agen juga diproses di sini.
- Versi kode yang **kompatibel** dengan host serverless. Semua instance yang
  berbagi database memantau skema setiap 30 detik dan akan berhenti mengambil
  kerja bila ada instance dengan versi yang tidak cocok; deployment ulangi
  kedua host bersamaan saat upgrade.

## Opsi A — Kaggle / Colab

Paling cepat: ikuti [`deploy/kaggle`](../kaggle/README.md) atau
[`deploy/colab`](../colab/README.md). Isi env dari
[`../shared/env.worker.example`](../shared/env.worker.example) sebelum
menjalankan installer. Tidak perlu proxy port ke publik untuk peran ini, tetapi
runtime harus tetap hidup (keep-alive).

## Opsi B — VPS / host sendiri

```bash
git clone --depth 1 https://github.com/ade-karya/KelasKA.git /opt/kelaska
cd /opt/kelaska
# isi .env.local dari deploy/shared/env.worker.example
bun install
bun run build
rm -rf .next/standalone/.next/static .next/standalone/public
cp -a .next/static .next/standalone/.next/static
cp -a public .next/standalone/public
HOSTNAME=0.0.0.0 PORT=3000 node .next/standalone/server.js
```

`registerNode()` di `instrumentation.node.ts` menyalakan generation runner
(walaupun `OPENMAIC_AGENT_RUNTIME_ENABLED` mati—classic generation adalah
produk default), jadi tidak ada entri "worker only" terpisah yang perlu
dijalankan. Untuk produksi, jalankan di bawah PM2/systemd dan nyalakan
`OPENMAIC_SECRET_KEY` serta env permanen.

## Penyetelan

| Variabel | Fungsi |
| --- | --- |
| `OPENMAIC_GENERATION_RUN_MAX_CONCURRENT` | jumlah run yang dikerjakan sekaligus |
| `OPENMAIC_AGENT_TTS_CONCURRENCY` | konkurensi narasi (2 bila 2× GPU T4) |
| `PARALLEL_SCENE_CONCURRENCY` | jumlah scene yang dibuat paralel per run |

Jangan menaikkan konkurensi narasi pada satu GPU yang melayani VoxCPM secara
serial—antrian akan saling menunggu.

## Verifikasi end-to-end

1. Di Vercel/Cloudflare, `POST /api/generation-runs` → `202`.
2. Di worker, log harus mencatat
   `[GenerationRunner] claimed <run-id>` lalu langkah-langkah generasi.
3. Buka halaman progres di host serverless: event SSE mengalir dari database
   walaupun run dijalankan di host lain.
4. `GET /api/stages/<id>` di kedua host mengembalikan dokumen yang sama.
