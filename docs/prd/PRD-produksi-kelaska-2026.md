# PRD — KelasKA Produksi 2026 (arsitektur on-demand)

**Produk:** Kelas Kecerdasan Artifisial (KelasKA)
**Dokumen:** Product Requirements Document untuk deployment produksi
**Versi:** 2.0 — diselaraskan dengan diagram arsitektur lampiran
**Tanggal:** 20 November 2026
**Domain:** `*.riau.ai` (`kelas-ka.riau.ai` sebagai entry point)
**Status:** Menunggu keputusan operasional (D1–D6 di §0.4)

![Arsitektur produksi KelasKA (mode on-demand)](assets/arsitektur-produksi.png)

> **Cara baca.** §0–§4 menjelaskan keputusan arsitektur dan alasan tidak melakukan big-bang. §5–§6 adalah rancangan teknis sesuai diagram lampiran. §7–§12 kebutuhan. §13–§17 operasi, biaya, uji, risiko. §19 lampiran environment dan branch deploy.

---

## 0. Ringkasan eksekutif

### 0.1 Permintaan

Produksi KelasKA memakai kombinasi:

- **Vercel Hobby** untuk UI Next.js 16 di `kelas-ka.riau.ai`.
- **Cloudflare Free** untuk DNS, SSL, Tunnel, Access, WAF, Worker gerbang (`api-kelas.riau.ai`), Worker media (`media-kelas.riau.ai`), dan Cron Worker.
- **Supabase Free** untuk Auth, antrean job, dan ringkasan.
- **HF S3 Free** untuk media dan backup `pg_dump`.
- **Colab** sebagai orkestrator LangGraph di `colab.riau.ai`, dengan **Postgres lokal untuk log + cache**.
- **Kaggle** untuk TTS, gambar, dan GPU multimedia di `gpu.riau.ai`.
- Pendukung: Cron Worker (cek job macet, jaga Supabase aktif), GitHub CI, Sentry.

**Klarifikasi penting dari pengguna:** Colab dan Kaggle **tidak digunakan 24/7**. Keduanya dinyalakan hanya ketika ada kebutuhan: membuat kelas, mengedit kelas, mengakses workspace, atau memakai GPU untuk multimedia. Ini mengubah model worker dari "server selalu-on" menjadi **batch on-demand yang dipicu permintaan**.

### 0.2 Temuan kritis

Aplikasi versi 1.2.0+ tidak bisa dipindah ke Vercel apa adanya:

1. **Generation runner berbasis proses** (`instrumentation.node.ts` → `startGenerationRunner()`) mengklaim `generation_runs` dengan lease. Function Vercel Hobby maksimal 300 detik; run yang lebih panjang akan terputus dan lease menggantung.
2. **Workers Free hanya 10 ms CPU/128 MB**. SSR Next.js tidak muat; Worker hanya cocok untuk routing tipis, media, dan cron.
3. **Colab/Kaggle tidak punya inbound dan bibar sesi.** Keduanya harus *pull* job dari antrean dan dinyalakan operator, bukan diakses seperti server.

README menyatakan serverless didukung hanya sampai 1.1.x dan `vercel.json` sudah tidak ada. Jadi ini adalah **refactor terarah**, bukan sekadar set environment.

### 0.3 Keputusan yang direkomendasikan

| | Opsi A — Jembatan | Opsi B — Target sesuai lampiran |
|---|---|---|
| Web | Proses Node panjang (PM2) | Vercel Hobby |
| Colab/Kaggle | Host tempat aplikasi berjalan | On-demand, dipicu antrean |
| Database | Supabase | Supabase + Postgres lokal (log/cache) |
| Edge | Cloudflare DNS/WAF | Cloudflare DNS/Tunnel/Access/Worker/Cron |
| Feature parity | Penuh hari ini | Core dulu; PBL v3/agent/video menyusul |
| Waktu | 1–2 minggu | 7–10 minggu |
| Risiko | Host tunggal | ToS notebook, batas Vercel, kompleksitas |

**Rekomendasi:** jalankan Opsi A sebagai jembatan produksi, bangun Opsi B di belakang flag, lalu cutover bertahap. Jangan menjalankan runner di Vercel.

### 0.4 Keputusan yang diminta

| ID | Keputusan | Pemilik | Tenggat |
|---|---|---|---|
| D1 | Setujui Opsi A sebagai jembatan pilot | Pemilik produk | Minggu 1 |
| D2 | Setujui target Opsi B dan alokasi 7–10 minggu | Produk + tech lead | Minggu 1 |
| D3 | Tetapkan jam operasional worker on-demand dan siapa yang menyalakan | Operasional sekolah | Minggu 1 |
| D4 | Setujui anggaran Gemini paid / Vercel Pro / Supabase Pro saat ambang terlampaui | Keuangan | Minggu 2 |
| D5 | Konfirmasi residensi data (UU PDP) | Legal/compliance | Minggu 2 |
| D6 | Setujui kebijakan BYOK: siswa bawa key atau key operator + `api_key_exempt` | Pemilik produk | Minggu 2 |

### 0.5 Definisi selesai

- Login Google berfungsi di `kelas-ka.riau.ai`; akun hanya melihat kursus miliknya.
- Guru membuat/mengedit kelas → job masuk antrean Supabase → operator menyalakan Colab/Kaggle → hasil muncul di UI tanpa refresh manual.
- Jika worker tidak aktif, UI menampilkan "Menunggu operator/worker" dan tidak ada data hilang.
- Media dan backup `pg_dump` tersimpan di HF S3; tidak ada byte media di Vercel.
- Cron Worker mendeteksi job macet, menjaga Supabase tetap aktif, dan mengirim notifikasi.
- Tidak ada secret (service role, HF token, DB password) di bundle klien atau notebook log.
- Restore backup harian ke staging berhasil.
- Biaya pilot ≤ Rp150 ribu/bulan di luar domain dan kuota Gemini, dengan alert 80%.

---

## 1. Latar belakang

### 1.1 Kondisi saat ini

- Next.js 16, React 19, TypeScript, Tailwind 4, output `standalone`, dijalankan Bun + PM2.
- PostgreSQL wajib; skema dikelola `packages/@openmaic/storage` + `scripts/bootstrap-db-schema.mts`.
- Asset pool PostgreSQL atau S3-compatible; HF S3 didukung lewat `HF_S3_*` dan `ASSET_BYTE_EGRESS=redirect`.
- Auth opsional (`AUTH_ENABLED`), Google-only via Supabase PKCE; akun baru `pending` sampai admin menyetujui.
- `startGenerationRunner()` di `instrumentation.node.ts` berjalan di setiap proses Node.
- `scripts/gpu-services.sh` menyiapkan ComfyUI (SDXL), VoxCPM (TTS), FunASR (ASR) di Colab/Kaggle.
- `install.sh --colab` dan `--kaggle` sudah terbukti, tetapi notebook bersifat ephemeral.

### 1.2 Diagram lampiran dan interpretasinya

Diagram yang dilampirkan memetakan:

```
Pengguna (sekolah)
   └─ Cloudflare (*.riau.ai): DNS, SSL, Tunnel, Access
        ├─ DNS/SSL/WAF/Access → Vercel Next.js 16 (UI) · kelas-ka.riau.ai
        ├─ Worker gerbang · api-kelas.riau.ai → Colab orkestrator
        └─ Worker media · media-kelas.riau.ai → HF S3
   ├─ Colab orkestrator · colab.riau.ai
   │    ├─ LangGraph (API, buat kelas)
   │    └─ Postgres lokal (log + cache)
   ├─ Kaggle · gpu.riau.ai (TTS, gambar)
   ├─ Penyimpanan tahan lama
   │    ├─ Supabase (Auth, antrean job, ringkasan)
   │    └─ HF S3 (media + backup pg_dump)
   └─ Pendukung: Cron Worker, GitHub CI, Sentry
```

Interpretasi yang dipakai PRD ini:

- **Cloudflare bukan host aplikasi.** DNS/SSL/Tunnel/Access mengamankan akses; dua Worker melakukan routing dan media; cron melakukan pemeliharaan.
- **Vercel hanya UI + API ringan.** Tidak ada runner, tidak ada GPU, tidak ada disk persisten.
- **Colab adalah orkestrator, bukan web server.** LangGraph mengatur buat/edit kelas dan workspace, tetapi hanya hidup saat sesi operator dibuka.
- **Postgres lokal bersifat sementara.** Isinya log, cache, dan checkpoint LangGraph. Jika sesi Colab berakhir, data ini boleh hilang; sumber kebenaran tetap Supabase.
- **Kaggle adalah pelaksana GPU.** Juga on-demand, pull job, lalu unggah hasil ke HF S3.
- **Supabase adalah source of truth terstruktur.** Auth, dokumen kursus, ringkasan, antrean job, heartbeat worker.
- **HF S3 adalah byte store.** Media kursus dan backup database terenkripsi.

### 1.3 Problem statement

| Kebutuhan | Kenyataan | Dampak |
|---|---|---|
| Runner hidup >300 s | Vercel Hobby memutus fungsi di 300 s | Run terputus, lease menggantung |
| Worker GPU selalu tersedia | Colab/Kaggle sesi terbatas, tanpa inbound | Harus on-demand + antrean + notifikasi |
| SSR + auth di edge | Workers 10 ms CPU/128 MB | SSR tidak muat |
| `LISTEN/NOTIFY` agent | Transaction pooler 6543 tidak mengantarkan NOTIFY | Perlu session mode 5432 |
| Sandbox PBL v3 lokal | Vercel tidak punya proses/PTY persisten | Perlu E2B atau gate off |
| `fs` untuk docs/media lama | Vercel read-only | Perlu migrasi ke HF S3/Pages |
| Kuota Gemini | flash-lite 500 RPD, 3.6/3.8 20 RPD | Bottleneck sebenarnya |

### 1.4 Mengapa on-demand masuk akal

Biaya GPU gratis paling berharga jika dipakai saat ada hasil yang diinginkan, bukan dipelihara 24/7. Dengan antrean:

- Worker bisa dimatikan kapan saja tanpa kehilangan job (lease + retry + idempotency).
- Operator menyalakan notebook ketika cron/UI melaporkan antrean atau saat ada guru/guru masuk workspace.
- Kapasitas GPU harian (Kaggle ±30 jam/minggu) dipakai untuk pekerjaan nyata, bukan idle.
- ToS notebook lebih terjaga: alat batch yang dijalankan manusia, bukan layanan web.

---

## 2. Tujuan, non-tujuan, metrik

### 2.1 Tujuan

| ID | Tujuan |
|---|---|
| G1 | Situs produksi `kelas-ka.riau.ai` bisa dipakai siswa/guru/admin dengan login Google. |
| G2 | Pekerjaan berat dipindah ke worker on-demand yang mengklaim job dari Supabase. |
| G3 | Supabase menjadi sumber kebenaran data; HF S3 menjadi sumber kebenaran byte; Postgres lokal hanya log/cache. |
| G4 | Cloudflare menyediakan DNS/TLS/WAF/Tunnel/Access/Worker/Cron tanpa menjadi host aplikasi. |
| G5 | Worker offline tidak menyebabkan hilangnya job atau data. |
| G6 | Biaya pilot mendekati nol dengan alert 80% pada tiap kuota gratis. |
| G7 | Rollback ke Opsi A tersedia kapan saja selama cutover. |

### 2.2 Non-tujuan fase 1

- Tidak membangun GPU cluster sendiri.
- Tidak menjalankan LLM lokal di produksi.
- Tidak menjanjikan SLA 99,9%; pilot best-effort + status page.
- Tidak mengaktifkan workbench, PBL v3 lokal, dan video export di Vercel fase 1.
- Tidak memigrasikan seluruh data lama otomatis; migrasi satu kali dengan skrip.
- Tidak membuat aplikasi Android baru; APK tetap memakai domain baru.

### 2.3 Metrik

| Metrik | Target | Cara ukur |
|---|---|---|
| Login sukses | ≥98% | Log auth + Supabase |
| Buka kursus p95 | ≤2,5 s di 4G | RUM/Web Vitals |
| Job teks mulai diproses | ≤5 mnt setelah worker aktif | `worker_jobs.started_at` |
| Job media selesai | ≤30 mnt setelah worker aktif | `worker_jobs.finished_at` |
| Job sukses | ≥95% dengan retry 3× | Queue metrics |
| Worker online sesuai jadwal | ≥90% jam sekolah | `worker_heartbeats` |
| Kehilangan data | 0 | Restore drill |
| Biaya pilot | ≤Rp150 rb/bulan | Invoice + dashboard |
| Akses lintas owner | 0 temuan | Uji IDOR |

---

## 3. Asumsi dan batas platform

Angka diverifikasi 20 Nov 2026 dari dokumentasi resmi; dapat berubah.

### 3.1 Vercel Hobby

| Item | Batas | Implikasi |
|---|---|---|
| Durasi fungsi | 300 s | SSE harus reconnect dengan `Last-Event-ID` |
| Invokasi | 1 jt/bulan | Polling agresif dilarang |
| Active CPU | 4 jam/bulan | Batas paling ketat; SSR publik harus di-cache |
| Memory provisioned | 360 GB-jam/bulan | Fungsi besar mempercepat habis |
| Fast data transfer | 100 GB/bulan | Media lewat HF S3, bukan Vercel |
| Build | 8 GB RAM | `NODE_OPTIONS=--max-old-space-size=6144` |
| Overage | Hobby dijeda | Alert 80% wajib |
| SLA | Tidak ada | Upgrade untuk komitmen sekolah |

### 3.2 Cloudflare Free

| Item | Batas | Implikasi |
|---|---|---|
| Worker request | 100 rb/hari | Gateway + media + cron masih muat |
| CPU/request | 10 ms | Tidak bisa SSR; worker hanya routing/SigV4 |
| Memori | 128 MB | Tidak muat bundle Next |
| Cron trigger | 5/akun | Cukup untuk reaper + keep-alive |
| Subrequest | 50/request | Cukup untuk proxy |
| Worker size | 64 MB | SigV4 + HMAC muat |

### 3.3 Supabase Free

| Item | Batas | Implikasi |
|---|---|---|
| Project | 2 | Produksi + staging |
| Database | 500 MB | Arsipkan kursus lama ke HF S3 |
| Egress | 5 GB/bulan | Jangan streaming media dari sini |
| Storage | 1 GB | Hanya berkas kecil |
| MAU | 50.000 | Cukup pilot |
| Realtime | 200 koneksi, 2 jt pesan | Fallback polling tetap ada |
| Pause | 7 hari idle | Cron keep-alive harian wajib |
| Backup | Tidak ada PITR di Free | `pg_dump` harian ke HF S3 |
| Pooler | Session 5432 (LISTEN/NOTIFY), transaction 6543 (worker) | Dua URL |

### 3.4 HF S3 Free

| Item | Batas | Implikasi |
|---|---|---|
| Privat | 100 GB | ±1.250–3.000 kursus |
| Publik | Best-effort | Jangan andalkan |
| File | <200 GB disarankan | Video dipecah/kompresi |
| Objek | <100 rb/repo, <10 rb/folder | Prefix per owner/tanggal |
| SLA/CDN | Tidak ada | Retry + cache browser |
| Endpoint | `https://s3.hf.co/<namespace>` path-style | Didukung `HF_S3_*` |

### 3.5 Colab (on-demand)

| Item | Batas | Implikasi |
|---|---|---|
| Sesi | Maks 12 jam | Checkpoint + lepas lease saat selesai |
| GPU | Tidak dijamin | Orkestrator sebaiknya CPU-only |
| ToS | Larang web service / bypass UI | Notebook dijalankan operator, bukan server |
| Inbound | Tidak ada | Pull job dari Supabase |
| Akses | Cloudflare Tunnel + Access | Tanpa port publik |

### 3.6 Kaggle (on-demand)

| Item | Batas | Implikasi |
|---|---|---|
| GPU | ±30 jam/minggu | ±60–120 kursus media/minggu |
| Sesi | 12 jam, output 20 GB | Unggah langsung ke HF S3 |
| Inbound | Tidak ada | Pull job; tunnel hanya untuk admin |
| ToS | Orientasi riset/ML | Review legal untuk pemakaian produksi |

### 3.7 Gemini API

| Model | RPM/RPD | Catatan |
|---|---|---|
| `gemini-3.6-flash`, `3.8-flash` | 5/20 | Kualitas tinggi, kuota kecil |
| `gemini-3.5-flash-lite`, `3.1-flash-lite` | 15/500 | Default teks dan ASR |
| TTS | 3/10 | Tidak dipakai produksi |
| Image | 0 | Harus pakai SDXL lokal |

Satu kursus 40–100 panggilan → 5–12 kursus/hari per key. Ini bottleneck utama; jangan memutar banyak key untuk menghindari batas.

### 3.8 Domain, Tunnel, Access

| Nama | Tipe | Target | Keterangan |
|---|---|---|---|
| `kelas-ka.riau.ai` | CNAME | Vercel | UI, proxy Cloudflare |
| `api-kelas.riau.ai` | Worker route | `kelaska-gateway` | Gerbang ke Colab/Vercel |
| `media-kelas.riau.ai` | Worker route | `kelaska-media` | Presign/proxy HF S3 |
| `colab.riau.ai` | Tunnel | `cloudflared` di host operator | Access + hanya saat sesi |
| `gpu.riau.ai` | Tunnel | `cloudflared` di Kaggle | Access + hanya saat sesi |
| `docs.kelas.riau.ai` | Pages | `public/docs-site` | Dokumentasi statis |
| `status.kelas.riau.ai` | Pages/Worker | Status manual | Insiden |
| `kelaska.riau.ai` | CNAME/redirect | `kelas-ka.riau.ai` | Alias durante cutover |

- TLS Full (strict), Always Use HTTPS, HSTS, minimum TLS 1.2.
- Cloudflare Access: Google OTP untuk operator/admin; service token untuk mesin. Siswa tetap login Supabase Google di UI.
- Supabase redirect URL persis: `https://kelas-ka.riau.ai/api/auth/supabase/callback`.
- `AUTH_PUBLIC_URL=https://kelas-ka.riau.ai` wajib di balik proxy.

---

## 4. Keputusan arsitektur

### 4.1 Opsi A — jembatan produksi

```
Cloudflare DNS/WAF
       ↓
Host Node panjang (PM2, Colab/Kaggle/VPS kecil)
  Next.js + generation runner + media services
       ↓
Supabase (DB/Auth) + HF S3 (media)
```

Pakai `install.sh --colab` / `--kaggle` dengan `DATABASE_URL` Supabase dan `HF_S3_*`. Untuk pilot serius, gunakan VPS kecil dengan disk persisten, bukan notebook. **Vercel hanya untuk landing/status.**

### 4.2 Opsi B — target sesuai lampiran

```
Pengguna → Cloudflare → Vercel UI → Supabase (auth, job, dokumen)
                           ├→ HF S3 (presign via Worker media)
                           └→ Worker gerbang → Colab (on-demand)
                                            → Kaggle (on-demand)
Cron Worker → cek job macet + keep-alive + notifikasi operator
```

**Prinsip:**

1. Web tier tidak menjalankan runner atau GPU.
2. Antrean Supabase adalah kontrak; worker boleh mati kapan saja.
3. Worker pull, bukan push; operator menyalakan sesuai kebutuhan.
4. Media tidak lewat Vercel; Worker media → HF S3.
5. Fitur berat di-gate dan menyusul.
6. Worker end-to-end idempoten.

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

**Keputusan:** A sekarang, B setelah spike dan worker extraction. Jangan big-bang.

### 4.4 Branch deploy yang disiapkan

| Branch | Isi | Dipakai untuk |
|---|---|---|
| `docs/prd-produksi-hybrid` | PRD + diagram arsitektur | Keputusan & review |
| `deploy/vercel` | `vercel.json`, `.env.vercel.example`, flag `OPENMAIC_GENERATION_RUNNER_ENABLED`, endpoint maintenance, runbook | Deploy web tier ke Vercel |
| `deploy/cloudflare` | Worker gateway/media/cron, `wrangler*.toml`, panduan Tunnel/Access | Deploy edge ke Cloudflare |

Ketiga branch berbasis commit yang sama; gabungkan keduanya saat cutover penuh. Lihat §19.2.

---

## 5. Arsitektur target

### 5.1 Tanggung jawab komponen

| Komponen | Tanggung jawab | Tidak boleh |
|---|---|---|
| Cloudflare DNS/SSL/WAF | DNS, TLS, WAF, cache statis | Menjalankan SSR |
| Cloudflare Tunnel | Menghubungkan `colab.riau.ai`/`gpu.riau.ai` tanpa port publik | Menjadi backend 24/7 |
| Cloudflare Access | Batasi endpoint operator ke Google/worker identity | Menggantikan auth Supabase pengguna |
| Worker gerbang | Routing `/api/*` ke Vercel, `/worker/*` ke Colab/Kaggle bila online | Menyimpan data atau memproses media |
| Worker media | Validasi token, presign/stream HF S3, CORS, cache | Proxy seluruh traffic aplikasi |
| Cron Worker | Reaper job, keep-alive, notifikasi operator | Query Postgres langsung |
| Vercel | UI, auth callback, REST API, SSE/polling, admin | Runner, GPU, disk persisten |
| Supabase | Auth, dokumen, ringkasan, antrean, heartbeat | Blob media besar |
| HF S3 | Media + backup `pg_dump` | Database atau CDN SLA |
| Colab orkestrator | LangGraph: buat/edit kelas, workspace | Menyimpan sumber kebenaran di Postgres lokal |
| Postgres lokal | Log, cache, checkpoint LangGraph | Menyimpan kursus/job sebagai sumber kebenaran |
| Kaggle | TTS, gambar, ASR, video | Menyimpan hasil permanen di disk |
| Gemini | Teks/vision | Menjadi satu-satunya provider tanpa fallback |

### 5.2 On-demand: pemicu dan alur aktivasi

| Pemicu pengguna | Yang dibutuhkan | Aksi sistem |
|---|---|---|
| Buat kelas | Colab (teks) + Kaggle (media) | Vercel enqueue `course.generate`; cron lihat antrean & heartbeat kosong → notifikasi operator |
| Edit kelas | Colab + Kaggle | Enqueue `course.edit` / `course.media.patch` |
| Akses workspace | Colab orkestrator | Gateway cek heartbeat; jika offline, UI tampil "Mengaktifkan workspace" + notifikasi |
| Butuh multimedia | Kaggle GPU | Enqueue `course.media`; operator menyalakan notebook Kaggle |

**Urutan aktivasi:**

1. Permintaan pengguna masuk ke Vercel → tulis job ke Supabase (`queued`).
2. Cron Worker tiap 5 menit membaca status antrean lewat endpoint maintenance Vercel.
3. Jika ada job `queued` dan tidak ada worker heartbeat <10 menit, cron mengirim notifikasi ke operator (webhook WhatsApp/email/Sentry).
4. Operator membuka notebook Colab/Kaggle, menjalankan sel worker.
5. Worker `register_worker` + heartbeat, lalu `claim_worker_job`; GPU worker menunggu health check ComfyUI/VoxCPM/FunASR.
6. Setelah antrean kosong atau mendekati batas sesi, worker berhenti dengan graceful shutdown: lepas lease, requeue job aktif.
7. UI terus membaca status; tidak perlu refresh.

**Konsekuensi yang harus diterima:** ada jeda antara permintaan dan pemrosesan tergantung kesiapan operator. SLA tidak bisa dijanjikan tanpa worker selalu-on atau VPS. Ini harus ditulis di halaman status dan informasi sekolah.

### 5.3 Alur login

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant C as Cloudflare
    participant V as Vercel
    participant S as Supabase Auth
    participant D as Supabase DB
    B->>C: GET /login (kelas-ka.riau.ai)
    C->>V: proxy
    V-->>B: halaman login
    B->>S: signInWithOAuth(Google)
    S-->>B: redirect Google → callback
    B->>V: GET /api/auth/supabase/callback?code=...
    V->>S: redeem code (PKCE verifier)
    V->>D: cari/buat auth_users
    alt pending
        V-->>B: /login?error=pending
    else aktif
        V-->>B: Set-Cookie kelaska_session + redirect /
    end
```

`AUTH_PUBLIC_URL=https://kelas-ka.riau.ai` wajib. Role dibaca dari database setiap request, bukan dari cookie.

### 5.4 Alur buat/edit kelas

```mermaid
sequenceDiagram
    autonumber
    participant T as Guru
    participant V as Vercel
    participant D as Supabase
    participant C as Colab (on-demand)
    participant K as Kaggle (on-demand)
    participant H as HF S3
    T->>V: POST /api/generation-runs
    V->>D: insert run + worker_jobs(course.generate)
    V-->>T: 202 {runId}
    Note over C: operator menyalakan saat dinotifikasi
    C->>D: claim job (lease 120s), heartbeat 30s
    C->>C: LangGraph: outline → scene → teks
    C->>D: tulis stage doc + placeholder media ke Supabase
    C->>D: enqueue worker_jobs(course.media); run = waiting_media
    Note over K: operator menyalakan Kaggle
    K->>D: claim job course.media
    K->>K: SDXL / VoxCPM / FunASR
    K->>H: unggah aset content-hash
    K->>D: update stage doc + ast_ id; complete job; run = succeeded
    T->>V: GET events (SSE/polling) → status berubah
```

### 5.5 Alur media

1. **Jalur yang sudah ada hari ini:** aset dibaca lewat `/api/persistence/...` dengan `ASSET_BYTE_EGRESS=redirect`; handler storage sudah menandatangani URL HF S3 sendiri (TTL default 60 detik, maksimal 900 detik). Vercel tidak pernah menyajikan byte media.
2. **Jalur edge sesuai diagram:** `media-kelas.riau.ai` menerima token HMAC `exp|sig` yang dibuat Vercel, memverifikasinya, lalu menandatangani permintaan HF S3 dengan SigV4 (TTL ≤600 detik). Ini dipakai untuk media statis/legacy, ekspor, dan konten baru setelah adaptor token dipasang.
3. Kedua jalur boleh hidup berdampingan. Mengganti signer native dengan token Worker media adalah pekerjaan milestone M3, bukan prasyarat M1/M2.
4. Header `Cache-Control: public, max-age=31536000, immutable` hanya untuk kunci content-hash; media lama cache maksimal 1 jam dan tetap revalidasi owner.
5. Android WebView memakai URL yang sama; tidak ada jalur media kedua.

### 5.6 State machine job

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
    queued --> cancelled: dibatalkan
    running --> cancelled: cancel_requested
    dead --> queued: admin requeue
    succeeded --> [*]
```

Lease 120 s, heartbeat 30 s, retry 3×, `idempotency_key` unik. Worker wajib cek `cancel_requested` tiap langkah.

### 5.7 Postgres lokal di Colab

- Berisi: log LangGraph, cache prompt/respons, checkpoint sementara, metrik sesi.
- Tidak berisi: `stages`, `generation_runs`, `worker_jobs`, `auth_users`, `assets`.
- Boleh hilang saat session Colab berakhir; pekerjaan yang belum selesai diambil lagi dari Supabase.
- Akses hanya dari proses worker di sesi yang sama; jangan diekspos lewat Tunnel.
- Jika ingin analitik jangka panjang, kirim ringkasan ke Supabase/HF S3, bukan simpan di Postgres lokal.

---

## 6. Perubahan teknis

### 6.1 Web tier Vercel

Wajib:

- Tambah `OPENMAIC_GENERATION_RUNNER_ENABLED=false` dan gate `startGenerationRunner()` di `instrumentation.node.ts` (flag baru, default true).
- `export const maxDuration = 300` pada route SSE `/api/generation-runs/[id]/events`.
- Jangan aktifkan `OPENMAIC_AGENT_RUNTIME_ENABLED`, workbench, PBL v3, video export di fase 1.
- Pindahkan `/docs` ke Cloudflare Pages (`NEXT_PUBLIC_DOCS_URL=https://docs.kelas.riau.ai`).
- Migrasi media lama dari disk ke HF S3; `/api/classroom-media/*` → 404/redirect yang jelas.
- Pastikan prompt/skills yang dibaca via `fs` ikut ter-trace (sudah ada di `outputFileTracingIncludes`).
- Endpoint maintenance: `POST /api/internal/maintenance` dengan header `x-kelaska-cron-secret`; dibebaskan dari proxy auth karena dipanggil cron, bukan pengguna.

Build:

```
installCommand : bun install --frozen-lockfile
buildCommand   : bun run build
NODE_OPTIONS   : --max-old-space-size=6144
```

`postinstall` sudah menjalankan `build:packages`, jadi tidak perlu duplikasi.

### 6.2 Cloudflare Worker gerbang

File: `cloudflare/workers/gateway/src/index.ts`, route `api-kelas.riau.ai/*`.

- Teruskan `/api/*` dan `/` ke Vercel (`ORIGIN_VERCEL`).
- `/worker/colab/*` dan `/worker/gpu/*` hanya diteruskan jika `WORKER_STATE` KV bernilai `online`; jika tidak, 503 JSON `{ error: 'WORKER_OFFLINE', hint: '...' }`.
- Tambah security header, blok method menulis kecuali yang diizinkan, batasi body.
- Cloudflare Access di zone-level yang memverifikasi identitas operator; worker tidak membaca header Access (lihat aturan identity di `tests/server/identity/cookie-guard.test.ts`).
- Rate limit di dashboard Cloudflare: `/api/auth/*` 10/menit/IP, `/api/generation-runs` 5/menit/user.

### 6.3 Cloudflare Worker media

File: `cloudflare/workers/media/src/index.ts`, route `media-kelas.riau.ai/*`.

- Verifikasi token HMAC `exp|path` dengan `MEDIA_TOKEN_SECRET` (Web Crypto). Token dibuat di Vercel; adaptor untuk menggantikan signer native `/api/persistence` masuk M3.
- SigV4 GET ke HF S3 (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), TTL 600 detik.
- CORS: `https://kelas-ka.riau.ai`, method GET/HEAD, expose `Content-Type`, `Content-Length`, `ETag`, `Accept-Ranges`.
- Dukung `Range` untuk audio/video.
- Tolak path di luar prefix `assets/`, `materials/`, `exports/`.
- Jangan log URL bertanda tangan.

### 6.4 Cloudflare Cron Worker

File: `cloudflare/workers/cron/src/index.ts`, trigger `*/5 * * * *`.

- `POST /api/internal/maintenance` ke Vercel dengan `x-kelaska-cron-secret`.
- Response `{ queued, stuck, workersOnline, dbOk }`.
- Jika `stuck > 0` atau `queued > 0 && workersOnline === 0` → kirim notifikasi ke `OPERATOR_WEBHOOK`.
- Keep-alive Supabase: request ke `KEEPALIVE_URL` dengan anon key (atau lewat endpoint maintenance).
- Jangan menyimpan service role key di Worker.

### 6.5 Cloudflare Tunnel + Access

- `cloudflared tunnel` dijalankan operator bersamaan dengan notebook (bukan service permanen).
- Config: `colab.riau.ai → http://127.0.0.1:<port>` (LangGraph API) dan `gpu.riau.ai → http://127.0.0.1:8188` (ComfyUI) atau router port lain.
- Access policy: email grup operator + service token; siswa tidak boleh mengakses langsung hostname ini.
- Putuskan tunnel saat notebook selesai; DNS tetap mengarah ke tunnel yang tidak aktif → gateway balas 503 dengan pesan jelas.

### 6.6 Antrean Supabase

Tabel `worker_jobs` dengan kolom: `id`, `kind`, `owner_id`, `payload jsonb`, `status`, `priority`, `attempts`, `max_attempts`, `idempotency_key unique`, `lease_owner`, `lease_expires_at`, `next_attempt_at`, `cancel_requested`, `result`, `error_code`, `error_message`, timestamps.

RPC: `claim_worker_job(worker_id, kinds[], lease_seconds)`, `heartbeat_worker_job`, `complete_worker_job`, `fail_worker_job`, `reap_worker_jobs()`, `register_worker(...)`. `claim` memakai `FOR UPDATE SKIP LOCKED`.

Role `kelaska_worker` hanya boleh eksekusi RPC di atas + `worker_heartbeats`; tidak boleh membaca `auth_users`, `auth_sessions`, `workspace_model_config`. Jangan pakai `SUPABASE_SERVICE_ROLE_KEY` di notebook.

### 6.7 Colab orkestrator (on-demand)

- Notebook: clone ref pinned, `bun install`, jalankan `bun run worker:course` dengan `WORKER_KINDS=course.generate,course.edit`.
- LangGraph menyusun outline/scene/teks; tulis ke Supabase, bukan Postgres lokal sebagai sumber kebenaran.
- Postgres lokal dipakai untuk checkpoint graph + log; hapus saat sesi ditutup.
- Sebelum sesi 12 jam berakhir: berhenti klaim job, selesaikan job aktif, lepas lease.
- Tangani `SIGINT`/`SIGTERM`.
- Tampilkan progress di output notebook (job id, langkah, durasi).

### 6.8 Kaggle GPU worker (on-demand)

- Notebook: jalankan `scripts/gpu-services.sh --gpu-dir=/kaggle/temp/gpu-models --skip ollama`.
- Tunggu health check `:8188` (ComfyUI), `:8001` (VoxCPM), `:8000` (FunASR) sebelum klaim.
- Satu job GPU pada satu waktu; heartbeat tetap jalan.
- Unggah hasil ke HF S3; hapus file sementara setelah sukses.
- Jika GPU OOM → `fail_worker_job` kode `GPU_OOM`, jangan retry tanpa turunkan resolusi/batch.
- T4 15 GB: SDXL ~7 GiB idle/~10,4 GiB sampling; VoxCPM ~10,9 GiB. Jangan jalankan Ollama di kartu yang sama.

### 6.9 HF S3

Prefix: `assets/<sha256>.<ext>`, `materials/<owner>/<sha256>`, `exports/<stage>/<sha256>.zip`, `backups/<yyyy-mm-dd>/dump.sql.gz`, `pending/<owner>/<uuid>`.

- Bucket privat; presigned GET ≤10 menit.
- CORS untuk `https://kelas-ka.riau.ai` dan `https://media-kelas.riau.ai`.
- `ASSET_BYTE_EGRESS=redirect`; butuh `s3:ListBucket` agar objek hilang → 404.
- Lifecycle: `pending` 7 hari, `exports` 90 hari, `backups` 30 hari.
- Backup `pg_dump` dienkripsi (age/GPG) sebelum unggah.

### 6.10 Auth dan BYOK

- `AUTH_ENABLED=true`, Google provider aktif di Supabase.
- Redirect URL persis `https://kelas-ka.riau.ai/api/auth/supabase/callback`.
- `AUTH_ADMIN_EMAILS` minimal satu admin; akun baru `pending`.
- Role dari database, bukan cookie.
- BYOK: akun tanpa key terverifikasi → `/onboarding/api-key` atau `403 API_KEY_REQUIRED`. Untuk sekolah pilih: `api_key_exempt=true` + key operator, atau key bersama terverifikasi. Jangan paksa siswa bawa key pribadi.
- Revoke = hapus `auth_sessions`; berlaku meski cookie masih valid.

### 6.11 Progress dan status

- Fase 1: SSE `/api/generation-runs/:id/events` + polling 5 s; reconnect `Last-Event-ID`; `maxDuration=300`.
- Fase 2: Supabase Realtime dengan RLS; fallback polling tetap ada.
- UI status: `queued`, `leased`, `running`, `waiting_media`, `succeeded`, `failed`, `dead`, `cancelled`.
- Jika worker offline: banner "Menunggu operator/worker" + `last_seen_at`.

### 6.12 Feature scoping Vercel

| Fitur | Fase 1 | Fase 2 | Catatan |
|---|---|---|---|
| Login, library, playback | ✅ | ✅ | Inti |
| Buat/edit kelas via worker | ✅ | ✅ | Runner tidak di Vercel |
| Media gambar/audio | ✅ | ✅ | Kaggle + HF S3 |
| Workspace | ⚠️ read-only | ✅ | Colab orkestrator saat aktif |
| Admin | ✅ | ✅ | |
| PBL v3 | ❌ | E2B | Sandbox lokal tidak ada |
| Agent workbench | ❌ | ⚠️ | Butuh SSE/LISTEN |
| Video export | ❌ | ⚠️ | Worker GPU |
| Docs | Pages | Pages | `docs.kelas.riau.ai` |
| Android | ✅ | ✅ | Domain baru |

Gate: `OPENMAIC_GENERATION_RUNNER_ENABLED=false`, `OPENMAIC_AGENT_RUNTIME_ENABLED` unset/false, `NEXT_PUBLIC_WORKBENCH_ENABLED=false`, `NEXT_PUBLIC_ENABLE_VIDEO_EXPORT` false, PBL v3 dimatikan.

### 6.13 CI/CD dan migrasi

1. `bun install --frozen-lockfile`
2. `bun run check` + `bun run lint`
3. `bun run test` (subset; penuh nightly)
4. `bun run build` dengan heap 6144 MB
5. Migrasi DB dari CI via `MIGRATION_DATABASE_URL` (session mode 5432), expand/contract
6. Deploy Vercel + Cloudflare Workers + Pages
7. Smoke test: login, enqueue job dummy, cek queue, buka kursus contoh

Jangan jalankan migrasi dari cold start. Backup sebelum migrasi. Rollback Vercel instant; rollback DB hanya untuk migrasi aditif.

### 6.14 Peta perubahan kode

| File | Perubahan | Risiko jika dilewat |
|---|---|---|
| `lib/config/feature-flags.ts` | Tambah `isGenerationRunnerEnabled()` (default true) | Tidak bisa mematikan runner di Vercel |
| `instrumentation.node.ts` | Gate `startGenerationRunner()` dengan flag tersebut | Cold start mengklaim run lalu mati di 300 s |
| `app/api/generation-runs/[id]/events/route.ts` | `maxDuration = 300` | SSE terputus tanpa reconnect |
| `proxy.ts` | Bebaskan `/api/internal/maintenance` dari auth gate (route pakai secret header) | Cron tidak bisa memanggil endpoint |
| `app/api/internal/maintenance/route.ts` (baru) | Ping DB + ringkasan antrean + status worker | Cron butuh service role atau buta |
| `instrumentation.node.ts` (Vercel) | Agent runtime off | LISTEN/SSE agent menggantung |
| `app/docs/[[...slug]]/route.ts` | Redirect/ Pages | Membaca `public/docs-site` yang tidak ada |
| `app/api/classroom-media/**` | 404/redirect setelah migrasi | 500 karena `fs` read-only |
| `next.config.ts` | Pastikan tracing prompt/skills & `serverExternalPackages` | Build/runtime ENOENT |
| `packages/@openmaic/storage/src/**` | Migrasi `worker_jobs`, `worker_heartbeats`, RPC | Jangan edit baseline |
| `scripts/worker-course.ts`, `scripts/worker-media.ts` (baru) | Entrypoint worker on-demand | Notebook tidak punya loop |
| `cloudflare/workers/**` (baru) | Gateway, media, cron | Tidak ada edge/on-demand trigger |
| `README.md`, `packages/docs/**` | Dokumentasi Opsi A/B + branch deploy | Operator mengulang kesalahan |

---

## 7. Kebutuhan fungsional

P0 wajib fase 1, P1 penting, P2 nanti.

| ID | Kebutuhan | Prioritas | Kriteria terima |
|---|---|---|---|
| FR-01 | Login Google via Supabase | P0 | Aktif masuk; pending ditolak jelas |
| FR-02 | Owner scoping kursus/aset | P0 | Akun B tidak bisa baca/hapus kursus A |
| FR-03 | Admin approve/role | P0 | Berlaku di request berikutnya |
| FR-04 | Buat/edit kelas → enqueue job | P0 | 202 + `runId`; job `queued` |
| FR-05 | Colab on-demand kerjakan teks | P0 | Stage doc terisi; job selesai |
| FR-06 | Kaggle on-demand kerjakan media | P0 | Aset di HF S3; `ast_` id tertulis |
| FR-07 | Worker aktif hanya saat dibutuhkan | P0 | Heartbeat hanya saat notebook jalan |
| FR-08 | Worker offline tidak hilangkan job | P0 | Job tetap `queued`; UI menjelaskan |
| FR-09 | Retry + dead-letter | P0 | 3× gagal → `dead`; admin requeue |
| FR-10 | Idempotensi media | P0 | Retry tidak menggandakan objek |
| FR-11 | Media via Worker + HF S3 | P0 | Token ≤10 mnt; audio/gambar tampil |
| FR-12 | Cron reaper + keep-alive + notifikasi | P0 | Job macet kembali antrean; Supabase tidak pause |
| FR-13 | Admin lihat worker | P1 | `last_seen_at`, kind, host, GPU |
| FR-14 | Admin requeue/cancel | P1 | Status berubah sesuai aksi |
| FR-15 | Ekspor kursus | P1 | ZIP/HTML di HF S3 |
| FR-16 | Docs terpisah | P1 | `docs.kelas.riau.ai` live |
| FR-17 | Workspace penuh via orkestrator | P2 | Colab aktif saat diakses |
| FR-18 | PBL v3 via E2B | P2 | Tanpa sandbox lokal |
| FR-19 | Agent workbench | P2 | Polling/Realtime, bukan LISTEN panjang |
| FR-20 | Video export | P2 | Worker GPU, bukan Vercel |
| FR-21 | Audit admin | P1 | Approve/role/requeue tercatat |

---

## 8. Kebutuhan non-fungsional

### 8.1 Performa

- Publik: static/ISR, TTFB ≤500 ms (region `sin1`).
- Kelas: LCP ≤2,5 s di 4G; media lazy-load.
- API baca p95 ≤400 ms; tulis ≤800 ms.
- Worker claim ≤2 s setelah worker idle; heartbeat ≤30 s.
- Worker media: presign + redirect ≤300 ms.

### 8.2 Keandalan

- Lease + retry + idempotency mencegah job hilang saat notebook ditutup.
- Data di Supabase/HF S3, bukan disk fungsi.
- Backup harian; restore drill bulanan; RPO ≤24 jam, RTO ≤4 jam.
- Degradasi: HF S3 down → placeholder; Gemini habis → job failed jelas; Supabase pause → 503 + status page.

### 8.3 Keamanan

- HTTPS, HSTS, TLS ≥1.2.
- Cookie `HttpOnly`, `Secure`, `SameSite=Lax`.
- Access untuk endpoint operator; service token untuk mesin; tidak membaca header Access di kode aplikasi.
- Worker role least privilege; tidak ada service role di notebook/Worker.
- Token media HMAC + TTL pendek; jangan log URL.
- URL guard terhadap SSRF; sanitasi HTML; CSP.
- Secret scanning CI; rotasi 90 hari.

### 8.4 Privasi / UU PDP

- Data minimum: email, nama, role, progres.
- Residensi: Supabase Singapore, Vercel `sin1`, HF S3 US/EU. Jika wajib di Indonesia → stack ini tidak memenuhi; perlu on-prem.
- Retensi: job 30 hari, event 7 hari, backup 30 hari, log Colab lokal dibuang saat sesi.
- Hak akses/hapus subjek data; DPA vendor; transparansi di `/privacy`.
- Jangan simpan nilai/sertifikat resmi di pilot tanpa persetujuan.

### 8.5 Operasional

- Satu operator bisa: deploy, menyalakan/memadamkan worker, requeue, restore, rotasi secret.
- Semua prosedur di §13 dan `docs/deployment/*`.
- Alert ke email/WhatsApp + Sentry; status page manual.

### 8.6 Biaya

- Pilot Rp0–150 rb/bulan di luar domain/Gemini.
- Upgrade bila Vercel CPU >80%, Supabase DB >80%, HF >80 GB, Gemini >80% RPD.
- Dilarang memutar banyak akun gratis untuk menghindari batas.

---

## 9. Model data

### 9.1 Tabel existing

`stages` (dokumen JSONB), `generation_runs`, `generation_run_events`, `assets`, `auth_users`, `auth_sessions`, `workspace_model_config`, `owner_material`.

### 9.2 Tabel baru (Supabase)

- `worker_jobs` (§6.6)
- `worker_heartbeats` (`worker_id`, `kind`, `host`, `gpu`, `version`, `last_seen_at`)
- `worker_audit` opsional (`worker_id`, `job_id`, `action`, `detail`, `created_at`)
- `app_events` opsional (log aplikasi penting)

### 9.3 Postgres lokal (Colab)

- `langgraph_checkpoints`, `worker_log`, `prompt_cache` — semuanya ephemeral.
- Tidak ada foreign key ke tabel Supabase; tidak direplikasi.

### 9.4 Indeks & retensi

- `worker_jobs_claim_idx (status, priority, next_attempt_at, created_at) where status='queued'`
- `worker_jobs_lease_idx (lease_expires_at) where status in ('leased','running')`
- Job selesai >30 hari, event >7 hari, backup >30 hari dihapus.
- Worker role tidak mendapat akses `auth_*`.

---

## 10. Kontrak API

### 10.1 Aplikasi

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/generation-runs` | Mulai buat/edit kelas → 202 + `runId` |
| GET | `/api/generation-runs/:id` | Snapshot status |
| GET | `/api/generation-runs/:id/events` | SSE progress, `maxDuration=300` |
| GET | `/api/stages/:id` | Dokumen kursus |
| GET | `/api/assets/:id` | Redirect ke Worker media |
| GET | `/api/health` | `{success:true,status:"ok"}` anonim |
| POST | `/api/auth/native/session` | Sesi Android |
| GET/PATCH | `/api/admin/users...` | Kelola akun |

### 10.2 Internal / edge

| Method | Path | Proteksi | Fungsi |
|---|---|---|---|
| POST | `/api/internal/maintenance` | `x-kelaska-cron-secret` | Ping DB, ringkasan job, status worker |
| GET | `/api/internal/workers` | Admin/session | Detail heartbeat |
| POST | `/api/admin/jobs/:id/requeue` | Admin | Requeue |
| POST | `/api/admin/jobs/:id/cancel` | Admin | Cancel |

Contoh response maintenance:

```json
{ "dbOk": true, "queued": 3, "stuck": 1, "workersOnline": 0, "checkedAt": "2026-11-20T12:00:00Z" }
```

### 10.3 Kontrak worker RPC

`register_worker`, `claim_worker_job`, `heartbeat_worker_job`, `complete_worker_job`, `fail_worker_job`, `reap_worker_jobs`. Semua idempoten; `false` berarti lease hilang → worker berhenti.

Payload contoh:

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

---

## 11. UX dan status

| Status | Teks UI | Aksi |
|---|---|---|
| `queued` | "Menunggu operator/worker" | Tampilkan jam operasional + notifikasi |
| `leased` | "Disiapkan" | — |
| `running` | "Membuat kelas…" + langkah | Progress |
| `waiting_media` | "Membuat media…" | Progress media |
| `succeeded` | "Kelas siap" | Buka kelas |
| `failed` | "Gagal: <alasan>" | Coba lagi / admin |
| `dead` | "Gagal permanen" | Admin requeue |
| `cancelled` | "Dibatalkan" | — |

Empty/offline:

- Worker tidak aktif: banner + `last_seen_at` + "Notifikasi sudah dikirim ke operator".
- Kuota Gemini habis: "Kuota model habis; hubungi admin."
- HF S3 gagal: placeholder + retry.
- Supabase pause: 503 + tautan status.

Mobile 390 px: kartu, status, tombol tetap terbaca; Android WebView tanpa jalur media kedua.

---

## 12. Keamanan, privasi, kepatuhan

| Ancaman | Mitigasi |
|---|---|
| IDOR kursus/aset | Owner scoping tiap query + uji matriks |
| Service role bocor | Role worker least privilege; rotasi; secret scan |
| Token media dibagikan | TTL ≤10 mnt; jangan log |
| SSRF | URL guard + allowlist |
| Prompt injection | Sanitasi HTML + CSP |
| Worker menyamar | Token per worker + lease owner check |
| Backup bocor | Enkripsi sebelum unggah; bucket privat |
| Access disetel | Verifikasi di Cloudflare, bukan header mentah di app |

Secret: Vercel encrypted env; GitHub Actions secrets; Supabase service role hanya server Vercel; Colab/Kaggle Secrets; rotasi `OPENMAIC_SECRET_KEY`, HF token, worker password tiap 90 hari. `OPENMAIC_SECRET_KEY` harus sama di semua instance web.

Kepatuhan: inventaris data, dasar pemrosesan, retensi, hak subjek, DPA vendor. Residensi wajib Indonesia → hentikan desain ini dan rancang on-prem.

---

## 13. Operasi dan runbook

### 13.1 Deploy web (branch `deploy/vercel`)

```bash
vercel link
vercel env pull .env.vercel.local
vercel deploy --prod
```

Verifikasi: `/api/health` 200; login; buka kursus contoh; `vercel logs` tanpa 500.

### 13.2 Deploy edge (branch `deploy/cloudflare`)

```bash
cd cloudflare
wrangler deploy -c wrangler.gateway.toml
wrangler deploy -c wrangler.media.toml
wrangler deploy -c wrangler.cron.toml
wrangler secret put MEDIA_TOKEN_SECRET -c wrangler.media.toml
wrangler secret put S3_SECRET_ACCESS_KEY -c wrangler.media.toml
wrangler secret put CRON_SECRET -c wrangler.cron.toml
wrangler secret put OPERATOR_WEBHOOK -c wrangler.cron.toml
```

Verifikasi: `curl https://api-kelas.riau.ai/` → 200 dari Vercel; `media-kelas.riau.ai` menolak token invalid 401; cron trigger manual di dashboard.

### 13.3 Menyalakan Colab

1. Buka notebook worker, isi Secrets (DB worker, Gemini, HF).
2. Jalankan sel setup + `bun run worker:course`.
3. Sesuai kebutuhan, jalankan `cloudflared tunnel` untuk `colab.riau.ai`.
4. Pantau `worker_heartbeats` dan antrean.
5. Matikan dengan `Ctrl+C` saat antrean kosong; pastikan lease dilepas.

### 13.4 Menyalakan Kaggle

1. GPU T4×2, Internet on.
2. `bash scripts/gpu-services.sh --gpu-dir=/kaggle/temp/gpu-models --skip ollama`.
3. Tunggu health `:8188`, `:8001`, `:8000`.
4. Set Secrets + `bun run worker:media`.
5. Pantau `nvidia-smi`; hentikan sebelum 12 jam.

### 13.5 Job macet

```sql
select reap_worker_jobs();
select id, kind, status, lease_expires_at
  from worker_jobs
 where status in ('leased','running') and lease_expires_at < now();
```

Via UI: Admin → Job → Requeue.

### 13.6 Backup & restore

```bash
pg_dump "$MIGRATION_DATABASE_URL" | gzip | age -r <pubkey> \
  > backup-$(date +%F).sql.gz
# unggah ke s3://kelaska/backups/<tanggal>/
age -d -i ~/.config/kelaska/age.key backup-....sql.gz | gunzip | psql "$STAGING_DATABASE_URL"
```

### 13.7 Rotasi secret & insiden

Rotasi: buat nilai baru → update Vercel/Worker secret → deploy/restart → cabut lama setelah 24 jam → catat.

| Gejala | Tindakan |
|---|---|
| Situs 500 | Vercel logs → rollback deployment → cek DB |
| Login gagal | Cek redirect URL + provider Google |
| Job menumpuk | Cek heartbeat → nyalakan worker → cek Gemini |
| Media 401/404 | Cek token, CORS, kredensial HF |
| Supabase pause | Resume + jalankan keep-alive |
| Worker OOM | Turunkan resolusi/batch; restart |

---

## 14. Biaya dan kapasitas

### 14.1 Per kursus

15–25 slide, 8–12 gambar, 6–10 menit audio, 0,5–2 MB JSONB, 30–80 MB media HF, 40–100 panggilan Gemini, 15–30 menit GPU.

### 14.2 Kapasitas

| Sumber | Batas | Kapasitas | Bottleneck |
|---|---|---|---|
| Supabase DB | 500 MB | 250–1.000 kursus | Ya |
| HF S3 | 100 GB | 1.250–3.000 kursus | Ya jika video |
| Kaggle GPU | 30 jam/minggu | 60–120 kursus/minggu | Ya |
| Gemini | 500 RPD | 5–12 kursus/hari | **Utama** |
| Vercel CPU | 4 jam/bulan | 50–150 rb render | Ya jika SSR berat |
| Realtime | 200 koneksi | 200 pengguna aktif | Ya |

### 14.3 Estimasi

| Skenario | Infra | Gemini | Total |
|---|---|---|---|
| Pilot 100 pengguna, 50 kursus/bln | Rp0 | Rp0 | ±Rp0 + domain |
| 1.000 pengguna, 500 kursus/bln | Vercel Pro $20 + Supabase Pro $25 + HF PRO $9 + Colab Pro $10 = $64 | $20–50 | ±$84–114 |
| Skala provinsi | VPS/container + GPU | Paid | Perencanaan terpisah |

---

## 15. Uji dan kriteria terima

### 15.1 Jenis uji

Unit (queue RPC, lease, idempotency, owner scoping), integrasi (pooler, presign, auth), E2E (login → buat kelas → worker → playback), beban (200 viewer, 20 job), chaos (worker mati, lease habis, HF 503, Supabase pause), keamanan (IDOR, token expiry, secret scan, SSRF), DR (restore staging), mobile (390 px + APK).

### 15.2 Kriteria terima fase 1

- [ ] Login Google aktif; pending ditolak jelas.
- [ ] Akun A tidak bisa baca/hapus kursus akun B.
- [ ] Buat/edit kelas → job `queued`; Colab teks; Kaggle media; hasil muncul.
- [ ] Worker dimatikan di tengah job → job kembali `queued`; worker lain selesai tanpa duplikat.
- [ ] Cron mendeteksi macet + keep-alive + notifikasi operator.
- [ ] Media lewat `media-kelas.riau.ai`, token ≤10 menit, tidak ada secret di bundle.
- [ ] Postgres lokal tidak berisi kursus/job sumber kebenaran.
- [ ] Restore backup ke staging berhasil.
- [ ] `/api/health` 200; halaman utama p95 <2,5 s.
- [ ] Alert 80% aktif.
- [ ] Docs di `docs.kelas.riau.ai`; status page tersedia.
- [ ] APK login + putar kursus dari domain baru.
- [ ] Runbook diuji operator baru.

### 15.3 Regresi existing

`bun run test`, `bun run test:e2e`, `node scripts/check-i18n-keys.mjs`, `node scripts/check-package-versions.mjs`. Perhatikan `tests/server/identity/cookie-guard.test.ts` (proxy/internal header) dan `tests/persistence/admin-course-library.test.ts`.

---

## 16. Rollout

| Milestone | Durasi | Deliverable | Exit |
|---|---|---|---|
| M0 Spike | 3 hari | Vercel build, Supabase pooler, HF presign, Kaggle outbound, Worker media | Semua lulus |
| M1 Jembatan | 1–2 minggu | Opsi A live, Supabase + HF S3, backup, alert | Login + buat kelas jalan |
| M2 Worker | 2–3 minggu | `worker:course`, `worker:media`, queue, UI status | Job teks+media selesai di staging |
| M3 Edge + Vercel | 2–3 minggu | Branch deploy, runner off, cron, Pages, gate fitur | E2E + beban lulus, rollback diuji |
| M4 Hardening | 1–2 minggu | DR, security, runbook, handover | §15.2 terpenuhi |

### 16.1 Checklist spike M0

- [ ] `vercel build` sukses (Node 24, Bun, heap 6144 MB).
- [ ] Cold start <3 s; fungsi terbesar <250 MB unzipped.
- [ ] Supabase session 5432 + `LISTEN/NOTIFY` dari Vercel; transaction 6543 untuk worker.
- [ ] RPC `claim_worker_job` bekerja dari Kaggle.
- [ ] Worker media: HMAC + SigV4 + Range + CORS dari `kelas-ka.riau.ai`.
- [ ] Cron trigger memanggil `/api/internal/maintenance` dengan secret.
- [ ] SSE 300 s + reconnect `Last-Event-ID`.
- [ ] Tunnel + Access: operator masuk, siswa ditolak.
- [ ] Ukur CPU/render → proyeksi 4 CPU-jam.
- [ ] Ukur satu kursus: Gemini calls, menit GPU, MB media.
- [ ] `pg_dump` + restore staging; tidak ada secret di bundle.

Hentikan Opsi B jika: session pooler tidak mendukung NOTIFY dari Vercel, build Vercel gagal, presign/CORS HF gagal, atau kuota Gemini tidak cukup 1 kursus/hari.

---

## 17. Risiko

| ID | Risiko | Severity | Mitigasi |
|---|---|---|---|
| R1 | ToS Colab/Kaggle untuk produksi | P1 | Notebook operator, review legal, fallback VPS/GPU paid |
| R2 | Worker tidak dinyalakan tepat waktu | P1 | Jam operasional + cron notifikasi + status UI |
| R3 | Vercel Hobby dijeda | P1 | Alert 80%, upgrade, rollback Opsi A |
| R4 | Supabase pause 7 hari | P1 | Cron keep-alive harian |
| R5 | Kuota Gemini habis | P1 | Paid tier, backoff, pesan jelas |
| R6 | Secret/worker role bocor | P1 | Least privilege, rotasi, audit |
| R7 | HF S3 down | P1 | Retry, cache, fallback |
| R8 | Residensi UU PDP | P1 | Kajian legal; opsi on-prem |
| R9 | Postgres lokal disalahartikan sebagai DB utama | P1 | Dokumentasi + uji: tidak ada tabel kursus di sana |
| R10 | SSE putus 300 s | P2 | Reconnect + polling |
| R11 | Build Vercel gagal | P2 | Spike M0, tracing, external packages |
| R12 | PBL/agent/video hilang | P2 | Gate off, fase 2 |
| R13 | Biaya tersembunyi | P2 | Dashboard + alert + review bulanan |
| R14 | Android media gagal | P2 | Uji APK + token presign |

Risiko yang harus diputuskan sebelum coding: R1, R2, R8, R9.

---

## 18. Pertanyaan terbuka

1. Siapa operator yang menyalakan Colab/Kaggle, dan jam berapa?
2. Apakah widget notifikasi cukup, atau perlu SMS/WhatsApp/on-call?
3. Apa kebijakan residensi data menurut UU PDP untuk sekolah ini?
4. Apakah siswa membawa key sendiri atau memakai key operator (D6)?
5. Apakah workspace harus interaktif penuh di fase 1, atau cukup read-only?
6. Apakah kelaska.riau.ai tetap dipakai sebagai alias atau langsung diganti?
7. Berapa ukuran data lama yang harus dimigrasikan dari host saat ini?
8. Apakah anggaran tersedia untuk Vercel/Supabase Pro/Gemini paid saat pilot tumbuh?
9. Apakah ToS Kaggle sudah ditinjau untuk pemakaian produksi?

---

## 19. Lampiran

### 19.1 Environment

**Vercel (`deploy/vercel`):**

```dotenv
DATABASE_URL=postgres://postgres.<ref>:<pw>@<region>.pooler.supabase.com:5432/postgres?sslmode=require
AUTH_ENABLED=true
AUTH_PUBLIC_URL=https://kelas-ka.riau.ai
AUTH_ADMIN_EMAILS=admin@dinas.belajar.id
OPENMAIC_SECRET_KEY=<32+ chars>
GOOGLE_API_KEY=<gemini>
GOOGLE_MODELS=gemini-3.5-flash-lite
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable>
SUPABASE_SERVICE_ROLE_KEY=<server only>
HF_S3_BUCKET=kelaska
HF_S3_ENDPOINT=https://s3.hf.co/<namespace>
HF_S3_REGION=us-east-1
HF_S3_ACCESS_KEY_ID=<id>
HF_S3_SECRET_ACCESS_KEY=<secret>
ASSET_BYTE_EGRESS=redirect
OPENMAIC_GENERATION_RUNNER_ENABLED=false
OPENMAIC_AGENT_RUNTIME_ENABLED=false
NEXT_PUBLIC_WORKBENCH_ENABLED=false
NEXT_PUBLIC_ENABLE_VIDEO_EXPORT=false
NEXT_PUBLIC_DOCS_URL=https://docs.kelas.riau.ai
CRON_SECRET=<shared with Cloudflare>
MEDIA_TOKEN_SECRET=<shared with Cloudflare Worker media>
WORKER_STATUS_ENDPOINT=https://api-kelas.riau.ai/worker/status
```

**Worker Colab/Kaggle:**

```dotenv
WORKER_DATABASE_URL=postgres://kelaska_worker:<pw>@<region>.pooler.supabase.com:6543/postgres?sslmode=require
WORKER_ID=<unique>
WORKER_KINDS=course.generate,course.edit   # Colab
WORKER_KINDS=course.media                    # Kaggle
GOOGLE_API_KEY=<gemini>
HF_S3_*
LOCAL_LOG_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/kelaska_log
COMFYUI_BASE_URL=http://127.0.0.1:8188
VOXCPM_BASE_URL=http://127.0.0.1:8001
FUNASR_BASE_URL=http://127.0.0.1:8000
```

**Cloudflare Worker secrets:** `MEDIA_TOKEN_SECRET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_BUCKET`, `CRON_SECRET`, `OPERATOR_WEBHOOK`, `KEEPALIVE_URL`, `KEEPALIVE_ANON_KEY`.

### 19.2 Branch deploy

```bash
# review / dokumentasi
git switch docs/prd-produksi-hybrid

# web tier
git switch -c deploy/vercel docs/prd-produksi-hybrid
# berisi: vercel.json, .env.vercel.example, feature-flag + maintenance route,
#         docs/deployment/vercel.md

# edge
git switch -c deploy/cloudflare docs/prd-produksi-hybrid
# berisi: cloudflare/workers/{gateway,media,cron}/src/index.ts,
#         wrangler.*.toml, docs/deployment/cloudflare.md
```

Keduanya branch turunan langsung dari PRD; deploy Vercel dari `deploy/vercel`, deploy Cloudflare dari `deploy/cloudflare`. Gabungkan keduanya jika ingin satu branch produksi tunggal. **Jangan jalankan `install.sh` dari worktree** — atau akan membuat cluster Postgres baru dan `.env.local` baru. Jalankan dari `/kaggle/temp/KelasKA`.

### 19.3 Verifikasi cepat

```bash
curl -s https://kelas-ka.riau.ai/api/health
curl -s -o /dev/null -w '%{redirect_url}\n' https://kelas-ka.riau.ai/api/auth/supabase/callback
curl -s -H 'x-kelaska-cron-secret: <secret>' -X POST https://api-kelas.riau.ai/api/internal/maintenance
psql "$MIGRATION_DATABASE_URL" -c "select status,count(*) from worker_jobs group by 1 order by 1;"
psql "$MIGRATION_DATABASE_URL" -c "select worker_id,kind,last_seen_at from worker_heartbeats order by 2 desc;"
aws s3 ls --endpoint-url "https://s3.hf.co/<namespace>" s3://kelaska/backups/ | tail
```

### 19.4 Referensi

- Vercel Hobby: <https://vercel.com/docs/plans/hobby>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Access/Tunnel: <https://developers.cloudflare.com/cloudflare-one/>
- Supabase quotas & pausing: <https://supabase.com/docs/guides/platform/billing-on-supabase>
- HF storage: <https://huggingface.co/docs/hub/storage-limits>
- Colab FAQ: <https://research.google.com/colaboratory/faq.html>
- Kaggle GPU: <https://www.kaggle.com/docs/efficient-gpu-usage>
- Repo: `README.md` (serverless ≤1.1.x), `.env.example`, `AGENTS.md`
- Diagram: `docs/prd/assets/arsitektur-produksi.{svg,png}`

### 19.5 Glosarium

| Istilah | Arti |
|---|---|
| Worker on-demand | Notebook yang dinyalakan operator hanya saat ada pekerjaan |
| Lease | Hak sementara worker atas job; kedaluwarsa bila tidak heartbeat |
| Reaper | Proses yang mengembalikan job lease kedaluwarsa ke antrean |
| Presigned URL | URL S3 bertanda tangan dengan TTL pendek |
| SigV4 | Skema tanda tangan AWS S3 (dipakai HF S3) |
| Tunnel | Koneksi keluar dari host lokal ke Cloudflare tanpa port inbound |
| BYOK | Bring Your Own Key |
| LangGraph | Orkestrator alur kerja di Colab |

---

## 20. Catatan penutup

Diagram lampiran sudah dijadikan rancangan kerja: Cloudflare menguasai edge, Vercel menguasai UI, Supabase menguasai data dan antrean, HF S3 menguasai byte, Colab/Kaggle dipakai **sesuai kebutuhan** dan tidak pernah dianggap server 24/7. Kunci keberhasilan ada pada tiga hal: (1) runner tidak pernah hidup di fungsi Vercel, (2) antrean + lease membuat worker bisa mati kapan saja, (3) notifikasi operator membuat mode on-demand tetap terasa responsif bagi sekolah.

Jika keputusan "produksi sekarang, biaya nol" → Opsi A. Jika "Vercel/Cloudflare adalah syarat" → setujui scope fase 1 dan jalankan M0 sebelum coding besar. Jangan memilih jalan tengah yang memaksa runner hidup di Vercel.
