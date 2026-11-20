# PRD — KelasKA Produksi Hybrid 2026

**Produk:** Kelas Kecerdasan Artifisial (KelasKA)
**Dokumen:** Product Requirements Document untuk deployment produksi
**Versi:** 1.0 — Draf untuk keputusan
**Tanggal:** 20 November 2026
**Domain:** `kelaska.riau.ai`
**Status:** Menunggu keputusan arsitektur (D1–D5 di §0.3)

![Arsitektur produksi hybrid KelasKA](assets/arsitektur-produksi.png)

> **Cara membaca dokumen ini.** §0–§4 menjelaskan mengapa stack yang diminta tidak bisa dipasang apa adanya, dan dua jalur yang tersedia. §5–§12 adalah rancangan target. §13–§17 adalah operasi, biaya, uji, dan risiko. Jika yang dibutuhkan hanya "situs produksi minggu ini", langsung ke **Opsi A** di §4.1.

---

## 0. Ringkasan eksekutif

### 0.1 Masalah

KelasKA hari ini adalah aplikasi Next.js 16 yang di-deploy sebagai proses Node panjang (`.next/standalone` + PM2) dengan PostgreSQL. Sejak versi 1.2.0, pembuatan kelas berjalan di **generation runner** yang hidup di dalam proses aplikasi: runner mengklaim run dari PostgreSQL, mengeksekusinya di bawah lease, dan menulis hasilnya kembali ke database. README menyatakan eksplisit bahwa deployment serverless hanya didukung sampai 1.1.x; Vercel dan host serverless lain tidak didukung, dan `vercel.json` sudah tidak ada.

Artinya, permintaan "Vercel Hobby + Cloudflare Workers Free + Supabase Free + HF S3 Free + Colab + Kaggle" **bukan sekadar konfigurasi**. Ada tiga benturan keras:

1. **Vercel Function berumur maksimal 300 detik** (Hobby), sedangkan satu run pembuatan kelas bisa jauh lebih lama dan harus bertahan saat tab ditutup. Runner tidak boleh hidup di dalam fungsi Vercel.
2. **Cloudflare Workers Free hanya 10 ms CPU dan 128 MB** per invocation. SSR Next.js + auth + database tidak muat. Workers hanya layak untuk DNS, WAF, cache, dan cron tipis.
3. **Colab dan Kaggle bukan server 24/7.** Keduanya notebook yang dijalankan operator, punya batas sesi, dan Colab secara eksplisit melarang "web service offerings" serta "bypassing the notebook UI to interact primarily via a web UI". Keduanya tidak bisa menjadi backend yang diandalkan tanpa risiko ToS.

### 0.2 Keputusan yang direkomendasikan

**Jalankan Opsi A sekarang, bangun Opsi B di belakang flag.** Jangan memindahkan seluruh aplikasi ke Vercel Hobby dalam satu langkah.

| | Opsi A — Jembatan produksi | Opsi B — Target hybrid serverless |
|---|---|---|
| Web tier | Proses Node panjang (Colab/Kaggle/VPS kecil) | Vercel Hobby |
| Generation runner | Di proses web (seperti sekarang) | Di Colab/Kaggle worker |
| Database | Supabase Free (session pooler) | Supabase Free |
| Media | HF S3 Free | HF S3 Free |
| Edge | Cloudflare DNS/WAF/cron | Cloudflare DNS/WAF/cron |
| Feature parity | Penuh, hari ini | Core dulu; PBL v3/agent/video menyusul |
| Waktu | 1–2 minggu | 7–10 minggu |
| Risiko utama | Host tunggal | ToS worker, batas Vercel, kompleksitas |

**Rekomendasi:** produksi pilot memakai Opsi A (fitur penuh, biaya mendekati nol), sambil menjalankan spike Opsi B. Cutover ke Vercel hanya setelah worker extraction, queue media, dan uji beban lulus. Ini menghindari situs produksi yang setengah fitur dan menghindari ketergantungan pada notebook gratis sebagai backend permanen.

### 0.3 Keputusan yang diminta

| ID | Keputusan | Pemilik | Tenggat |
|---|---|---|---|
| D1 | Setujui Opsi A sebagai jembatan produksi pilot | Pemilik produk | Minggu 1 |
| D2 | Setujui target Opsi B dan alokasi 7–10 minggu | Pemilik produk + tech lead | Minggu 1 |
| D3 | Setujui anggaran Gemini paid tier dan Vercel/Supabase Pro saat ambang terlampaui | Keuangan | Minggu 2 |
| D4 | Setujui pengecualian BYOK untuk akun siswa (atau kebijakan key bersama) | Pemilik produk | Minggu 2 |
| D5 | Konfirmasi kebijakan residensi data (UU PDP) | Legal/compliance | Minggu 2 |

### 0.4 Definisi "selesai" untuk fase ini

- Pengguna dapat login Google, melihat hanya kursus miliknya, dan memutar kursus dengan gambar/audio dari HF S3.
- Guru dapat membuat kelas; pekerjaan masuk antrean; Colab mengerjakan teks; Kaggle mengerjakan media; status terlihat di UI; hasil muncul tanpa refresh manual.
- Tidak ada secret (service role, HF token, DB password) yang bocor ke bundle klien atau log.
- Jika worker offline, job tetap `queued` dan UI menjelaskan statusnya; tidak ada kehilangan data.
- Backup harian dapat direstore ke project staging dan kursus tetap dapat diputar.
- Biaya bulanan pilot berada di Rp0–150 ribu (di luar domain dan kuota Gemini), dengan alert 80% untuk setiap kuota gratis.

---

## 1. Latar belakang

### 1.1 Kondisi saat ini

- Aplikasi: Next.js 16, React 19, TypeScript, Tailwind 4, output `standalone`, dijalankan dengan Bun + PM2.
- Database: PostgreSQL wajib (`DATABASE_URL`); skema dikelola oleh `packages/@openmaic/storage` dan bootstrap di `scripts/bootstrap-db-schema.mts`.
- Penyimpanan media: asset pool PostgreSQL atau S3-compatible; HF S3 sudah didukung lewat `HF_S3_*` dan `ASSET_BYTE_EGRESS=redirect`.
- Auth: opsional (`AUTH_ENABLED`), Google-only lewat Supabase Auth PKCE, akun baru `pending` sampai admin menyetujui.
- Generation runner: `startGenerationRunner()` dipanggil dari `instrumentation.node.ts` di setiap proses; runner mengklaim `generation_runs` dengan lease, heartbeat, dan retry.
- Media: adapter ComfyUI (gambar), VoxCPM (TTS), FunASR (ASR), dan provider cloud; `scripts/gpu-services.sh` menjalankan stack GPU lokal di Colab/Kaggle.
- Deploy yang ada: `install.sh --colab` dan `install.sh --kaggle` membangun standalone + PM2 + layanan GPU di notebook. Ini sudah terbukti, tetapi notebook bersifat ephemeral.

### 1.2 Mengapa stack yang diminta menarik

- **Vercel Hobby** memberi CDN, HTTPS, preview deployment, dan Next.js hosting tanpa biaya.
- **Cloudflare Free** memberi DNS, WAF, TLS, cache, dan cron tanpa biaya.
- **Supabase Free** sudah dipakai untuk auth dan cocok untuk Postgres + Realtime.
- **HF S3 Free** memberi 100 GB penyimpanan privat untuk media, menggantikan disk lokal.
- **Colab/Kaggle** memberi CPU/GPU gratis untuk pembuatan kelas dan media, yang selama ini menjadi biaya terbesar.

### 1.3 Mengapa tidak bisa langsung

| Kebutuhan aplikasi | Kenyataan platform | Dampak |
|---|---|---|
| Proses hidup > 300 s untuk generation run | Vercel Hobby memutus fungsi di 300 s | Run terputus, lease menggantung, hasil tidak lengkap |
| `LISTEN/NOTIFY` untuk event agent | Supabase transaction pooler (6543) tidak mengantarkan NOTIFY; butuh session mode 5432 | Event agent tidak real-time; SSE agent tidak bisa diandalkan |
| Sandbox PBL v3 lokal (PTY/fs) | Vercel tidak menyediakan proses lokal persisten | PBL v3 gagal kecuali memakai E2B-compatible remote sandbox |
| `fs` untuk dokumen, prompt, media lama | Vercel read-only dan ephemeral | `/docs`, `/api/classroom-media`, workflow ComfyUI tidak jalan tanpa perubahan |
| SSR + auth di edge | Workers Free 10 ms CPU/128 MB | SSR Next.js tidak muat |
| Worker GPU selalu hidup | Colab/Kaggle sesi terbatas, tanpa inbound | Worker harus pull job, bukan dipanggil web |
| Kuota LLM | Gemini free 500 RPD (flash-lite) | Pembuatan kelas adalah bottleneck sebenarnya, bukan server |

---

## 2. Tujuan, non-tujuan, dan metrik

### 2.1 Tujuan

| ID | Tujuan |
|---|---|
| G1 | Menyediakan situs produksi `kelaska.riau.ai` yang dapat dipakai siswa/guru/admin dengan login Google. |
| G2 | Memindahkan pekerjaan berat (pembuatan kelas, media GPU) keluar dari web tier ke worker yang dapat diskalakan/antre. |
| G3 | Menyimpan data terstruktur di Supabase dan media di HF S3, tanpa disk lokal sebagai sumber kebenaran. |
| G4 | Menjaga biaya pilot mendekati nol dengan batas gratis yang terukur dan alert 80%. |
| G5 | Menjaga fitur inti (library, playback, pembuatan kelas, admin) tetap berfungsi saat worker offline. |
| G6 | Menyediakan jalur rollback yang jelas ke Opsi A jika Vercel/worker gagal. |

### 2.2 Non-tujuan (fase 1)

- Tidak membangun GPU cluster sendiri.
- Tidak menjalankan model LLM lokal di produksi.
- Tidak menjamin SLA 99,9% pada fase pilot; target best-effort dengan status page.
- Tidak memigrasikan seluruh data lama dari host Colab secara otomatis; migrasi dilakukan satu kali dengan skrip.
- Tidak mengaktifkan agent workbench, PBL v3 lokal, dan video export di Vercel pada fase 1.
- Tidak membuat aplikasi Android baru; APK yang ada tetap memakai `https://kelaska.riau.ai`.

### 2.3 Metrik keberhasilan

| Metrik | Target pilot | Cara ukur |
|---|---|---|
| Login sukses | ≥ 98% percobaan | Log auth + Supabase |
| Waktu buka kursus (p95) | ≤ 2,5 s di 4G | Web Vitals / RUM |
| Waktu antre job teks | ≤ 5 menit saat worker online | `worker_jobs` timestamps |
| Waktu antre job media | ≤ 30 menit saat worker online | `worker_jobs` timestamps |
| Job sukses | ≥ 95% (retry 3×) | Queue metrics |
| Kehilangan data | 0 | Backup/restore drill |
| Biaya pilot | ≤ Rp150 ribu/bulan | Invoice + dashboard kuota |
| Akses lintas pemilik | 0 temuan | Uji IDOR + review RLS |

---

## 3. Asumsi dan batas platform

Angka di bawah diverifikasi dari dokumentasi resmi pada 20 November 2026. Batas gratis dapat berubah; §17 mencantumkan pemicu dan mitigasinya.

### 3.1 Vercel Hobby

| Item | Batas | Implikasi |
|---|---|---|
| Durasi fungsi | 300 s maksimum | SSE maksimal 300 s; klien harus reconnect dengan `Last-Event-ID` |
| Invokasi | 1 juta/bulan | Cukup untuk pilot; polling agresif harus dihindari |
| Active CPU | 4 jam/bulan | Batas paling ketat; SSR berat dan kompresi gambar harus dihindari |
| Provisioned memory | 360 GB-jam/bulan | Pantau; fungsi besar mempercepat habis |
| Fast data transfer | 100 GB/bulan | Media harus dari HF S3, bukan proxy Vercel |
| Build | 8 GB RAM, 2 vCPU, 64 GB disk | Build aplikasi ini butuh heap besar; atur `NODE_OPTIONS` |
| Deploy | 100/hari | Cukup untuk CI |
| Log | 1 jam | Kirim log penting ke Supabase/observability |
| Perilaku overage | Hobby dijeda saat kuota terlampaui | Situs bisa mati sampai siklus berikutnya; alert 80% wajib |
| SLA | Tidak ada | Jangan janjikan uptime kepada sekolah tanpa upgrade |

**Kesimpulan:** Vercel Hobby layak untuk web tier yang ramping, bukan untuk runner, bukan untuk media, bukan untuk SSR berat tanpa cache.

### 3.2 Cloudflare Free

| Item | Batas | Implikasi |
|---|---|---|
| Request Worker | 100.000/hari | Cukup untuk cron dan endpoint tipis; bukan untuk proxy semua traffic |
| CPU per request | 10 ms | Tidak mungkin SSR Next.js |
| Memori | 128 MB | Tidak muat bundle aplikasi |
| Subrequest | 50/request | Cukup untuk cron |
| Cron trigger | 5/akun | Cukup untuk reaper 5 menit + keep-alive harian |
| Ukuran Worker | 64 MB | Cukup untuk skrip kecil |
| Body request | 100 MB (free zone) | Upload besar langsung ke HF S3, bukan lewat Worker |

**Kesimpulan:** Cloudflare = DNS, TLS, WAF, cache, cron, docs statis. Bukan app host.

### 3.3 Supabase Free

| Item | Batas | Implikasi |
|---|---|---|
| Project | 2 | Cukup untuk produksi + staging |
| Database | 500 MB/project | Kursus JSONB + auth + job; arsipkan kursus lama |
| Egress | 5 GB/bulan | Jangan streaming media dari Supabase; media di HF S3 |
| Storage | 1 GB | Hanya avatar/berkas kecil; media di HF S3 |
| MAU | 50.000 | Cukup untuk pilot |
| Realtime | 200 koneksi puncak, 2 juta pesan/bulan | Cukup untuk pilot; fallback polling |
| Edge Function | 500.000 invokasi | Tidak dipakai untuk worker utama |
| Pause | 7 hari aktivitas rendah | Cron keep-alive harian wajib |
| Backup | Terbatas; tidak ada PITR di Free | `pg_dump` harian ke HF S3 wajib |
| Pooler | Session 5432 untuk LISTEN/NOTIFY; transaction 6543 untuk worker | Dua URL koneksi |

**Kesimpulan:** Supabase adalah sumber kebenaran data. Jangan simpan media besar di database.

### 3.4 Hugging Face S3 Free

| Item | Batas | Implikasi |
|---|---|---|
| Penyimpanan privat | 100 GB | ±1.250–3.000 kursus tergantung media |
| Penyimpanan publik | Best-effort | Jangan andalkan untuk aset publik besar |
| Ukuran file | 500 GB hard limit; disarankan < 200 GB | Video panjang harus dipecah/kompresi |
| File per repo | < 100.000; < 10.000/folder | Partisi prefix per owner/tanggal |
| SLA/CDN | Tidak ada SLA komersial | Butuh retry, cache, dan fallback |
| Endpoint | `https://s3.hf.co/<namespace>` path-style | Sudah didukung `HF_S3_*` |
| Egress | Tidak dijamin sebagai CDN | Presigned URL + cache browser; pertimbangkan R2 untuk hot cache |

**Kesimpulan:** HF S3 cocok untuk byte store murah, bukan untuk streaming video massal tanpa cache.

### 3.5 Colab Free

| Item | Batas | Implikasi |
|---|---|---|
| Durasi | Maks 12 jam | Worker harus checkpoint dan requeue |
| GPU | Tidak dijamin | Course worker sebaiknya CPU-only |
| Resource | Tidak dijamin, bisa berubah | Jangan jadikan satu-satunya worker |
| ToS | Melarang web service offerings, bypass UI, distributed workers | Gunakan notebook yang dijalankan operator, bukan worker otonom 24/7 |
| Inbound | Tidak ada | Worker pull dari queue |

**Kesimpulan:** Colab = alat operator untuk batch pembuatan kelas, bukan backend permanen.

### 3.6 Kaggle

| Item | Batas | Implikasi |
|---|---|---|
| GPU | ±30 jam/minggu (T4×2/P100) | ±60–120 kursus media per minggu |
| Sesi | Maks 12 jam | Checkpoint + requeue |
| Output | 20 GB | Media harus langsung diunggah ke HF S3 |
| Inbound | Tidak ada | Worker pull dari queue |
| ToS | Untuk data science/ML; penggunaan produksi perlu review | Jangan jadikan satu-satunya jalur; siapkan fallback |

**Kesimpulan:** Kaggle = batch GPU murah dengan campur tangan operator, bukan layanan selalu-on.

### 3.7 Gemini API (kuota gratis)

| Model | RPM/RPD (key saat ini) | Catatan |
|---|---|---|
| `gemini-3.6-flash`, `gemini-3.8-flash` | 5/20 | Kualitas lebih baik, kuota sangat kecil |
| `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` | 15/500 | Default llm/agent dan ASR |
| TTS | 3/10 | Tidak dipakai untuk produksi media |
| Image (Nano Banana) | 0 | Free tier tidak mengizinkan output gambar |

Satu kursus dapat memakai 40–100 panggilan LLM. Dengan 500 RPD, satu key hanya sanggup **5–12 kursus/hari** jika seluruh panggilan memakai flash-lite. Ini bottleneck utama, bukan server. Untuk produksi, siapkan paid tier atau kuota terpisah yang sah; jangan memutar banyak key untuk menghindari batas.

### 3.8 Domain dan DNS

- Zona `riau.ai` dikelola di Cloudflare.
- `kelaska.riau.ai` → Vercel (CNAME), proxy Cloudflare aktif.
- `docs.kelaska.riau.ai` → Cloudflare Pages (dokumentasi statis).
- `status.kelaska.riau.ai` → Cloudflare Pages/Worker status.
- SSL/TLS mode **Full (strict)**, Always Use HTTPS, HSTS, minimum TLS 1.2.
- Supabase Redirect URL: `https://kelaska.riau.ai/api/auth/supabase/callback`.
- `AUTH_PUBLIC_URL=https://kelaska.riau.ai` (wajib di balik proxy).

---

## 4. Keputusan arsitektur

### 4.1 Opsi A — Jembatan produksi (direkomendasikan untuk pilot)

**Bentuk:**

```
Cloudflare DNS/WAF
        │
        ▼
Host Node panjang (Colab/Kaggle/VPS kecil)
  Next.js standalone + PM2
  generation runner + media lokal/remote
        │
        ├── Supabase Postgres + Auth
        └── HF S3 (media)
```

**Cara menjalankan:**

- Pakai `install.sh --colab` atau `install.sh --kaggle` yang sudah ada, dengan `DATABASE_URL` Supabase dan `HF_S3_*`.
- Jika memakai Colab/Kaggle, host hanya hidup selama sesi; untuk produksi pilot yang serius, pindahkan ke VPS kecil (2 vCPU/4 GB) atau layanan container dengan disk persisten.
- Vercel Hobby hanya untuk landing/status statis, bukan aplikasi.
- Cloudflare menangani DNS, TLS, WAF, dan cron keep-alive Supabase.

**Kelebihan:** fitur penuh hari ini; tidak ada refactor; sudah terbukti; biaya rendah.
**Kekurangan:** satu titik gagal; kapasitas terbatas; bukan arsitektur yang diminta; notebook ephemeral.

**Kapan dipakai:** segera, untuk pilot dengan 50–200 pengguna dan 20–50 kursus/bulan.

### 4.2 Opsi B — Target hybrid serverless (diminta)

**Bentuk:** lihat diagram di atas.

```
Pengguna → Cloudflare → Vercel (web) → Supabase (data/auth/realtime)
                                   ├→ HF S3 (media, presigned)
                                   └→ worker_jobs (Postgres)
                                          ▲            ▲
                                     Colab (teks)  Kaggle (GPU)
```

**Prinsip:**

1. **Web tier tidak mengeksekusi pekerjaan berat.** Vercel hanya membaca/menulis database, memulai job, dan menyajikan status.
2. **Queue adalah kontrak.** `worker_jobs` + lease + heartbeat + idempotency; worker boleh mati kapan saja.
3. **Worker pull, bukan push.** Colab/Kaggle tidak punya inbound; mereka klaim job dari Postgres.
4. **Media tidak pernah melewati Vercel.** Upload langsung worker → HF S3; browser membaca presigned URL.
5. **Fitur berat di-gate.** Agent workbench, PBL v3 lokal, dan video export tidak aktif di Vercel fase 1.
6. **Semua yang mahal di-cache.** Halaman publik statis/ISR, aset `/_next/static` immutable, media di browser cache.

**Kelebihan:** web scaling terpisah; cocok dengan free tier; worker bisa diganti tanpa menyentuh web.
**Kekurangan:** 7–10 minggu; distributed debugging; ToS worker; batas Vercel; feature gap.

### 4.3 Matriks keputusan

| Kriteria | Bobot | Opsi A | Opsi B |
|---|---:|---:|---:|
| Fitur lengkap segera | 25% | 5 | 2 |
| Biaya pilot | 15% | 5 | 5 |
| Keandalan | 20% | 3 | 3 |
| Skalabilitas | 15% | 2 | 4 |
| Beban operasional | 15% | 4 | 2 |
| Kepatuhan/ToS | 10% | 4 | 2 |
| **Skor** | | **3,95** | **3,05** |

**Keputusan:** A untuk produksi pilot; B untuk target setelah spike dan worker extraction. Jangan big-bang.

---

## 5. Arsitektur target (Opsi B)

### 5.1 Tanggung jawab komponen

| Komponen | Tanggung jawab | Tidak boleh |
|---|---|---|
| Cloudflare | DNS, TLS, WAF, cache statis, cron reaper/keep-alive, docs/status | Menjalankan SSR atau menyimpan data |
| Vercel | UI, auth callback, REST API, SSE/polling, admin, library | Menjalankan generation runner, menulis disk, memproses media |
| Supabase Auth | Google OAuth, sesi Supabase, verifikasi email | Menyimpan role aplikasi (role di `auth_users`) |
| Supabase Postgres | Kursus, user, run, job, lease, asset metadata, audit | Menyimpan blob media besar |
| Supabase Realtime | Progress job/kursus (fase 2), presence worker | Menjadi satu-satunya jalur status (fallback polling) |
| HF S3 | Gambar, audio, video, ekspor, backup | Menjadi database atau CDN dengan SLA |
| Colab worker | Job `course.generate`: outline, scene, teks | Render media GPU |
| Kaggle worker | Job `course.media`: gambar, TTS, ASR, video | Menyimpan hasil di disk lokal |
| Gemini | LLM teks dan vision | Menjadi satu-satunya provider tanpa fallback |

### 5.2 Alur login

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant C as Cloudflare
    participant V as Vercel
    participant S as Supabase Auth
    participant D as Postgres
    B->>C: GET /login
    C->>V: proxy
    V-->>B: halaman login
    B->>S: signInWithOAuth(Google)
    S-->>B: redirect Google
    B->>S: callback Google
    S-->>B: redirect /api/auth/supabase/callback?code=...
    B->>V: GET callback
    V->>S: redeem code (PKCE verifier)
    V->>D: cari/buat auth_users
    alt akun pending
        V-->>B: /login?error=pending
    else aktif
        V-->>B: Set-Cookie kelaska_session + redirect /
    end
```

**Catatan:** `AUTH_PUBLIC_URL` harus diisi agar redirect tidak memakai origin internal Vercel. Cookie `kelaska_session` ditandatangani `OPENMAIC_SECRET_KEY`; role dibaca dari database setiap request, bukan dari token.

### 5.3 Alur pembuatan kelas

```mermaid
sequenceDiagram
    autonumber
    participant T as Guru
    participant V as Vercel
    participant D as Postgres
    participant C as Colab worker
    participant K as Kaggle worker
    participant H as HF S3
    T->>V: POST /api/generation-runs
    V->>D: insert generation_runs (queued)
    V-->>T: 202 {runId}
    C->>D: claim run (lease 120 s)
    C->>C: outline → scene → teks
    C->>D: tulis stage doc + placeholder media
    C->>D: enqueue worker_jobs(course.media)
    C->>D: run = waiting_media
    K->>D: claim worker_jobs(course.media)
    K->>K: SDXL / VoxCPM / FunASR
    K->>H: upload assets (content hash)
    K->>D: update stage doc + asset rows
    K->>D: complete job; run = succeeded
    T->>V: GET /api/generation-runs/:id/events
    V-->>T: SSE/polling status
```

**Fallback:** jika Colab tidak tersedia, Kaggle boleh menjalankan seluruh run (teks + media) dengan `WORKER_KINDS=course.generate,course.media`. Jika Kaggle tidak tersedia, job tetap queued; UI menampilkan "Menunggu worker GPU".

### 5.4 Alur playback

1. Browser memuat stage document dari `/api/stages/:id`.
2. Stage document berisi referensi `ast_...` (bukan URL publik permanen).
3. `/api/assets/:id` memeriksa owner, lalu:
   - `ASSET_BYTE_EGRESS=redirect`: 302 ke presigned HF S3 (TTL ≤10 menit), atau
   - `ASSET_BYTE_EGRESS=direct`: stream bytes (hanya untuk file kecil).
4. Cloudflare meng-cache `/_next/static/*` dan aset publik; `/api/*` bypass cache.
5. Android WebView memakai URL yang sama; tidak ada jalur media kedua.

### 5.5 State machine job

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> leased: claim (SKIP LOCKED)
    leased --> running: worker mulai
    running --> succeeded: hasil + upload selesai
    running --> failed: error permanen
    running --> queued: lease habis / retry < 3
    running --> dead: retry habis
    leased --> queued: lease habis
    queued --> cancelled: admin/user batal
    running --> cancelled: cancel_requested
    dead --> queued: admin requeue
    succeeded --> [*]
    failed --> [*]
    cancelled --> [*]
```

**Aturan:**

- Lease default 120 s; heartbeat setiap 30 s; lease habis → job kembali `queued` dengan `attempts += 1`.
- `attempts >= max_attempts` → `dead`; admin dapat requeue.
- Worker wajib memeriksa `cancel_requested` di antara langkah.
- `idempotency_key` unik mencegah duplikat saat retry.
- Worker menulis aset dengan nama content-hash; upload ulang tidak menggandakan objek.

---

## 6. Perubahan produk dan teknis

### 6.1 Web tier Vercel

**Wajib:**

- `next.config.ts`: `output: 'standalone'` hanya untuk non-Vercel; di Vercel biarkan default.
- Jangan jalankan `startGenerationRunner()` di Vercel. Tambah flag server `OPENMAIC_GENERATION_RUNNER_ENABLED` (default `true`; Vercel `false`).
- Jangan jalankan agent runtime di Vercel fase 1 (`OPENMAIC_AGENT_RUNTIME_ENABLED=false`).
- Pindahkan `/docs` ke Cloudflare Pages; set `NEXT_PUBLIC_DOCS_URL`. Jika tetap di Vercel, `public/docs-site` harus di-trace dan build docs ikut build — tidak disarankan.
- Hapus ketergantungan `classroom-media` pada disk: migrasikan media lama ke HF S3; route mengembalikan 404 yang jelas untuk media yang tidak ada.
- Pastikan `outputFileTracingIncludes` mencakup prompt/skills yang dibaca via `fs`; uji dengan `vercel build` lalu jalankan preview.
- Set `maxDuration = 300` hanya pada route SSE; route lain tetap pendek.
- Gunakan `export const dynamic = 'force-dynamic'` hanya di route yang memang butuh; halaman publik di-cache/ISR.

**Build:**

- Vercel build command: `bun install --frozen-lockfile && bun run build:packages && bun run build` dengan `NODE_OPTIONS=--max-old-space-size=6144`.
- Jangan jalankan `build:docs` di Vercel.
- Pastikan `public/vendor` dan `public/avatars` ikut; ukurannya kecil (±5,5 MB total).
- `OPENMAIC_SKIP_TYPECHECK=1` hanya untuk preview cepat; produksi tetap typecheck di CI.

**Batasan:**

- 4 CPU-jam/bulan: hindari SSR per request untuk halaman publik; gunakan static/ISR.
- 100 GB transfer: media harus dari HF S3.
- 300 s: SSE harus reconnect; jangan mengandalkan satu koneksi panjang.

### 6.2 Job queue dan protokol worker

**Tabel `worker_jobs`:**

```sql
create table if not exists worker_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  owner_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','leased','running','succeeded','failed','dead','cancelled')),
  priority int not null default 100,
  attempts int not null default 0,
  max_attempts int not null default 3,
  idempotency_key text not null unique,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  cancel_requested boolean not null default false,
  result jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists worker_jobs_claim_idx
  on worker_jobs (status, priority, next_attempt_at, created_at)
  where status = 'queued';

create index if not exists worker_jobs_lease_idx
  on worker_jobs (lease_expires_at)
  where status in ('leased','running');
```

**RPC klaim:**

```sql
create or replace function claim_worker_job(
  p_worker_id text,
  p_kinds text[],
  p_lease_seconds int default 120
) returns setof worker_jobs
language plpgsql
security definer
as $$
begin
  return query
  with candidate as (
    select id from worker_jobs
    where status = 'queued'
      and kind = any(p_kinds)
      and next_attempt_at <= now()
    order by priority asc, created_at asc
    for update skip locked
    limit 1
  )
  update worker_jobs j
     set status = 'leased',
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = attempts + 1,
         started_at = coalesce(started_at, now()),
         updated_at = now()
    from candidate c
   where j.id = c.id
  returning j.*;
end;
$$;
```

**RPC lain:** `heartbeat_worker_job(id, worker_id, lease_seconds)`, `complete_worker_job(id, worker_id, result)`, `fail_worker_job(id, worker_id, code, message)`, `reap_worker_jobs()` (kembalikan lease kedaluwarsa ke `queued`/`dead`), `register_worker(...)`.

**Tabel `worker_heartbeats`:**

```sql
create table if not exists worker_heartbeats (
  worker_id text primary key,
  kind text not null,
  host text,
  gpu text,
  version text,
  last_seen_at timestamptz not null default now()
);
```

**Aturan:**

- Worker memakai role Postgres terpisah `kelaska_worker`, bukan `service_role`.
- Role hanya boleh `execute` RPC di atas, `select/insert` ke `worker_heartbeats`, dan `select/update` kolom terbatas pada `assets`/`stages` lewat RPC. Tidak ada akses ke `auth_users`, `auth_sessions`, atau `workspace_model_config`.
- Jangan menaruh `SUPABASE_SERVICE_ROLE_KEY` di notebook. Jika terpaksa, gunakan token per-worker yang bisa dicabut, bukan service role.
- Worker wajib idempoten: kunci `idempotency_key`, nama objek content-hash, dan `ON CONFLICT DO NOTHING`.

### 6.3 Colab course worker

**Tugas:** menjalankan `course.generate` (teks) dan menulis stage document dengan placeholder media.

**Isi notebook (ringkas):**

```bash
# 1. clone versi yang dipin
git clone --depth 1 --branch v1.5.0-rc.3 https://github.com/ade-karya/KelasKA.git
cd KelasKA
bun install --frozen-lockfile

# 2. secret dari Colab Secrets (jangan print)
export WORKER_DATABASE_URL="postgres://kelaska_worker:...@...pooler.supabase.com:6543/postgres?sslmode=require"
export WORKER_ID="colab-$(date +%s)"
export WORKER_KINDS="course.generate"
export GOOGLE_API_KEY="..."
export HF_S3_BUCKET="kelaska"
export HF_S3_ENDPOINT="https://s3.hf.co/<namespace>"
export HF_S3_REGION="us-east-1"
export HF_S3_ACCESS_KEY_ID="..."
export HF_S3_SECRET_ACCESS_KEY="..."

# 3. jalankan worker
bun run worker:course
```

**Perilaku:**

- Registrasi heartbeat, lalu loop klaim → eksekusi → heartbeat → selesai.
- Batas runtime 11 jam; sebelum keluar, lepaskan lease dan requeue job yang belum selesai.
- Tangani `SIGINT`/`SIGTERM` untuk checkpoint.
- Jangan menulis media ke disk permanen; media adalah job terpisah.
- Tampilkan progress sederhana di output notebook (job id, langkah, durasi).

**ToS:** notebook dijalankan manusia, bukan web service otonom. Jangan mengekspos port, jangan SSH, jangan menjalankan worker setelah sesi ditinggalkan. Dokumentasikan bahwa ini alat batch operator.

### 6.4 Kaggle GPU media worker

**Tugas:** menjalankan `course.media` (gambar/TTS/ASR/video) dengan layanan lokal.

**Isi notebook (ringkas):**

```bash
git clone --depth 1 --branch v1.5.0-rc.3 https://github.com/ade-karya/KelasKA.git
cd KelasKA
bash scripts/gpu-services.sh --gpu-dir=/kaggle/temp/gpu-models --skip ollama
bun install --frozen-lockfile

export WORKER_DATABASE_URL="postgres://kelaska_worker:...@...pooler.supabase.com:6543/postgres?sslmode=require"
export WORKER_ID="kaggle-$(date +%s)"
export WORKER_KINDS="course.media"
export COMFYUI_BASE_URL="http://127.0.0.1:8188"
export VOXCPM_BASE_URL="http://127.0.0.1:8001"
export FUNASR_BASE_URL="http://127.0.0.1:8000"
export HF_S3_*="..."

bun run worker:media
```

**Perilaku:**

- Tunggu health check ComfyUI/VoxCPM/FunASR sebelum klaim job.
- Klaim satu job pada satu waktu (GPU serial); heartbeat tetap jalan.
- Upload hasil ke HF S3; hapus file sementara setelah sukses.
- Jika sesi mendekati 12 jam, berhenti klaim baru dan selesaikan job aktif.
- Jika GPU OOM, `fail_worker_job` dengan kode `GPU_OOM`; jangan retry tanpa mengurangi resolusi/batch.

**Catatan GPU:** T4 15 GB; SDXL ~7 GiB idle, ~10,4 GiB saat sampling; VoxCPM ~10,9 GiB. Jangan menjalankan Ollama di kartu yang sama. ComfyUI di GPU 0, TTS/ASR di GPU 1 jika tersedia.

### 6.5 Penyimpanan HF S3

**Konfigurasi:**

```dotenv
HF_S3_BUCKET=kelaska
HF_S3_ENDPOINT=https://s3.hf.co/<namespace>
HF_S3_REGION=us-east-1
HF_S3_ACCESS_KEY_ID=...
HF_S3_SECRET_ACCESS_KEY=...
ASSET_BYTE_EGRESS=redirect
```

**Tata letak objek:**

```
assets/<sha256>.<ext>            # media kursus, content-addressed
materials/<owner>/<sha256>       # sumber upload
exports/<stage>/<sha256>.zip     # ekspor
backups/<yyyy-mm-dd>/dump.sql.gz # pg_dump terenkripsi
pending/<owner>/<uuid>           # TTL 7 hari
```

**Aturan:**

- Bucket privat; tidak ada URL publik permanen.
- Presigned GET TTL ≤10 menit; `Content-Disposition` disesuaikan.
- CORS: `https://kelaska.riau.ai`, `https://docs.kelaska.riau.ai`; methods GET/HEAD; expose `Content-Type`, `Content-Length`, `ETag`.
- `ASSET_BYTE_EGRESS=redirect` membutuhkan `s3:ListBucket` agar objek hilang menjawab 404, bukan 403.
- Lifecycle: `pending/` 7 hari, `exports/` 90 hari, `backups/` 30 hari.
- Monitor kuota harian; alert 80 GB.
- Jangan menyimpan data pribadi di nama objek; gunakan hash.

### 6.6 Auth dan akun

- `AUTH_ENABLED=true`; Google provider aktif di Supabase.
- Redirect URL `https://kelaska.riau.ai/api/auth/supabase/callback` terdaftar persis (tanpa query).
- `AUTH_ADMIN_EMAILS` diisi minimal satu admin; akun baru `pending` sampai disetujui.
- Role dibaca dari database; jangan menaruh role di cookie.
- **BYOK gate:** dengan `AUTH_ENABLED`, akun tanpa key chat terverifikasi akan diarahkan ke `/onboarding/api-key` atau mendapat `403 API_KEY_REQUIRED`. Untuk deployment sekolah, pilih salah satu:
  - (a) tandai akun siswa `api_key_exempt=true` dan pakai key operator; atau
  - (b) sediakan key bersama lewat provider workspace dan verifikasi sekali.
  Jangan meminta siswa membawa key pribadi kecuali memang itu kebijakannya.
- Sesi disimpan sebagai hash; revoke = hapus baris `auth_sessions` (langsung berlaku meski cookie masih valid secara tanda tangan).
- Jangan mengaktifkan `AUTH_ENABLED` tanpa Supabase URL + publishable key + provider Google aktif; jika tidak, tidak ada pintu masuk.

### 6.7 Progress dan realtime

**Fase 1 (Vercel):**

- `GET /api/generation-runs/:id/events` memakai SSE dengan fallback polling 5 s; Vercel memutus di 300 s, `EventSource` reconnect dengan `Last-Event-ID`.
- `GET /api/generation-runs/:id` untuk snapshot.
- UI menampilkan status: `queued`, `leased`, `running`, `waiting_media`, `succeeded`, `failed`, `dead`.
- Jika worker offline: tampilkan "Menunggu worker" + `last_seen_at` worker.

**Fase 2:**

- Mint Supabase JWT untuk sesi aplikasi, lalu subscribe Realtime ke `generation_runs`/`worker_jobs` dengan RLS.
- Batas 200 koneksi: fallback polling tetap ada.
- Jangan mengandalkan Realtime untuk status akhir; database adalah sumber kebenaran.

### 6.8 Feature scoping di Vercel

| Fitur | Fase 1 Vercel | Fase 2 | Catatan |
|---|---|---|---|
| Login, library, playback | ✅ | ✅ | Inti |
| Classic generation (teks) | ✅ via Colab | ✅ | Runner tidak di Vercel |
| Media gambar/audio | ✅ via Kaggle | ✅ | HF S3 |
| Admin | ✅ | ✅ | |
| PBL v3 | ❌ | ⚠️ via E2B | Sandbox lokal tidak ada di Vercel; E2B berbayar |
| Agent workbench | ❌ | ⚠️ | Butuh LISTEN/SSE panjang; fase 2 |
| Video export | ❌ | ⚠️ | Butuh Chromium/ffmpeg; jalankan di worker |
| Docs `/docs` | ❌ | ✅ | Cloudflare Pages |
| Android | ✅ | ✅ | `BASE_URL` tetap |

**Gate yang perlu ditambah:**

- `OPENMAIC_GENERATION_RUNNER_ENABLED` (server, default true).
- `NEXT_PUBLIC_PBL_V3_ENABLED` atau gate server untuk route `/api/pbl/v3/*` dan halaman PBL.
- `NEXT_PUBLIC_VIDEO_EXPORT` sudah ada; biarkan off.
- `NEXT_PUBLIC_WORKBENCH_ENABLED` off.

### 6.9 Cloudflare edge dan cron

**DNS:**

| Nama | Tipe | Target | Proxy |
|---|---|---|---|
| `kelaska` | CNAME | `cname.vercel-dns.com` | Ya |
| `docs` | CNAME | `*.pages.dev` | Ya |
| `status` | CNAME | `*.pages.dev` | Ya |

**Cron Worker `kelaska-maintenance`:**

- Setiap 5 menit: panggil RPC `reap_worker_jobs()` dan `ping` database.
- Setiap hari: panggil endpoint keep-alive Supabase (mencegah pause) dan cek kuota.
- Setiap jam: cek worker heartbeat; jika tidak ada worker online > 30 menit pada jam sekolah, kirim alert.
- 10 ms CPU cukup: `fetch` tidak dihitung CPU; parsing JSON kecil.
- Rahasia: `CRON_SECRET` di Worker secret; RPC memakai koneksi Postgres terbatas atau endpoint Vercel internal yang memverifikasi secret.

**Cache rules:**

- Bypass cache: `/api/*`, `/login`, `/admin`, `/workspace`, cookie `kelaska_session`.
- Cache: `/_next/static/*` (immutable, 1 tahun), `public/*` (1 hari), `docs-site/*` (1 jam).
- Jangan cache HTML yang berisi data owner.

**WAF/rate limit:**

- Rate limit `/api/auth/*` 10/menit/IP.
- Rate limit `/api/generation-runs` 5/menit/user.
- Block request body > 100 MB (Cloudflare free limit).
- Bot Fight Mode on.

### 6.10 CI/CD dan migrasi

**Pipeline:**

1. `bun install --frozen-lockfile`
2. `bun run check` (prettier) + `bun run lint`
3. `bun run test` (subset cepat; suite penuh nightly)
4. `bun run build` dengan `NODE_OPTIONS=--max-old-space-size=6144`
5. Migrasi DB: `bun scripts/bootstrap-db-schema.mts` dengan `MIGRATION_DATABASE_URL` (session mode), sebelum deploy.
6. Deploy Vercel: `vercel deploy --prod --token=$VERCEL_TOKEN`.
7. Deploy docs: `bash scripts/build-docs.sh` → `wrangler pages deploy public/docs-site`.
8. Smoke test: login, buat job dummy, cek queue, buka kursus contoh.

**Aturan migrasi:**

- Expand/contract: tambah kolom/tabel dulu, deploy kode, hapus lama setelah dua rilis.
- Jangan menjalankan migrasi dari cold start Vercel; lakukan di CI.
- Backup sebelum migrasi: `pg_dump` ke HF S3.
- Rollback Vercel: instant rollback ke deployment sebelumnya; rollback DB hanya jika migrasi aditif.

---

## 7. Kebutuhan fungsional

Prioritas: **P0** wajib fase 1; **P1** penting; **P2** nanti.

| ID | Kebutuhan | Prioritas | Kriteria terima |
|---|---|---|---|
| FR-01 | Login Google via Supabase | P0 | Akun aktif masuk; pending diarahkan ke `/login?error=pending` |
| FR-02 | Setiap akun hanya melihat kursus miliknya | P0 | Uji IDOR: akun B tidak bisa membaca/menghapus kursus A |
| FR-03 | Admin menyetujui/menolak akun dan mengubah role | P0 | Perubahan role berlaku pada request berikutnya |
| FR-04 | Guru membuat kelas dari UI | P0 | Job dibuat, status `queued`, `runId` dikembalikan |
| FR-05 | Colab worker mengerjakan teks | P0 | Stage doc terisi outline/scene/teks; job selesai |
| FR-06 | Kaggle worker mengerjakan media | P0 | Gambar/audio tersimpan di HF S3; stage doc berisi `ast_` id |
| FR-07 | Progress terlihat tanpa refresh | P0 | SSE/polling menampilkan status dan langkah |
| FR-08 | Worker offline tidak menghilangkan job | P0 | Job tetap `queued`; UI menjelaskan; worker berikutnya melanjutkan |
| FR-09 | Retry otomatis dan dead-letter | P0 | Job gagal 3× menjadi `dead`; admin bisa requeue |
| FR-10 | Idempotensi media | P0 | Retry tidak menggandakan objek/asset |
| FR-11 | Playback media dari HF S3 | P0 | Presigned URL ≤10 menit; audio/gambar tampil |
| FR-12 | Admin melihat status worker | P1 | `last_seen_at`, kind, host, GPU |
| FR-13 | Admin requeue/cancel job | P1 | Job kembali `queued`/`cancelled` |
| FR-14 | Ekspor kursus (ZIP/HTML) | P1 | File di HF S3, tautan unduh |
| FR-15 | PBL v3 via remote sandbox | P2 | E2B-compatible; tanpa sandbox lokal |
| FR-16 | Agent workbench | P2 | Hanya jika SSE/LISTEN diganti polling/Realtime |
| FR-17 | Video export | P2 | Dijalankan di worker GPU, bukan Vercel |
| FR-18 | Docs terpisah | P1 | `docs.kelaska.riau.ai` live |
| FR-19 | Status page | P2 | `status.kelaska.riau.ai` |
| FR-20 | Audit admin | P1 | Setiap approve/role/requeue tercatat |

---

## 8. Kebutuhan non-fungsional

### 8.1 Performa

- Halaman publik: static/ISR, TTFB ≤ 500 ms di Indonesia (region `sin1`).
- Halaman kelas: LCP ≤ 2,5 s di 4G; media di-lazy-load.
- API baca: p95 ≤ 400 ms; API tulis: p95 ≤ 800 ms.
- SSE: heartbeat 25 s; reconnect otomatis; tidak ada kebocoran koneksi.
- Queue: klaim job ≤ 2 s setelah worker idle; heartbeat ≤ 30 s.

### 8.2 Keandalan

- Tidak ada kehilangan job saat worker mati: lease + retry + idempotency.
- Tidak ada kehilangan data saat Vercel deploy: DB eksternal, bukan disk fungsi.
- Backup harian; restore drill bulanan; RPO ≤ 24 jam, RTO ≤ 4 jam untuk pilot.
- Degradasi graceful: jika HF S3 down, tampilkan placeholder dan retry; jika Gemini down, job `failed` dengan pesan yang bisa ditindaklanjuti.
- Status page manual saat insiden.

### 8.3 Keamanan

- Semua traffic HTTPS; HSTS; TLS ≥1.2.
- Cookie `HttpOnly`, `Secure`, `SameSite=Lax`; rotasi `OPENMAIC_SECRET_KEY` terdokumentasi.
- Tidak ada service role key di klien/notebook; worker role least privilege.
- Presigned URL pendek; jangan log URL.
- Validasi URL media lewat URL guard yang ada; tolak SSRF.
- Rate limit auth dan generation.
- Secret scanning di CI; dependabot/renovate.
- Audit admin dan akses lintas owner.

### 8.4 Privasi dan kepatuhan

- Data pribadi minimum: email, nama, role, progres belajar.
- Data residency: Supabase Singapore, Vercel `sin1`, HF S3 US/EU. Jika kebijakan mewajibkan data di Indonesia, stack ini **tidak memenuhi**; alternatif: Postgres + MinIO on-prem dan GPU lokal.
- UU PDP No. 27/2022: basis hukum, retensi, hak akses/hapus, DPA dengan vendor.
- Jangan menyimpan nilai/sertifikat resmi di pilot tanpa persetujuan.
- Hapus akun = hapus/anonimkan data pribadi; kursus dapat diarsipkan.
- Retensi: job 30 hari, event 7 hari, backup 30 hari, kursus sampai dihapus owner/admin.

### 8.5 Operasional

- Satu orang operator harus bisa: deploy, start/stop worker, requeue job, restore backup, rotate secret.
- Semua runbook ada di §13.
- Alert ke email/WhatsApp operator; status page manual.
- Log terpusat minimal: Vercel log + Supabase log + worker stdout ke file/objek.

### 8.6 Biaya

- Pilot: Rp0–150 ribu/bulan di luar domain dan Gemini.
- Ambang upgrade: Vercel 80% CPU-jam, Supabase 80% DB, HF 80 GB, Gemini 80% RPD.
- Jangan memakai beberapa akun gratis untuk menghindari batas; itu pelanggaran ToS.

---

## 9. Model data

### 9.1 Tabel yang sudah ada (dipakai)

| Tabel | Isi | Catatan |
|---|---|---|
| `stages` | Dokumen kursus (JSONB) | Sumber kebenaran konten |
| `generation_runs` | Run pembuatan kelas | Status, lease, error |
| `generation_run_events` | Event run | SSE/backfill |
| `assets` | Metadata aset | `ast_` id, hash, MIME, owner |
| `auth_users` | Akun | Role, `active`, `api_key_exempt` |
| `auth_sessions` | Sesi | Hash cookie, revoke |
| `workspace_model_config` | Konfigurasi model | Provider/slot |
| `owner_material` | Materi sumber | Ekstraksi, asset id |

### 9.2 Tabel baru

- `worker_jobs` (§6.2)
- `worker_heartbeats` (§6.2)
- `worker_audit` (opsional): `id`, `worker_id`, `job_id`, `action`, `detail jsonb`, `created_at`.
- `app_events` (opsional): log aplikasi penting untuk observability tanpa vendor.

### 9.3 Indeks dan retensi

- `worker_jobs_claim_idx`, `worker_jobs_lease_idx`.
- `generation_runs (owner_id, created_at desc)`.
- `assets (owner_id, created_at desc)`.
- Job selesai >30 hari dihapus; event >7 hari dihapus; backup >30 hari dihapus.
- Partisi `worker_jobs` per bulan jika >1 juta baris (belum perlu di pilot).

### 9.4 RLS/role

- Aplikasi memakai koneksi server dengan owner scoping di query (seperti sekarang).
- Worker memakai role `kelaska_worker`; hanya RPC dan tabel heartbeat.
- Jangan memberi worker akses `auth_users`/`auth_sessions`.
- Jika memakai Supabase client langsung, aktifkan RLS dan policy per owner; tetapi arsitektur ini tetap memakai API server, bukan Supabase client di browser.

---

## 10. Kontrak API

### 10.1 Publik/aplikasi

| Method | Path | Fungsi | Catatan |
|---|---|---|---|
| POST | `/api/generation-runs` | Mulai pembuatan kelas | 202 + `runId`; cek kuota/owner |
| GET | `/api/generation-runs/:id` | Snapshot status | Owner-scoped |
| GET | `/api/generation-runs/:id/events` | SSE progress | `Last-Event-ID`; 300 s |
| GET | `/api/stages/:id` | Dokumen kursus | Sanitasi HTML |
| GET | `/api/assets/:id` | Byte aset | 302 presign atau stream |
| GET | `/api/health` | Health | Anonim: `{success:true,status:"ok"}` |
| POST | `/api/auth/native/session` | Sesi Android | Verifikasi Supabase token |
| GET | `/api/admin/users` | Daftar akun | Admin |
| PATCH | `/api/admin/users/:id` | Approve/role | Admin |

### 10.2 Internal

| Method | Path | Fungsi | Proteksi |
|---|---|---|---|
| POST | `/api/internal/jobs/reap` | Requeue lease kedaluwarsa | `CRON_SECRET` + IP Cloudflare |
| GET | `/api/internal/workers` | Status worker | Admin/session |
| POST | `/api/admin/jobs/:id/requeue` | Requeue manual | Admin |
| POST | `/api/admin/jobs/:id/cancel` | Cancel | Admin |

### 10.3 Contoh payload job

```json
{
  "kind": "course.media",
  "ownerId": "user_123",
  "idempotencyKey": "sha256:...",
  "payload": {
    "stageId": "stage_abc",
    "runId": "run_xyz",
    "media": [
      { "type": "image", "prompt": "...", "width": 1280, "height": 720 },
      { "type": "tts", "text": "...", "voice": "..." }
    ]
  }
}
```

### 10.4 Kontrak worker

- `register_worker(worker_id, kind, host, gpu, version)` → heartbeat.
- `claim_worker_job(worker_id, kinds, lease_seconds)` → job atau kosong.
- `heartbeat_worker_job(job_id, worker_id, lease_seconds)` → boolean.
- `complete_worker_job(job_id, worker_id, result)` → boolean.
- `fail_worker_job(job_id, worker_id, code, message)` → boolean.
- Semua idempoten; worker harus menangani `false` (lease hilang) dengan berhenti, bukan menulis.

---

## 11. UX dan status

### 11.1 Status yang terlihat pengguna

| Status | Teks UI | Aksi |
|---|---|---|
| `queued` | "Menunggu worker" | Tampilkan estimasi; admin bisa cek worker |
| `leased` | "Disiapkan" | — |
| `running` | "Membuat kelas…" + langkah | Progress bar |
| `waiting_media` | "Membuat media…" | Progress media |
| `succeeded` | "Kelas siap" | Buka kelas |
| `failed` | "Gagal: <alasan>" | Coba lagi / hubungi admin |
| `dead` | "Gagal permanen" | Admin requeue |
| `cancelled` | "Dibatalkan" | — |

### 11.2 Empty/offline states

- Tidak ada worker: banner "Worker sedang offline. Kelas akan diproses saat worker aktif." + `last_seen_at`.
- Kuota Gemini habis: "Kuota model habis; coba lagi nanti atau hubungi admin."
- HF S3 gagal: media placeholder + retry; jangan blokir seluruh kelas.
- Supabase pause: halaman error 503 dengan tautan status.

### 11.3 Mobile

- 390 px: kartu kursus, tombol buat, status job tetap terbaca.
- Android WebView: tidak ada perubahan kontrak; `BASE_URL` tetap.
- Jangan memuat media berat di halaman daftar; poster/thumbnail saja.

---

## 12. Keamanan, privasi, dan kepatuhan

### 12.1 Threat model ringkas

| Ancaman | Dampak | Mitigasi |
|---|---|---|
| IDOR kursus/aset | Data lintas owner bocor | Owner scoping di setiap query; uji matriks |
| Service role bocor dari notebook | Seluruh DB dapat diakses | Worker role least privilege; rotasi; secret scanning |
| Presigned URL dibagikan | Media dapat diunduh di luar aplikasi | TTL pendek; jangan log; consider signed cookie |
| SSRF lewat URL media | Server menjelajah jaringan internal | URL guard; allowlist; tolak redirect |
| Prompt injection | Konten berbahaya di slide | Sanitasi HTML; CSP; renderer aman |
| Supply chain | Paket berbahaya | Lockfile; audit; dependabot |
| Akun Google palsu | Spam/pending | Approval admin; domain allowlist opsional |
| Worker menyamar | Job dicuri/diubah | Token/role per worker; lease owner check |
| Backup bocor | Data pribadi | Enkripsi sebelum upload; bucket privat |

### 12.2 Secret

- Vercel: environment variables (encrypted), production/preview terpisah.
- GitHub Actions: secrets, bukan file.
- Supabase: service role hanya di server Vercel; jangan di klien.
- Colab/Kaggle: Secrets, jangan print; hapus setelah sesi.
- Rotasi: `OPENMAIC_SECRET_KEY`, HF token, DB worker password setiap 90 hari atau saat insiden.
- `OPENMAIC_SECRET_KEY` harus stabil di semua instance web; jika berubah, semua sesi keluar.

### 12.3 Kepatuhan

- **UU PDP:** inventaris data, dasar pemrosesan, retensi, hak subjek, DPA vendor.
- **Residensi:** lihat §8.4. Jika wajib di Indonesia, hentikan Opsi B dan rancang on-prem.
- **Anak-anak:** jika pengguna di bawah umur, perlu persetujuan orang tua/sekolah; jangan meminta data berlebih.
- **Audit:** simpan log approve/role/requeue minimal 1 tahun.
- **Transparansi:** status page dan kebijakan privasi di `kelaska.riau.ai/privacy`.

---

## 13. Operasi dan runbook

### 13.1 Deploy web (Vercel)

```bash
# sekali
vercel link
vercel env pull .env.vercel.local

# setiap rilis
bun install --frozen-lockfile
bun run check
bun run build
vercel deploy --prod
```

**Verifikasi:**

- `curl -s https://kelaska.riau.ai/api/health` → 200 `{success:true,status:"ok"}`.
- Login Google → kembali ke `/`.
- Buka kursus contoh → gambar/audio tampil.
- Cek `vercel logs` tidak ada error 500.

### 13.2 Migrasi database

```bash
export MIGRATION_DATABASE_URL="postgres://postgres.<ref>:...@...pooler.supabase.com:5432/postgres?sslmode=require"
pg_dump "$MIGRATION_DATABASE_URL" | gzip | age -r <pubkey> > backup-$(date +%F).sql.gz
bun scripts/bootstrap-db-schema.mts
```

**Catatan:** gunakan session mode 5432 untuk migrasi; transaction mode 6543 untuk worker.

### 13.3 Start worker Colab

1. Buka notebook `KelasKA_Colab_Worker.ipynb`.
2. Isi Secrets: `WORKER_DATABASE_URL`, `GOOGLE_API_KEY`, `HF_S3_*`.
3. Jalankan sel setup (clone + install).
4. Jalankan sel worker; biarkan tab terbuka.
5. Pantau `worker_heartbeats` dan queue depth.
6. Sebelum sesi berakhir, hentikan worker dengan `Ctrl+C` (graceful) agar lease dilepas.

### 13.4 Start worker Kaggle

1. Buat notebook baru, aktifkan GPU T4×2 dan Internet.
2. Jalankan `scripts/gpu-services.sh --gpu-dir=/kaggle/temp/gpu-models --skip ollama`.
3. Tunggu health check `:8188`, `:8001`, `:8000`.
4. Set Secrets dan jalankan `bun run worker:media`.
5. Pantau VRAM (`nvidia-smi`), suhu, dan queue.
6. Hentikan sebelum 12 jam; jangan menunggu sesi diputus.

### 13.5 Requeue job macet

```sql
-- lease kedaluwarsa
select reap_worker_jobs();

-- job tertentu
select * from worker_jobs where status in ('leased','running') and lease_expires_at < now();
update worker_jobs
   set status='queued', lease_owner=null, lease_expires_at=null, next_attempt_at=now()
 where id='<job-id>' and status in ('leased','running');
```

**Via UI:** Admin → Job → Requeue.

### 13.6 Restore backup

```bash
age -d -i ~/.config/kelaska/age.key backup-2026-11-20.sql.gz | gunzip | psql "$STAGING_DATABASE_URL"
```

Verifikasi: login staging, buka kursus, cek media. Jangan restore ke produksi tanpa persetujuan.

### 13.7 Rotasi secret

1. Buat nilai baru.
2. Update Vercel env + worker secret.
3. Deploy/restart.
4. Cabut nilai lama setelah 24 jam.
5. Catat di changelog operasi.

### 13.8 Insiden

| Gejala | Cek | Tindakan |
|---|---|---|
| Situs 500 | Vercel logs, Supabase status | Rollback deployment; cek DB |
| Login gagal | Supabase Auth, redirect URL | Perbaiki URL; cek Google provider |
| Job menumpuk | `worker_heartbeats`, queue depth | Start worker; requeue; cek Gemini |
| Media 404 | HF S3, presign, CORS | Cek kredensial; regenerate URL |
| Supabase pause | Dashboard | Resume; jalankan keep-alive |
| Kuota Vercel habis | Dashboard usage | Upgrade Pro atau matikan fitur berat |
| Worker OOM | `nvidia-smi`, log | Turunkan resolusi/batch; restart |

---

## 14. Biaya dan kapasitas

### 14.1 Asumsi kursus

| Item | Asumsi |
|---|---|
| Slide | 15–25 |
| Gambar | 8–12 (SDXL 1280×720) |
| Audio | 6–10 menit (VoxCPM) |
| Video | 0–1 (opsional, fase 2) |
| Dokumen DB | 0,5–2 MB JSONB |
| Media HF | 30–80 MB |
| Panggilan LLM | 40–100 |
| GPU media | 15–30 menit |

### 14.2 Kapasitas free tier

| Sumber daya | Batas | Perkiraan kapasitas | Bottleneck |
|---|---|---|---|
| Supabase DB | 500 MB | 250–1.000 kursus | Ya, jika banyak kursus |
| Supabase egress | 5 GB/bln | 50.000–100.000 API call | Tidak untuk media |
| HF S3 | 100 GB | 1.250–3.000 kursus | Ya, jika video |
| Kaggle GPU | ±30 jam/mgg | 60–120 kursus/mgg | Ya, untuk media |
| Gemini | 500 RPD | 5–12 kursus/hari | **Bottleneck utama** |
| Vercel CPU | 4 jam/bln | 50.000–150.000 page render | Ya, jika SSR berat |
| Vercel transfer | 100 GB/bln | 20.000–50.000 sesi | Jika media lewat Vercel |
| Realtime | 200 koneksi | 200 pengguna aktif | Ya, jika semua SSE |

### 14.3 Biaya bulanan (estimasi)

| Skenario | Infra | Gemini | Total |
|---|---|---|---|
| Pilot 100 pengguna, 50 kursus/bln | Rp0 (semua free) | Rp0 (free tier) | ±Rp0 + domain |
| Tumbuh 1.000 pengguna, 500 kursus/bln | Vercel Pro $20 + Supabase Pro $25 + HF PRO $9 + Colab Pro $10 = $64 | $20–50 | ±$84–114 (±Rp1,3–1,8 juta) |
| Skala provinsi | VPS/container + GPU | Paid | Perlu perencanaan terpisah |

**Catatan:** harga dapat berubah; angka ini untuk anggaran kasar, bukan penawaran. Domain `.riau.ai` dan pajak tidak termasuk.

---

## 15. Rencana uji dan kriteria terima

### 15.1 Uji wajib

| Jenis | Cakupan | Alat |
|---|---|---|
| Unit | Queue RPC, lease, idempotency, owner scoping | Vitest |
| Integrasi | Supabase pooler, HF S3 presign, auth callback | Vitest + psql |
| E2E | Login → buat kelas → worker → playback | Playwright |
| Beban | 200 concurrent viewer, 20 job | k6/Artillery |
| Chaos | Worker mati, lease habis, HF 503, Supabase pause | Script |
| Keamanan | IDOR, presign expiry, secret scan, SSRF | Manual + tes |
| DR | Restore backup ke staging | Runbook |
| Mobile | 390 px, Android WebView | Playwright + APK |

### 15.2 Kriteria terima fase 1

- [ ] Login Google berhasil untuk akun aktif; akun pending ditolak dengan pesan jelas.
- [ ] Akun A tidak dapat membaca/menghapus kursus akun B (uji API + UI).
- [ ] Guru membuat kelas; job muncul `queued`; Colab mengerjakan teks; Kaggle mengerjakan media.
- [ ] Progress terlihat tanpa refresh; SSE reconnect setelah 300 s.
- [ ] Worker dimatikan di tengah job; job kembali `queued`; worker berikutnya menyelesaikan tanpa duplikat.
- [ ] Media tampil dari HF S3 via presigned URL; URL kedaluwarsa ≤10 menit.
- [ ] Tidak ada service role/HF token di bundle klien (`grep` + DevTools).
- [ ] Backup harian dibuat; restore ke staging berhasil; kursus dapat diputar.
- [ ] `curl /api/health` 200; halaman utama < 2,5 s p95.
- [ ] Alert 80% aktif untuk Vercel, Supabase, HF, Gemini.
- [ ] Docs live di `docs.kelaska.riau.ai`; status page tersedia.
- [ ] Android APK dapat login dan memutar kursus dari domain baru.
- [ ] Runbook §13 diuji oleh operator yang belum pernah deploy.

### 15.3 Uji regresi yang sudah ada

- `bun run test` (suite penuh) di CI nightly.
- `bun run test:e2e` untuk alur utama.
- `node scripts/check-i18n-keys.mjs` dan `node scripts/check-package-versions.mjs`.
- Pastikan `tests/server/identity/cookie-guard.test.ts` tetap lulus (proxy Vercel/Cloudflare).
- Pastikan `tests/persistence/admin-course-library.test.ts` tetap lulus (admin read-only).

---

## 16. Rollout dan milestone

| Milestone | Durasi | Deliverable | Exit criteria |
|---|---|---|---|
| M0 — Spike | 3 hari | Bukti Vercel build, Supabase session pooler, HF presign, Kaggle outbound | Semua spike lulus; estimasi biaya/risiko final |
| M1 — Jembatan produksi | 1–2 minggu | Opsi A live di `kelaska.riau.ai`; Supabase + HF S3; backup; alert | Pengguna dapat login dan membuat kelas |
| M2 — Worker extraction | 2–3 minggu | `worker:course`, `worker:media`, `worker_jobs`, RPC, UI status | Job teks + media selesai di staging |
| M3 — Cutover Vercel | 2–3 minggu | Web tier Vercel, runner off, SSE/polling, docs Pages, feature gates | Uji beban + E2E lulus; rollback diuji |
| M4 — Hardening | 1–2 minggu | DR drill, security review, runbook, handover | Kriteria terima §15.2 terpenuhi |

**Total:** 7–10 minggu dengan 1–2 engineer + 1 operator notebook.

**Urutan yang disarankan:**

1. M0 spike **sebelum** menulis kode worker; jika Vercel build gagal, hentikan Opsi B lebih awal.
2. M1 live untuk mengumpulkan data nyata (ukuran kursus, panggilan LLM, waktu GPU).
3. M2 di staging, dengan worker palsu (fake worker) untuk uji queue.
4. M3 cutover bertahap: 10% traffic → 50% → 100%, dengan rollback DNS.
5. M4 setelah dua minggu operasi stabil.

---

## 17. Risiko dan mitigasi

| ID | Risiko | Severity | Likelihood | Dampak | Mitigasi |
|---|---|---|---|---|---|
| R1 | Colab/Kaggle ToS melarang worker web-service | P1 | Tinggi | Akun dihentikan; produksi mati | Notebook operator; review legal; fallback VPS/GPU berbayar |
| R2 | Vercel Hobby dijeda karena kuota | P1 | Sedang | Situs mati | Alert 80%; upgrade Pro; rollback ke Opsi A |
| R3 | Supabase Free pause 7 hari | P1 | Sedang | Login/data mati | Cron keep-alive harian; upgrade Pro |
| R4 | Kuota Gemini habis | P1 | Tinggi | Pembuatan kelas gagal | Paid tier; queue + backoff; pesan jelas |
| R5 | Service role/DB worker bocor | P1 | Rendah | Data lintas owner bocor | Worker role least privilege; rotasi; audit |
| R6 | HF S3 down/rate limit | P1 | Sedang | Media 404 | Retry; cache; fallback R2/Supabase Storage |
| R7 | Residensi data tidak sesuai UU PDP | P1 | Sedang | Kepatuhan gagal | Kajian legal; opsi on-prem |
| R8 | DB 500 MB penuh | P2 | Sedang | Kursus baru gagal | Arsip ke HF S3; monitor; upgrade |
| R9 | Vercel 4 CPU-jam habis | P2 | Sedang | Halaman lambat/berhenti | Static/ISR; cache; upgrade |
| R10 | SSE terputus di 300 s | P2 | Tinggi | Progress tidak update | Reconnect `Last-Event-ID`; polling fallback |
| R11 | Build Vercel gagal (native module/tracing) | P2 | Sedang | Tidak bisa deploy | Spike M0; `serverExternalPackages`; uji preview |
| R12 | PBL v3 tidak jalan di Vercel | P2 | Tinggi | Fitur hilang | Gate off fase 1; E2B fase 2 |
| R13 | Agent workbench tidak jalan | P2 | Tinggi | Fitur hilang | Gate off; fase 2 |
| R14 | Video export tidak jalan | P2 | Tinggi | Fitur hilang | Worker GPU fase 2 |
| R15 | Android WebView media gagal | P2 | Rendah | Kelas senyap | Uji APK; URL presign; TTS host |
| R16 | Biaya tersembunyi (egress, paid tier) | P2 | Sedang | Anggaran membengkak | Dashboard kuota; alert; review bulanan |

**Risiko yang harus diputuskan sebelum coding:** R1, R5, R7. Jika salah satu tidak dapat diterima, Opsi B tidak layak; jalankan Opsi A.

---

## 18. Pertanyaan terbuka

1. Apakah layanan ini untuk publik umum, sekolah terdaftar, atau internal? Ini menentukan ToS Vercel dan kebutuhan approval.
2. Apakah ada kewajiban residensi data di Indonesia? Jika ya, Supabase Singapore/HF US-EU tidak memenuhi.
3. Siapa operator notebook Colab/Kaggle, dan pada jam berapa worker dinyalakan?
4. Berapa perkiraan pengguna aktif dan kursus/bulan pada 6 bulan pertama?
5. Apakah PBL v3 dan agent workbench harus ada di fase 1? Jika ya, Opsi B molor 3–4 minggu dan butuh E2B berbayar.
6. Apakah video export diperlukan di fase 1?
7. Apakah sekolah membawa key Gemini sendiri (BYOK) atau memakai key operator?
8. Apakah data lama dari host Colab harus dimigrasikan? Berapa ukurannya?
9. Apakah `docs.kelaska.riau.ai` dan `status.kelaska.riau.ai` disetujui untuk dipakai?
10. Apakah ada anggaran untuk Vercel Pro/Supabase Pro jika pilot tumbuh?

---

## 19. Lampiran

### 19.1 Matriks environment

**Vercel (web):**

```dotenv
DATABASE_URL=postgres://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres?sslmode=require
AUTH_ENABLED=true
AUTH_PUBLIC_URL=https://kelaska.riau.ai
AUTH_ADMIN_EMAILS=admin@dinas.belajar.id
OPENMAIC_SECRET_KEY=<32+ chars>
GOOGLE_API_KEY=<gemini key>
GOOGLE_MODELS=gemini-3.5-flash-lite
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable>
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable>
SUPABASE_SERVICE_ROLE_KEY=<server only>
HF_S3_BUCKET=kelaska
HF_S3_ENDPOINT=https://s3.hf.co/<namespace>
HF_S3_REGION=us-east-1
HF_S3_ACCESS_KEY_ID=<hf token id>
HF_S3_SECRET_ACCESS_KEY=<hf token secret>
ASSET_BYTE_EGRESS=redirect
OPENMAIC_GENERATION_RUNNER_ENABLED=false
OPENMAIC_AGENT_RUNTIME_ENABLED=false
NEXT_PUBLIC_WORKBENCH_ENABLED=false
NEXT_PUBLIC_DOCS_URL=https://docs.kelaska.riau.ai
```

**Worker (Colab/Kaggle):**

```dotenv
WORKER_DATABASE_URL=postgres://kelaska_worker:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres?sslmode=require
WORKER_ID=<unique>
WORKER_KINDS=course.generate,course.media
GOOGLE_API_KEY=<gemini key>
HF_S3_BUCKET=kelaska
HF_S3_ENDPOINT=https://s3.hf.co/<namespace>
HF_S3_REGION=us-east-1
HF_S3_ACCESS_KEY_ID=<hf token id>
HF_S3_SECRET_ACCESS_KEY=<hf token secret>
COMFYUI_BASE_URL=http://127.0.0.1:8188
VOXCPM_BASE_URL=http://127.0.0.1:8001
FUNASR_BASE_URL=http://127.0.0.1:8000
```

### 19.2 Perintah verifikasi cepat

```bash
# health anonim
curl -s https://kelaska.riau.ai/api/health

# redirect auth (harus kembali ke domain publik, bukan 0.0.0.0)
curl -s -o /dev/null -w '%{redirect_url}\n' https://kelaska.riau.ai/api/auth/supabase/callback

# queue
psql "$MIGRATION_DATABASE_URL" -c "select status, count(*) from worker_jobs group by 1 order by 1;"
psql "$MIGRATION_DATABASE_URL" -c "select worker_id, kind, last_seen_at from worker_heartbeats order by last_seen_at desc;"

# HF S3
aws s3 ls --endpoint-url "https://s3.hf.co/<namespace>" s3://kelaska/assets/ | head
```

### 19.3 Referensi

- Vercel Hobby plan: <https://vercel.com/docs/plans/hobby>
- Vercel fair use: <https://vercel.com/docs/limits/fair-use-guidelines>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Supabase billing/quotas: <https://supabase.com/docs/guides/platform/billing-on-supabase>
- Supabase project pausing: <https://supabase.com/docs/guides/platform/project-pausing>
- HF storage limits: <https://huggingface.co/docs/hub/storage-limits>
- Colab FAQ/resource limits: <https://research.google.com/colaboratory/faq.html>
- Kaggle GPU quotas: <https://www.kaggle.com/docs/efficient-gpu-usage>
- Repo README deployment: `README.md` §Vercel Deployment (up to 1.1.x)
- Repo env reference: `.env.example` (Supabase, HF S3, sandbox)
- Arsitektur diagram: `docs/prd/assets/arsitektur-produksi.svg`

### 19.4 Glosarium

| Istilah | Arti |
|---|---|
| Worker | Proses/notebook yang mengklaim dan mengeksekusi job dari queue |
| Lease | Hak sementara worker atas sebuah job; kedaluwarsa jika tidak heartbeat |
| Reaper | Proses yang mengembalikan job dengan lease kedaluwarsa ke antrean |
| Presigned URL | URL sementara bertanda tangan untuk membaca objek S3 |
| BYOK | Bring Your Own Key; akun membawa key model sendiri |
| E2B | Penyedia sandbox remote yang kompatibel dengan `SandboxService` |
| PBL v3 | Project-based learning dengan sandbox/terminal |
| SSE | Server-Sent Events; satu koneksi HTTP untuk progress |

---

## 20. Catatan penutup

Dokumen ini sengaja memisahkan **apa yang bisa dijalankan hari ini** dari **apa yang diminta**. Stack Vercel Hobby + Cloudflare Workers Free + Supabase Free + HF S3 Free + Colab + Kaggle bisa menjadi arsitektur produksi yang baik, tetapi bukan dengan memindahkan aplikasi apa adanya. Kuncinya adalah memindahkan generation runner dan media ke worker berbasis antrean, lalu menjaga web tier tetap tipis.

Jika keputusan yang diambil adalah "produksi sekarang, biaya nol", jalankan Opsi A. Jika keputusan adalah "Vercel Hobby adalah syarat", setujui scope fase 1 yang lebih kecil dan alokasikan 7–10 minggu untuk Opsi B. Jangan memilih jalan tengah yang menjalankan runner di Vercel: itu akan gagal pada run pertama yang lebih lama dari 300 detik.
