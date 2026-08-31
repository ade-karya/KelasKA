# PRD KelasKA — Product Requirements Document

> **Versi:** 1.1 — 31 Agustus 2026  
> **Status:** Spesifikasi target (normatif). Sistem **wajib mengikuti** dokumen ini.  
> **Infra wajib:** **Vercel (Next.js) + Supabase (Auth, Postgres, Storage)** saja. Tidak ada Docker, Postgres self-host, `render-service`, atau VM di produksi.  
> **Repo:** `ade-karya/KelasKA` • Stack: `Next.js 16 / React 19 / Supabase / @openmaic/*`  
> **Dokumen terkait:** `PRD-KelasKA-Ringkas.md` (ringkasan), `PRD-KelasKA-Enterprise-Vercel-Supabase.md` (kontrak data, RLS, env, deploy).  
> **Supersedes:** v1.0 (30 Agustus 2026) yang bersifat reverse-engineering codebase. v1.1 adalah kontrak produk: gap vs kode dicatat di §17, bukan dijadikan kebenaran.

---

## 0. Prinsip produk

1. **Satu aplikasi sekolah, bukan dua produk yang disambung tautan.** Studio generate, dashboard, dan admin memakai **satu app shell** (sidebar + header + tenant + user).
2. **Landing publik ≠ aplikasi.** `/` hanya pemasaran/onboarding. Generate, nilai, dan kelola kelas hanya setelah login, di dalam shell.
3. **Pintu masuk per peran, lalu beranda peran.** Siswa → dashboard siswa. Guru → dashboard guru. Admin → dashboard admin. Bukan redirect guru ke CRUD `/admin`.
4. **Materi punya siklus hidup.** Generate → review guru → publish → assign ke kelas → siswa memutar. Tidak ada “langsung tampil ke siswa” dari composer publik.
5. **Navigasi hanya ke fitur yang hidup.** Item sidebar yang toast “segera hadir” dilarang. Jadwal tidak masuk nav sampai halaman ada.
6. **Produksi tanpa mode pratinjau.** Tanpa sesi: 401 / redirect ke `/masuk`. Data mock dan switch peran bebas dilarang di `VERCEL_ENV=production`.
7. **Jujur pada metrik dan klaim.** Tidak ada rating fiktif, tidak ada jam belajar baseline palsu.
8. **Infra tidak boleh diakal-akali.** Fitur yang tidak survive serverless Vercel (agent durable, export MP4 Chromium) **out of scope produksi**. Jangan masuk journey primer.

---

## 1. Executive Summary

**KelasKA** adalah platform pembelajaran generatif untuk SMK/vokasi (seed `KA-101..103` = Komputer Akuntansi). Guru membuat **kelas interaktif utuh** (slide + kuis + simulasi + PBL) dari satu prompt atau dokumen, **mereview lalu mem-publish**, menugaskan ke kelas, dan memantau nilai. Siswa login NISN, memutar materi yang di-assign, mengerjakan kuis, dan melihat hasilnya.

Value proposition (landing, tanpa klaim sosial fiktif):

> Satu prompt, satu kelas utuh. Review, publish, assign ke KA-101–103. Diputar siswa di dashboard.

Produk ini fork **OpenMAIC** yang dilokalkan (`id-ID`, NISN, kelas KA). Inti generate (outline → scene → classroom) **tetap**. Yang berubah di v1.1: **arsitektur informasi, shell, auth, dan siklus publish/assign** agar terasa aplikasi enterprise sekolah — tetap di Vercel + Supabase.

---

## 2. Visi, Misi & Tujuan

### 2.1 Visi

Setiap guru SMK membuat kelas digital berkualitas **tanpa skill desain**, dan setiap siswa belajar **aktif** pada materi yang **sudah direview guru** — bukan menonton video pasif, bukan menelan output AI mentah.

### 2.2 Misi

- Turunkan waktu pembuatan materi dari jam → menit, **dengan langkah review wajib**.
- Sediakan playback kelas (narasi, whiteboard, kuis, widget) yang jalan di browser sekolah.
- Pastikan data siswa/nilai terisolasi per tenant (sekolah) di Supabase.
- Tetap deployable di **Vercel Hobby/Pro + satu proyek Supabase**.

### 2.3 Goals & Success Metrics (KPI)

| Goal | Metric | Target | Sumber (jujur) |
|------|--------|--------|----------------|
| Adopsi guru | Kelas **published** / minggu | ≥ 20 | tabel `classrooms` status=`published` |
| Kecepatan kreasi | p50 `requirement → draft siap review` | < 2 menit | log generate + `classrooms.created_at` |
| Mutu | % draft yang di-publish (bukan dibuang) | ≥ 60% | `classrooms` |
| Engagement siswa | Submit kuis / sesi classroom | ≥ 1 | `quiz_attempts` |
| Reliability | Uptime app Vercel + Supabase | 99.5% | Vercel + Supabase status |
| Keamanan | Request dashboard/students tanpa auth | 0 data (401) | e2e + log |

**Dilarang sebagai KPI/AC:** `jamBelajar = attempts*0.5h + 8h baseline`. Jam belajar hanya ditampilkan jika ada durasi sesi nyata; jika belum diukur, tampilkan "—" atau jumlah percobaan kuis, bukan angka fiktif.

**Dilarang di UI pemasaran:** badge “4.9/5 dari 2.000+ guru” sampai ada survei nyata.

---

## 3. Stakeholder & Persona

### P1 — Guru Vokasi (Primary Creator)

- **Butuh:** Buat modul dari RPP/PDF, review, publish, assign ke kelas ampu, lihat nilai.
- **Pain:** Tidak ada waktu desain; takut AI salah konsep.
- **Journey (wajib):** `/masuk` → Login guru → **Beranda guru** → **Studio** (generate) → Preview/review → **Publish** → **Assign** ke `class_names` → pantau di Penilaian. Ekspor PPTX/HTML dari materi yang sudah jadi.

### P2 — Siswa SMK (Primary Learner)

- **Butuh:** Materi yang sudah di-assign kelasnya, putar, tanya, kuis dinilai, lihat nilai sendiri.
- **Pain:** Materi membosankan; internet tidak selalu stabil (mitigasi: ekspor HTML/ZIP, bukan janji native app).
- **Journey (wajib):** `/masuk` → Login NISN → **Beranda siswa** → **Kursus Saya** (hanya yang di-assign) → Classroom playback → Kuis → Nilai.

### P3 — Admin Sekolah / Operator

- **Butuh:** Kelola siswa/kelas/tugas, audit log, tidak melihat data sekolah lain.
- **Journey (wajib):** Login guru dengan `profiles.role=admin` → Beranda admin → Siswa / Kelas / Tugas / Log. Bukan halaman terpisah bergaya “panel lain”.

### P4 — Pengembang / Tim IT

- **Butuh:** Env Vercel + SQL Supabase; tanpa k8s.
- **Journey:** `PRD-KelasKA-Enterprise-Vercel-Supabase.md` + `.env` Vercel.

---

## 4. Batasan infrastruktur (non-negotiable)

Produksi **hanya**:

```
Vercel (Next.js 16, serverless/edge)
  ├─ Halaman: landing publik + app shell terautentikasi
  ├─ /api/*  maxDuration 300 (butuh plan yang mendukung; Hobby 10s → pecah SSE)
  └─ Env: LLM keys, AUTH_JWT_SECRET, Supabase URL/anon/service_role

Supabase
  ├─ Auth     guru/admin (email, Google)
  ├─ Postgres tenant, profiles, siswa, classrooms, assignments, quiz, logs
  ├─ Storage  bucket `assets` + `classrooms` (stage JSON + media)
  └─ RLS      jaring pengaman; enforcement primer Pola A (cek tenant di server)
```

**Dimatikan di produksi Vercel (wajib `false` / kosong):**

| Flag / layanan | Alasan | Pengganti di produk |
|----------------|--------|---------------------|
| `OPENMAIC_AGENT_RUNTIME_ENABLED` | Durable lease/heartbeat tidak survive freeze serverless | Tidak ada Workbench Pro di UI |
| `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED` | Entry `/workspace` 404/redirect | Sembunyikan badge Pro |
| `RENDER_SERVICE_URL` | Chromium 8GB tidak ada di Vercel | Ekspor PPTX/HTML/ZIP; MP4 out of scope |
| `DATABASE_URL` Postgres langsung | Tidak ada container Postgres | Supabase JS + pooler hanya jika perlu |
| Mode pratinjau dashboard | Bocor data + UX tidak enterprise | 401 + `/masuk` |

**Implikasi produk:** Journey guru **tidak** boleh menyebut Workbench/Agent chat. Studio = composer generate yang sudah ada, dipindah ke dalam shell.

---

## 5. Arsitektur informasi & sitemap

### 5.1 Peta rute target

```
Publik (tanpa sesi)
  /                      Landing pemasaran + CTA Masuk. TANPA composer generate.
  /masuk                 Pemilih peran: Siswa | Guru & Operator
  /login-siswa           NISN + kata sandi
  /login                 Email/Google (Supabase Auth)

App (wajib sesi; satu shell)
  /dashboard             Beranda sesuai peran (siswa | guru | admin)
  /studio                Generate kelas (guru, admin). Composer pindahan dari `/`.
  /generation-preview    Edit outline sebelum full gen (guru)
  /classroom/[id]        Playback. Siswa: hanya jika assigned+published.
                         Guru: draft milik sendiri atau assigned.
  /materi                Daftar draft / in_review / published milik guru
  /kelas                 Ringkasan kelas ampu (guru) — bukan CRUD mentah
  /penilaian             Nilai & kuis (guru)
  /admin                 CRUD siswa/kelas/tugas (admin; guru terbatas kelas ampu)
  /admin/activity-logs   Audit (admin)

Dilarang di produksi
  /workspace, /workbench/*   Out of scope Vercel → redirect `/dashboard`
  /dashboard tanpa auth      Redirect `/masuk`
  Switch peran bebas         Hanya dari JWT / profiles.role
```

### 5.2 App shell (satu chrome)

Setelah login, **semua rute app** memakai layout yang sama:

- **Header:** logo KelasKA + nama tenant (sekolah), search (opsional, hanya jika hasilnya nyata), notifikasi dari tugas/kuis nyata, user chip, tema, keluar.
- **Sidebar kiri (desktop) / drawer (mobile):** item **per peran**, hanya yang hidup.
- **Content:** halaman modul.
- **Footer shell:** tidak wajib; jangan tautan “Kembali ke Dashboard Utama” ke `/`.

**Sidebar siswa**

| Item | Tujuan | Status |
|------|--------|--------|
| Beranda | `/dashboard` | hidup |
| Kursus Saya | daftar `classroom_assignments` untuk `class_name` siswa | hidup |
| Tugas & Kuis | assignments + kuis pending | hidup |
| Nilai | skor sendiri | hidup |
| Pengaturan | ganti kata sandi | hidup |

**Sidebar guru**

| Item | Tujuan | Status |
|------|--------|--------|
| Beranda | `/dashboard` | hidup |
| Studio | `/studio` | hidup |
| Materi Saya | `/materi` | hidup |
| Kelas Saya | `/kelas` | hidup |
| Penilaian | `/penilaian` | hidup |
| Pengaturan | profil | hidup |

**Sidebar admin** = guru + Siswa, Kelas, Tugas, Log aktivitas (`/admin`, `/admin/activity-logs`).

**Tidak masuk sidebar sampai halaman ada:** Jadwal, Marketplace, Workbench, Laporan terpisah (pakai Penilaian + Log).

### 5.3 Redirect auth (kontrak)

| Kondisi | Aksi |
|---------|------|
| Buka `/dashboard`, `/studio`, `/admin`, `/materi`, … tanpa sesi | 302 `/masuk?next=…` |
| Siswa sudah login buka `/login-siswa` | 302 `/dashboard` |
| Guru sudah login buka `/login` | 302 `/dashboard` (bukan `/admin`) |
| Siswa buka `/studio` atau `/admin` | 403 halaman “Tidak diizinkan” di dalam shell |
| Guru `role=teacher` buka log audit | 403 kecuali `role=admin` |
| `profiles.role=admin` | boleh `/admin` dari sidebar |
| Produksi + query `?role=` / `?studentId=` spoof | diabaikan; identitas dari JWT/session |

Copy login guru: **“Masuk Guru KelasKA”**. Dilarang: “Supabase Auth & Activity Tracker”.

---

## 6. UX / UI Requirements (tampilan enterprise)

### 6.1 Design system — satu, bukan tiga

| Token | Nilai |
|-------|--------|
| Fondasi | Tailwind 4 + shadcn/ui + Radix (sudah ada) |
| Font | Inter (UI), JetBrains Mono (kode), Literata (materi panjang) |
| Warna app | `slate-950` background, `slate-900` surface, `indigo-600` aksen primer, `violet-600` aksen generate |
| Radius | `xl` / `2xl` konsisten (kartu 16–24px, tombol 12px) |
| Density | Dashboard/admin: tabel + form, bukan kartu marketing |
| Landing publik | Boleh lebih “marketing”, **token warna & logo sama** |
| Admin | **Bukan skin terpisah.** Pakai app shell yang sama dengan dashboard |

**Dilarang:** `alert()` / `confirm()` / `prompt()` di alur admin. Wajib dialog shadcn (`AlertDialog`) + toast `sonner`.

**Form siswa:** field kosong; **jangan** default `average_score=85`, `attendance_rate=100`, `status=Good`.

### 6.2 Landing publik (`/`)

- Navbar: Fitur, Cara Kerja, Untuk Siapa, **Masuk** (ke `/masuk`). Tidak ada tombol Dashboard yang membuka data tanpa login.
- Hero: janji produk tanpa rating fiktif. CTA primer: **Masuk**. CTA sekunder guru: “Masuk sebagai guru untuk membuat kelas”.
- **Composer generate tidak ada di `/`.** Cuplikan UI (gambar/GIF) boleh, interaktif tidak.
- Testimoni: hanya jika kutipan nyata; jika tidak, hapus seksi.

### 6.3 Halaman `/masuk`

Dua kartu setara: **Siswa (NISN)** dan **Guru & Operator (email)**. Bukan dua URL tersembunyi dari navbar yang hanya mengarah ke siswa.

### 6.4 Aksesibilitas

- WCAG AA: kontras di dark shell, fokus ring, label `sr-only`, `aria-pressed` pada toggle.
- Keyboard: generate `Cmd/Ctrl+Enter` di studio; classroom punya kontrol play yang bisa di-tab.
- Jangan andalkan warna saja untuk status (draft/published): pakai badge teks.

### 6.5 Empty, error, loading

Setiap daftar (kursus, materi, siswa) punya empty state + CTA. Error API: toast + tombol coba lagi. Loading: skeleton di dalam shell, bukan halaman blank.

---

## 7. Alur pengguna (wajib logis)

### 7.1 Siswa

```
/masuk → Siswa → /login-siswa (NISN)
     → /dashboard
          ├─ Kartu: kursus di-assign, tugas pending, rata-rata nilai nyata
          ├─ Kursus Saya → hanya classroom published+assigned ke class_name
          │                 klik → /classroom/[id]
          │                 playback: speech, whiteboard, widget, kuis
          │                 submit kuis → quiz_attempts (tenant_id + student_id dari JWT)
          └─ Nilai → daftar percobaan sendiri
```

Tidak ada generate, tidak ada admin, tidak ada data kelas lain.

### 7.2 Guru

```
/masuk → Guru → /login (Supabase Auth)
     → /dashboard (ringkasan kelas ampu, draft belum di-publish, tugas menunggu)
          → Studio
               ketik kebutuhan + upload PDF/PPTX/gambar/audio/video
               toggle Web Search / Interactive Mode
               Generate (SSE outline)
               → /generation-preview (edit outline)
               → full gen content + actions + TTS/image
               → status = draft, simpan ke Supabase Storage + row classrooms
          → Review di /classroom/[id] (guru)
               setujui → status in_review → published
               atau kembalikan ke draft
          → Assign: pilih class_names ⊆ profiles.class_names
               tulis classroom_assignments
          → Siswa kelas itu melihat di Kursus Saya
          → Penilaian: kuis/tugas kelas ampu
          → Ekspor PPTX / HTML / ZIP (bukan MP4)
```

### 7.3 Admin

```
Login role=admin → /dashboard
     → /admin Siswa | Kelas | Tugas
     → /admin/activity-logs (append-only)
     → tidak bisa lihat tenant_id lain
```

CRUD memakai dialog konfirmasi, bukan `window.confirm`.

### 7.4 Siklus hidup materi (inti v1.1)

```
draft ──review guru──► in_review ──publish──► published ──assign──► terlihat siswa
  ▲                         │                      │
  └──── tolak / revisi ─────┘                      └── archive
```

- Siswa **hanya** melihat `published` yang punya baris `classroom_assignments` untuk `class_name`-nya dan `tenant_id` sama.
- Guru melihat draft miliknya (`created_by`) plus published yang di-assign ke kelas ampu.
- Generate gagal (LLM) = fail-loud, draft tidak auto-publish.

---

## 8. Ruang lingkup

### 8.1 In scope — produksi Vercel + Supabase

| Area | Fitur |
|------|--------|
| **Auth** | Siswa NISN+bcrypt+JWT (`tenant_id` di payload). Guru/admin Supabase Auth + `profiles`. Pemilih peran `/masuk`. |
| **Shell** | Layout app satu, sidebar per peran, header tenant. |
| **Studio** | Composer free-form + upload (PDF/DOCX/PPTX/TXT/MD/Image/Audio/Video), Web Search, Interactive Mode, pipeline outline→content→actions. |
| **Review/Publish/Assign** | Status classroom + assign ke kelas. |
| **Playback** | Stage 4 tipe `slide\|quiz\|interactive\|pbl`, aksi speech/whiteboard/spotlight, widget interaktif, Q&A jika ASR dikonfigurasi. |
| **Dashboard** | Siswa: kursus assigned, tugas, nilai. Guru: performa kelas ampu. Tanpa mock di prod. |
| **Admin** | Siswa, kelas, tugas, log — dalam shell yang sama. |
| **Ekspor** | PPTX editable, HTML inlining, ZIP `.maic.zip`. |
| **i18n & tema** | `id-ID` default, light/dark/system. |
| **Observability** | `user_activity_logs` append-only, `/api/health`, Vercel Logs. |

### 8.2 Out of scope produksi (jangan di-nav, jangan di journey)

- Workbench Pro / agent durable (`/workspace`, `/workbench`, `/api/agent/sessions*`).
- Export MP4 / `render-service`.
- Mode pratinjau dashboard + `MOCK_STUDENTS` di production.
- Pembayaran, sertifikat, LMS enrollment penuh, SCORM/xAPI.
- Kolaborasi real-time multi-siswa pada satu stage.
- Mobile native; PWA push (fase nanti).
- Kalender Jadwal (sampai halaman dibangun).
- Multi-tenant UI penuh (fase 4); **kolom `tenant_id` tetap wajib** dari sekarang (single-tenant default UUID).

### 8.3 Asumsi

- ≥1 LLM provider key di env Vercel.
- `ffmpeg` tidak dijamin di serverless; ekstraksi PDF via MinerU/AliDocMind cloud, bukan janji ffmpeg lokal.
- Upload besar: **direct ke Supabase Storage (signed URL)**, bukan body 4.5MB Vercel.
- Generate panjang: SSE streaming; plan Vercel harus mendukung `maxDuration` yang dipakai.

---

## 9. User Stories & Acceptance Criteria

### EPIC 0 — Pintu masuk & shell

**US-0.1** Sebagai pengunjung, saya memilih Siswa atau Guru di `/masuk`, bukan menebak URL.

- **AC1:** Navbar “Masuk” → `/masuk`.
- **AC2:** `/` tidak merender composer dan tidak menautkan `/dashboard` tanpa sesi.

**US-0.2** Sebagai pengguna, setelah login saya selalu masuk ke `/dashboard` di dalam app shell.

- **AC1:** Guru tidak di-redirect ke `/admin`.
- **AC2:** Produksi tanpa cookie/JWT: semua rute app → `/masuk`.
- **AC3:** Sidebar hanya item §5.2; tidak ada “Jadwal”.

**US-0.3** Sebagai operator, saya tidak melihat copy internal.

- **AC:** Judul `/login` = “Masuk Guru KelasKA”. Subtitle menjelaskan akses mengajar & admin sekolah.

### EPIC 1 — Generasi kelas (Studio)

**US-1.1** Sebagai guru, saya mengetik kebutuhan bebas dan mendapat outline editable sebelum full generate.

- **AC1:** `UserRequirements.requirement` wajib; `webSearch` / `interactiveMode` opsional.
- **AC2:** Pipeline: `scene-outlines-stream` → preview → `scene-content` + `scene-actions`.
- **AC3:** Hasil tersimpan `classrooms.status='draft'`, `created_by=profiles.id`, `tenant_id` dari profil.

**US-1.2** Sebagai guru, saya unggah RPP (PDF/DOCX/PPTX) + gambar; AI memakai isinya.

- **AC:** Dedup materi via fingerprint; file besar via signed URL Supabase Storage; ekstraksi `/api/extract-document`.

**US-1.3** Sebagai guru, saya mengedit slide dan menyiapkan kuis.

- **AC:** Schema `SlideContent` / `QuizContent` (`single\|multiple\|short_answer`) tidak berubah.

### EPIC 2 — Review, publish, assign

**US-2.1** Sebagai guru, saya memutar draft sendiri sebelum siswa melihatnya.

- **AC:** `/classroom/[id]` untuk draft hanya `created_by` atau admin tenant. Siswa dapat 403.

**US-2.2** Sebagai guru, saya publish lalu assign ke kelas ampu.

- **AC1:** Publish hanya dari `in_review` atau dari draft dengan konfirmasi dialog (“Siswa belum melihat sampai Anda assign”).
- **AC2:** Assign hanya `class_names` yang ada di `profiles.class_names` (admin: semua kelas tenant).
- **AC3:** Siswa kelas lain tidak melihat materi.

**US-2.3** Sebagai guru, saya archive materi; siswa tidak lagi melihatnya.

- **AC:** `status=archived` menghapus visibilitas siswa; data kuis lama tetap untuk audit.

### EPIC 3 — Pembelajaran (Playback)

**US-3.1** Sebagai siswa, saya memutar kelas assigned: narasi, spotlight/laser, whiteboard.

- **AC:** Urutan `Action` dieksekusi; `speech` menunggu TTS; whiteboard koordinat 0–1000×562.

**US-3.2** Sebagai siswa, saya submit kuis dan melihat skor saya.

- **AC:** `quiz_attempts.student_id` dari JWT, bukan query string. `tenant_id` diisi server.

**US-3.3** Sebagai siswa, saya memakai widget interaktif jika scene `interactive`.

- **AC:** 6 widget typed (`simulation|diagram|code|game|visualization3d|procedural-skill`).

### EPIC 4 — Dashboard & admin

**US-4.1** Sebagai siswa, saya melihat kursus assigned, tugas pending, rata-rata nilai.

- **AC:** `GET /api/dashboard` mengabaikan `?studentId=` jika JWT ada. Tanpa JWT di prod: 401.
- **AC jam belajar:** hanya jika `classroom_sessions.duration_seconds` ada; else jangan fabrikasi.

**US-4.2** Sebagai guru, saya melihat per kelas ampu: avg skor, submitted/total.

- **AC:** Filter `tenant_id` + `class_name IN profiles.class_names`.

**US-4.3** Sebagai admin, saya CRUD siswa/kelas/tugas dengan dialog, bukan `alert`.

- **AC:** Form siswa tanpa nilai default 85. Hapus siswa = `AlertDialog`. Error = toast.

### EPIC 5 — Ekspor (tanpa MP4)

**US-5.1** Guru mengekspor PPTX (LaTeX tetap) dan HTML/ZIP untuk intranet.

- **AC:** MP4 tidak ditawarkan di UI produksi jika `RENDER_SERVICE_URL` kosong (jangan tombol rusak).

### EPIC 6 — Kepatuhan

**US-6.1** Admin melihat log append-only.

- **AC:** Tidak ada update/delete `user_activity_logs` dari klien.

---

## 10. Persyaratan fungsional (modul)

### 10.1 Halaman & rute — mapping dari kode sekarang

| Sekarang | Target | Catatan implementasi |
|----------|--------|----------------------|
| `/` composer + landing | `/` landing saja; composer → `/studio` | Pindahkan UI generate |
| `/login` judul Supabase Auth; redirect `/admin` | Copy guru; redirect `/dashboard` | |
| Navbar Masuk → `/login-siswa` | → `/masuk` | Tambah halaman pemilih |
| `/dashboard` preview + switch peran | Auth wajib; peran dari sesi | Hapus mock prod |
| Sidebar “Kursus Saya” → `/workspace` | Daftar assigned classrooms | |
| Sidebar “Kelas Saya”/“Penilaian” → `/admin` | `/kelas`, `/penilaian` (boleh reuse query admin, UI beda) | |
| Sidebar “Jadwal” toast | Hapus item | |
| `/admin` skin terpisah; link ke `/` | Layout shell; back → `/dashboard` | |
| `/workspace`, `/workbench/new` | Redirect `/dashboard` di prod | Flag off |
| `/classroom/[id]` terbuka | Gate published+assigned untuk siswa | |

### 10.2 Model data — Supabase enterprise (Vercel)

> **Sumber kebenaran:** `supabase_migration.sql` (base 10 tabel) + `supabase_migration_enterprise_vercel.sql` (enterprise hardening). PRD ini merefleksikan SQL enterprise **apa adanya** per 31 Agustus 2026. Jika ada drift, jalankan SQL enterprise, bukan ubah PRD.

**Base (10 tabel, `supabase_migration.sql`):** `classes`, `subjects`, `students`, `student_scores`, `attendance`, `assignments`, `teacher_notes`, `user_activity_logs`, `quiz_attempts`, `quiz_attempt_answers`. Seed `KA-101..103` + 7 siswa (password bcrypt). RLS awal `USING(true)` **wajib dihapus** oleh migrasi enterprise (G10).

**Enterprise — tenant & RBAC (`supabase_migration_enterprise_vercel.sql` §1–5):**

```sql
-- tenants (sekolah)
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null, name text not null,
  created_at timestamptz not null default now()
);
insert into public.tenants values ('00000000-0000-0000-0000-000000000001','default','SMK Default');

-- profiles (guru/admin → auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  role text not null check (role in ('teacher','admin')),
  class_names text[] not null default '{}',
  created_at timestamptz not null default now()
);
-- RLS: self read/upsert only; service_role bypass
```

Kolom `tenant_id` (default `000...001`, backfill `where null`) ditambahkan ke: `classes`, `students`, `subjects`, `assignments`, `quiz_attempts`, `user_activity_logs` — plus index `idx_*_tenant*`. Helper RLS:

```sql
create or replace function public.is_same_tenant(tid uuid) returns boolean
  language sql stable security definer as $$
  select exists(select 1 from public.profiles where id = auth.uid() and tenant_id = tid);
$$;
```

Semua policy `USING(true)` diganti tenant-scoped (`is_same_tenant(tenant_id)` atau via `students`/`quiz_attempts` FK), `user_activity_logs` jadi append-only (`select` + `insert` saja, no `update/delete`).

**Siklus materi — classrooms (PRD v1.1 §7.4, SQL §8):**

```sql
create table public.classrooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  created_by uuid references public.profiles(id),
  title text not null default '',
  status text not null default 'draft' check (status in ('draft','in_review','published','archived')),
  stage_payload_path text, -- storage path JSON OpenMAIC Stage
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index idx_classrooms_tenant_status on public.classrooms(tenant_id, status);
create index idx_classrooms_created_by on public.classrooms(created_by);

create table public.classroom_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  class_name text not null, -- KA-101..103
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  unique (classroom_id, class_name)
);
create index idx_cassign_tenant_class on public.classroom_assignments(tenant_id, class_name);
```

RLS `tenant classrooms/assignments` via `is_same_tenant`. Storage bucket `classrooms` private path `{tenant_id}/{classroom_id}/stage.json` + media; bucket `assets` private untuk upload besar via signed URL (body Vercel 4.5MB tidak dipakai).

**Jam belajar jujur — classroom_sessions (opsional fase 4, SQL §8b):**

```sql
create table public.classroom_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  classroom_id uuid not null references public.classrooms(id),
  student_id uuid not null references public.students(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz, duration_seconds int
);
```

Sampai tabel ini ada: **UI wajib tampilkan "—"** untuk jam belajar, jangan `attempts*0.5+8` fiktif.

**Rate limit (tanpa Redis, SQL §6):** `rate_limits(tenant_id, key, window_start, count)` PK `(tenant_id,key,window_start)`, RLS deny-by-default (`using(false)`), akses hanya `service_role`.

**Storage:** bucket `assets` + `classrooms` private, policy `storage.objects` `using(false)` (anon deny, upload via signed URL server, `service_role` bypass).

### 10.3 Pipeline generate (tetap)

1. Outline SSE `POST /api/generate/scene-outlines-stream`
2. Content `POST /api/generate/scene-content`
3. Actions `POST /api/generate/scene-actions`
4. TTS/image `POST /api/generate/tts|image` (video gen boleh gagal-loud; tidak wajib di Vercel)

Provider gagal → fail-loud, bukan tebak vendor.

Setelah sukses: persist draft ke Storage + `classrooms`.

### 10.4 Widget interaktif

Tidak berubah: `simulation`, `diagram`, `code`, `game`, `visualization3d`, `procedural-skill` (`lib/types/widgets.ts`).

### 10.5 API auth (kontrak)

- `GET /api/dashboard`, `GET /api/students`, mutate admin: **wajib** Bearer siswa **atau** sesi guru.
- Identitas siswa **hanya** dari JWT, bukan `?studentId=`.
- Semua query: `.eq('tenant_id', tenantId)`.
- Guru: `.in('class_name', profile.class_names)` kecuali admin.
- Produksi: tidak ada cabang `MOCK_STUDENTS`.

---

## 11. Persyaratan non-fungsional

| Kategori | Requirement | Metrik |
|----------|-------------|--------|
| **Performa** | p50 draft siap review <2m; slide 60fps | Vercel logs, observasi |
| **Payload** | Upload >4.5MB via signed URL Storage | E2E upload 10MB PDF |
| **Keamanan** | JWT siswa, bcrypt, tenant check, ACCESS_CODE opsional | OWASP; e2e 401 |
| **Reliabilitas** | SSE retry; fail-loud LLM | 99.5% |
| **Offline** | HTML/ZIP inlining untuk intranet | QA manual |
| **A11y** | WCAG AA pada shell + login + dashboard | axe |
| **Observability** | Vercel Logs + `user_activity_logs` | |
| **Klaim UI** | Tidak ada angka pemasaran tanpa sumber | Review copy |

---

## 12. Keamanan, privasi & kepatuhan

- Siswa: `nisn` + `password_hash` bcrypt, JWT berisi `studentId`, `class_name`, `tenant_id`, TTL 7 hari.
- Guru: Supabase Auth; `profiles.role` ∈ `{teacher, admin}`.
- Enforcement primer **Pola A:** server `service_role` + cek tenant/role di kode (wajib, karena service_role bypass RLS).
- RLS tenant = jaring pengaman (Pola B kapan client anon dipakai).
- Policy `FOR ALL USING (true)` **harus dihapus** sebelum produksi (migrasi enterprise).
- Asset bytes di Supabase Storage; signed URL; tidak lewat body Vercel untuk file besar.
- Log aktivitas append-only.

Detail SQL/env: `PRD-KelasKA-Enterprise-Vercel-Supabase.md`.

---

## 13. Analitik & event

| Event | Payload | Tabel |
|-------|---------|-------|
| `auth.login` | role, tenant_id | `user_activity_logs` |
| `classroom.generate.start/complete` | sceneCount, duration | logs |
| `classroom.publish` | classroom_id | logs + `published_at` |
| `classroom.assign` | class_name | `classroom_assignments` |
| `quiz.submit` | attempt_id, score | `quiz_attempts` |
| `export.pptx/html/zip` | classroom_id, format | logs |

Tidak ada event dummy untuk mengisi grafik.

---

## 14. Integrasi & konfigurasi (Vercel)

Env produksi (ringkas; lengkap di addendum):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AUTH_JWT_SECRET=          # openssl rand -hex 32
DEFAULT_MODEL=google:gemini-3-flash-preview
OPENAI_API_KEY=           # atau provider lain; ≥1 wajib

OPENMAIC_AGENT_RUNTIME_ENABLED=false
NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false
RENDER_SERVICE_URL=
```

Mode jalan produksi: **Vercel deploy**. Lokal: `pnpm dev` + Supabase cloud (bukan docker-compose sebagai target prod).

---

## 15. Roadmap implementasi (mengikuti PRD ini)

### Fase 1 — Shell & pintu (P0, 3–5 hari)

- [ ] Halaman `/masuk`
- [ ] Pindah composer `/` → `/studio`
- [ ] Layout app shell; admin memakai shell yang sama
- [ ] Redirect login guru → `/dashboard`
- [ ] Hapus preview/mock di production; 401 API
- [ ] Hapus nav Jadwal; perbaiki tujuan Kursus/Kelas/Penilaian
- [ ] Copy login guru; ganti `alert`/`confirm`; form siswa tanpa default nilai
- [ ] Sembunyikan Workbench/Pro/MP4 di prod

### Fase 2 — Siklus materi (P0, 4–7 hari)

- [ ] Tabel `classrooms` + `classroom_assignments` + Storage
- [ ] Persist draft setelah generate
- [ ] Gate playback siswa
- [ ] UI Publish + Assign
- [ ] Dashboard siswa baca assignment, bukan mock

### Fase 3 — Hardening tenant (P0, 2–4 hari)

- [ ] Jalankan `supabase_migration_enterprise_vercel.sql`
- [ ] Patch `dashboard` + `students` + admin queries: tenant + class scope
- [ ] Rate limit generate (tabel `rate_limits` atau Vercel KV)
- [ ] Audit append-only

### Fase 4 — Fitur guru lanjutan (4–8 minggu)

- [ ] CRUD assignments lengkap dari `/penilaian`
- [ ] Penilaian esai AI + konfirmasi guru
- [ ] `classroom_sessions` → jam belajar jujur
- [ ] Kalender Jadwal **baru boleh** masuk nav

### Fase 5 — Skala

- [ ] Multi-tenant UI (slug sekolah)
- [ ] SSO
- [ ] PWA

---

## 16. Risiko

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Timeout generate di Vercel Hobby (10s) | Gagal create | SSE + pecah scene; dokumentasikan butuh Pro untuk 300s |
| Payload 4.5MB | Upload RPP gagal | Signed URL Storage |
| Halusinasi materi | Miskonsepsi | Review wajib sebelum publish; webSearch disarankan |
| `service_role` bypass RLS | Bocor jika lupa cek tenant | Checklist code review + e2e lintas tenant |
| Workbench “kelihatan” di UI | Tombol 404 | Flag off + redirect |
| MP4 dijanjikan | Tombol rusak | Sembunyikan jika tidak ada render-service |

---

## 17. Gap vs kode sekarang (wajib ditutup)

Dokumen v1.0 mendeskripsikan *apa yang ada*. Ini *apa yang harus diubah*:

| ID | Sekarang | Target PRD |
|----|----------|------------|
| G1 | `/` = landing + generate | Generate hanya `/studio` |
| G2 | Login guru → `/admin`, copy “Supabase Auth…” | → `/dashboard`, copy produk |
| G3 | Dashboard bisa tanpa login (preview + mock) | Prod 401 / `/masuk` |
| G4 | Nav ke `/workspace`, toast Jadwal, admin via shortcut | Nav §5.2 |
| G5 | Tidak ada publish/assign | `classrooms` + assignments |
| G6 | Tiga skin visual | Satu shell |
| G7 | `alert`/`confirm`; default nilai 85 | Dialog + form kosong |
| G8 | `jamBelajar` formula +8h; badge 4.9/5 | Hapus |
| G9 | Workbench di journey guru | Out of scope Vercel |
| G10 | RLS `USING(true)` | Migrasi enterprise + cek tenant di API |
| G11 | Admin “kembali” ke `/` | ke `/dashboard` |

---

## 18. Definition of Done (rilis enterprise Vercel)

- [ ] Semua AC Epic 0–2 dan US-4.1 lolos Playwright (auth gate, assign visibility, no mock prod).
- [ ] `pnpm build` hijau.
- [ ] Lighthouse a11y ≥90 pada `/masuk`, `/login-siswa`, `/dashboard`.
- [ ] `curl /api/dashboard` tanpa `Authorization` → **401**, bukan JSON demo.
- [ ] Guru KA-101 tidak menerima siswa/materi tenant lain.
- [ ] Siswa tidak membuka draft.
- [ ] UI produksi tanpa Workbench, tanpa MP4, tanpa Jadwal, tanpa rating fiktif.
- [ ] Ekspor PPTX/HTML/ZIP berhasil; MP4 tidak ditawarkan.
- [ ] Migrasi enterprise terpasang di proyek Supabase.

---

## 19. Pertanyaan terbuka (produk)

1. Tenant slug: per sekolah (rekomendasi) atau per jurusan? Kelas tetap `KA-101..` di dalam tenant.
2. Nilai kuis AI: final otomatis atau wajib konfirmasi guru? Rekomendasi: objektif auto, esai konfirmasi.
3. Unifikasi login siswa ke `nisn` saja (`nim` legacy).
4. Kuota generate per tenant / bulan (rekomendasi: 100, enforce `rate_limits`).
5. Model default ID: biaya vs mutu bahasa Indonesia.

---

## 20. Lampiran — jejak file

- `app/page.tsx` — landing (harus kehilangan composer)
- `app/dashboard/page.tsx`, `app/api/dashboard/route.ts`
- `app/login/page.tsx`, `app/login-siswa/page.tsx`
- `app/admin/page.tsx`, `app/admin/activity-logs/`
- `app/classroom/[id]/`, `app/generation-preview/`
- `app/workspace/`, `app/workbench/` — out of scope prod
- `packages/@openmaic/dsl/src/stage.ts`, `action.ts`
- `lib/types/generation.ts`, `lib/types/widgets.ts`
- `lib/auth/jwt.ts`, `lib/auth/student-session.ts`
- `supabase_migration.sql`, `supabase_migration_enterprise_vercel.sql`
- `vercel.json` (`maxDuration` 300)

---

> **Cara pakai:** `PRD-KelasKA.md` adalah sumber kebenaran produk. Implementasi yang bertentangan dengan §0, §4, §5, §7 dianggap bug. Perubahan fitur wajib update dokumen ini + `CHANGELOG.md`. Addendum infra: `PRD-KelasKA-Enterprise-Vercel-Supabase.md`.
