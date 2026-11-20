# Pemecahan deployment — Vercel, Cloudflare, Kaggle, Colab

Satu codebase Next.js, beberapa profil deployment. Kode aplikasi **tidak** dipecah
menjadi `apps/*`; yang dipecah adalah konfigurasi, env, skrip, dan dokumentasi
per target. Satu baris kode bersama (`lib/config/deploy-target.ts`) memberi tahu
proses apa yang boleh ia lakukan di host tempat ia berjalan.

## Matriks kemampuan

| Profil | Cara jalan | Worker latar belakang | FS lokal awet | Proses/GPU lokal | Peran |
| --- | --- | --- | --- | --- | --- |
| `self-hosted` | Docker Compose / `bun run start` / PM2 | ya | ya | ya | aplikasi penuh (default) |
| `kaggle` | `install.sh --kaggle` di notebook | ya | tidak | ya (bila GPU ada) | aplikasi penuh + layanan GPU |
| `colab` | `install.sh --colab` di runtime | ya | tidak | ya (bila GPU ada) | aplikasi penuh + layanan GPU |
| `vercel` | Vercel functions (Next.js) | **tidak** | tidak | tidak | UI, pustaka kursus, auth, API DB; generation diantre |
| `cloudflare` | Cloudflare Containers | **tidak** | tidak | tidak | UI, pustaka kursus, auth, API DB |

Vercel dan Cloudflare berjalan dalam **mode terbatas**: UI, perpustakaan/
pemutaran kursus, auth, dan seluruh API berbasis PostgreSQL tetap berfungsi.
Pembuatan kursus, agen, dan media/GPU dijalankan oleh **worker eksternal** yang
memakai `DATABASE_URL` yang sama.

> Untuk deployment split lama (Cloudflare Worker + tunnel Colab/Kaggle), lihat
> [`split-deployment.md`](split-deployment.md). Untuk target Vercel + Kaggle
> on-demand yang dipakai sekarang, lihat [`vercel/README.md`](vercel/README.md)
> dan [`kaggle/README.md`](kaggle/README.md).

## Mengapa worker eksternal

Generation run disimpan di tabel `generation_runs` dan diklaim oleh proses
manapun yang menjalankan runner (`lib/server/generation/run/runner.ts`). Event
run juga dibaca dari database, sehingga SSE (`/api/generation-runs/:id/events`)
dan polling snapshot bekerja lintas proses. Artinya:

1. Vercel/Cloudflare hanya **mengantre** run lewat `POST /api/generation-runs`
   atau `POST /api/generate-classroom`.
2. Worker host (Kaggle, Colab, atau VPS) menjalankan build penuh dengan
   `OPENMAIC_AGENT_RUNTIME_ENABLED=true` dan mengklaim run itu.
3. Browser yang menunggu di Vercel/Cloudflare tetap menerima progres lewat SSE
   yang membaca event dari database yang sama.

Tanpa worker yang hidup, antrean tidak pernah diproses — itu sebabnya mode
terbatas **wajib** dipasangkan dengan [`deploy/worker`](worker/README.md).

Cloudflare **Workers** via OpenNext sengaja tidak dipakai sebagai target utama:
`lib/persistence/server-provider.ts` menyimpan satu `pg.Pool` global per proses,
sedangkan Workers melarang I/O lintas request (`Cannot perform I/O on behalf of
a different request`). Migrate ke pool per-request/`maxUses: 1` diperlukan
sebelum Workers bisa dipakai. [`deploy/cloudflare`](cloudflare/README.md)
memakai **Cloudflare Containers**, yang menjalankan Dockerfile penuh sehingga
batasan itu tidak ada.

## Memilih profil

`OPENMAIC_DEPLOY_TARGET` menang atas deteksi otomatis. Nilai yang diterima:
`self-hosted`, `vercel`, `cloudflare`, `kaggle`, `colab`.

| Variabel host | Profil terdeteksi |
| --- | --- |
| `VERCEL=1` | `vercel` |
| `CF_PAGES=1` atau `WORKERS_CI=1` | `cloudflare` |
| `KAGGLE_KERNEL_RUN_TYPE` / `KAGGLE_URL_BASE` | `kaggle` |
| `COLAB_RELEASE_TAG` / `COLAB_BACKEND_VERSION` | `colab` |
| tidak ada | `self-hosted` |

Perilaku yang diubah profil:

- `next.config.ts`: `output: 'standalone'` hanya untuk profil non-serverless.
  Vercel/OpenNext memakai output bawaan Next.
- `instrumentation.node.ts`: validasi boot yang **fatal** dan peringatan
  konfigurasi tetap jalan, lalu proses berhenti sebelum memulai runner,
  schedule, dan koneksi `LISTEN`/`NOTIFY`. Route API tidak berubah.
- Pengaturan media lokal (ComfyUI/Ollama/FunASR/VoxCPM) tidak boleh diarahkan
  ke host serverless; pakai provider cloud atau endpoint GPU worker.

## Isi direktori

```
deploy/
  README.md                       ← ini
  shared/
    env.serverless.example        ← env minimal untuk Vercel / Cloudflare
    env.worker.example            ← env minimal untuk host worker
  vercel/
    vercel.json                   ← build, region, batas durasi fungsi
    README.md
  cloudflare/
    README.md
    containers/
      wrangler.jsonc              ← Container + Durable Object binding
      worker.ts                   ← proxy request + pewarisan env
      package.json                ← @cloudflare/containers + wrangler
      tsconfig.json
      deploy.sh
  kaggle/
    README.md                     ← copy-paste cell + proxy port
    run.sh                        ← pembungkus install.sh --kaggle
  colab/
    README.md                     ← copy-paste cell + keep-alive
    run.sh                        ← pembungkus install.sh --colab
  worker/
    README.md                     ← menjalankan host penuh sebagai worker DB
```

`*.ipynb` sengaja tidak disimpan di repo (lihat `.gitignore`: notebook
menyangkut kredensial). Notebook Kaggle/Colab dibuat dari cell yang ada di
README masing-masing.

## Langkah umum

1. Siapkan satu PostgreSQL yang bisa diakses semua host (Neon/Supabase untuk
   Vercel, atau instance sendiri). Pakai connection pooler untuk serverless.
2. Siapkan penyimpanan byte: `HF_S3_*` (disarankan) atau asset store PostgreSQL.
   Jangan mengandalkan `data/` di host serverless.
3. Isi env serverless dari `shared/env.serverless.example` dan env worker dari
   `shared/env.worker.example`. **Nilai `DATABASE_URL` dan `OPENMAIC_SECRET_KEY`
   harus identik** di kedua host.
4. Nyalakan worker lebih dulu, baru arahkan traffic ke Vercel/Cloudflare.
5. Verifikasi: `GET /api/health` harus `200` di kedua host, dan
   `GET /api/generation-runs` harus bisa membaca antrean yang sama.

## Verifikasi perubahan kode

```bash
bun run test tests/config/deploy-target.test.ts
bunx tsc --noEmit -p tsconfig.build.json
```

Tes `tests/server/health-access-code.test.ts` membandingkan payload health
secara eksak; jangan menambah field `deployTarget` ke respons publik.
