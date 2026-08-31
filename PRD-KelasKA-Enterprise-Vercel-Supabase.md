# Addendum Enterprise — KelasKA di Vercel + Supabase

> Melengkapi `PRD-KelasKA.md` v1.1.  
> Fokus: **jadikan produk mengikuti PRD (shell, auth, publish/assign, tampilan satu sistem) sambil tetap hanya di Vercel + Supabase.**  
> Tidak ada Docker, Postgres self-host, `render-service`, agent runtime, atau pindah VM.

---

## 0. Prinsip

1. **Tetap Vercel + Supabase** — tidak ada container `postgres:16` / Chromium di prod.
2. **Enterprise = satu app sekolah + RLS/RBAC/tenant/audit + siklus materi**, bukan ganti infra.
3. **Pola A (sekarang):** server pakai `service_role` (bypass RLS) + **cek tenant/role/identitas di setiap API**. RLS = jaring pengaman.
4. **Zero-downtime:** `tenant_id` nullable → backfill → not null; tabel `classrooms` baru tidak memecah generate yang masih di IndexedDB selama cutover.
5. **Fitur yang tidak survive serverless tidak di-UI-kan.** Workbench dan MP4 off, bukan “tombol rusak”.

---

## 1. Arsitektur target

```
Vercel (Next.js 16)
 ├─ Publik:  /  /masuk  /login  /login-siswa
 ├─ App shell (sesi wajib):
 │    /dashboard  /studio  /generation-preview  /materi  /kelas  /penilaian
 │    /classroom/[id]  /admin  /admin/activity-logs
 ├─ Edge/Serverless  maxDuration 300  vercel.json
 │    /api/generate/*     LLM fail-loud
 │    /api/dashboard      auth + tenant + class scope
 │    /api/students       idem
 │    /api/classrooms*    draft/publish/assign
 │    /api/auth/*         JWT siswa + Supabase Auth guru
 └─ Static: landing, aset playback

Supabase
 ├─ Auth          guru/admin (email, Google)
 ├─ Postgres      10 tabel lama + tenants + profiles + classrooms + classroom_assignments
 ├─ Storage       bucket `assets`, `classrooms` (JSON stage + media)
 ├─ RLS           is_same_tenant (safety net)
 └─ (opsional)    Realtime dashboard

Wajib off di Vercel prod:
  OPENMAIC_AGENT_RUNTIME_ENABLED=false
  NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false
  RENDER_SERVICE_URL=
  /workspace dan /workbench/*  → redirect /dashboard
```

**Kenapa off:** Agent durable butuh lease/heartbeat yang freeze setelah response serverless. Render MP4 butuh ~8GB Chromium. Menyalakan = timeout/500.

**Pengganti produk:** Studio = composer generate di `/studio`. Ekspor = PPTX/HTML/ZIP. Playback = client + aset Storage.

---

## 2. Apa yang diubah vs v1.0 (produk + infra)

| Item | v1.0 (pilot / kode sekarang) | v1.1 (enterprise Vercel+Supabase) |
|------|------------------------------|-------------------------------------|
| `/` | Landing + composer publik | Landing saja; composer di `/studio` (guru) |
| Auth UX | Dua URL; guru → `/admin`; copy “Supabase Auth…” | `/masuk` pemilih peran; guru → `/dashboard`; copy produk |
| Dashboard | Preview tanpa login + mock | 401 / redirect `/masuk`; tidak ada `MOCK_STUDENTS` di prod |
| Nav | Workspace, Jadwal toast, admin shortcut | Hanya item hidup per peran (PRD §5.2) |
| Materi | Generate = langsung classroom | `draft → in_review → published` + `classroom_assignments` |
| Shell | 3 skin (landing / dashboard / admin) | Satu layout app; admin di dalam shell |
| RLS | `USING(true)` | Hapus; tenant policy + cek manual API |
| Asset | S3/Postgres atau IndexedDB | Supabase Storage signed URL |
| Workbench | Journey guru | Out of scope; flag off |
| MP4 | Disebut di PRD | Tombol disembunyikan |
| Rate limit | Tidak ada | Tabel `rate_limits` atau Vercel KV |
| Jam belajar | `attempts*0.5+8` | Jangan tampil sampai ada `classroom_sessions` |

Total P0 (shell + materi + tenant): kira-kira **2 minggu kerja**, tanpa pindah infra.

---

## 3. Model data — tambahan (Supabase)

Jalankan **setelah** `supabase_migration.sql`, file dasar tenant sudah ada di `supabase_migration_enterprise_vercel.sql`. **Tambahan v1.1** (siklus materi) harus ditambahkan ke migrasi yang sama atau file follow-up; kontrak di bawah ini normatif.

### 3.1 Sudah di `supabase_migration_enterprise_vercel.sql`

- `tenants (id, slug, name)`
- `profiles (id→auth.users, tenant_id, role teacher|admin, class_names text[])`
- `tenant_id` pada `classes`, `students`, `assignments`, `quiz_attempts`, `user_activity_logs`
- helper `is_same_tenant(uuid)`
- hapus policy publik `USING(true)`
- bucket Storage `assets`

### 3.2 Wajib baru — classrooms

```sql
create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  created_by uuid references public.profiles(id),
  title text not null default '',
  status text not null default 'draft'
    check (status in ('draft','in_review','published','archived')),
  stage_payload_path text, -- storage path JSON OpenMAIC Stage
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists idx_classrooms_tenant_status
  on public.classrooms(tenant_id, status);
create index if not exists idx_classrooms_created_by
  on public.classrooms(created_by);

create table if not exists public.classroom_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  class_name text not null,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  unique (classroom_id, class_name)
);
create index if not exists idx_cassign_tenant_class
  on public.classroom_assignments(tenant_id, class_name);

alter table public.classrooms enable row level security;
alter table public.classroom_assignments enable row level security;

create policy "tenant classrooms"
  on public.classrooms for all
  using (public.is_same_tenant(tenant_id))
  with check (public.is_same_tenant(tenant_id));

create policy "tenant classroom_assignments"
  on public.classroom_assignments for all
  using (public.is_same_tenant(tenant_id))
  with check (public.is_same_tenant(tenant_id));
```

Storage: bucket `classrooms` (private). Path: `{tenant_id}/{classroom_id}/stage.json` + media.

### 3.3 Opsional fase 4 — jam belajar jujur

```sql
create table if not exists public.classroom_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  classroom_id uuid not null references public.classrooms(id),
  student_id uuid not null references public.students(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int
);
```

Sampai ini ada: UI **tidak** menampilkan jam belajar fiktif.

### 3.4 Rate limit (tanpa Redis)

```sql
create table if not exists public.rate_limits (
  tenant_id uuid not null,
  key text not null, -- mis. 'generate' | ip
  window_start timestamptz not null,
  count int not null default 0,
  primary key (tenant_id, key, window_start)
);
```

Atau Vercel KV: `incr rl:{tenant}:{path}:{window}`.

---

## 4. RLS & enforcement API

`lib/supabase/server.ts` memakai `SUPABASE_SERVICE_ROLE_KEY` → **bypass RLS**. Jadi:

- **Primer:** setiap handler cek sesi + `tenant_id` + role + (untuk siswa) id dari JWT.
- **Sekunder:** policy `is_same_tenant` jika suatu saat client anon.

**Jangan** hardcode `tenant_id = '00000000-0000-0000-0000-000000000001'` di policy (itu bocor lintas tenant). Default UUID hanya untuk backfill single-school.

### 4.1 `GET /api/dashboard` — wajib

```
authenticatedStudent = getAuthenticatedStudent(req)
jika ada:
  role = siswa
  studentId = JWT.student.id          // abaikan ?studentId=
  className = JWT.student.class_name
  tenantId = JWT.student.tenant_id
  data = classrooms published
         join classroom_assignments where class_name + tenant
         + assignments + quiz_attempts milik studentId
else:
  user = supabase.auth.getUser(bearer)
  jika tidak ada user → 401  (PROD: tidak ada mock)
  profile = profiles where id = user.id
  role = guru | admin dari profile.role
  tenantId = profile.tenant_id
  filter class_names jika teacher
```

### 4.2 `GET /api/students` — wajib

Auth sama. `.eq('tenant_id', tenantId)`. Teacher: `.in('class_name', profile.class_names)`.

### 4.3 Playback `/api/classrooms/:id` (baru)

- Guru: boleh jika `created_by = me` ATAU assigned ke kelas ampu, same tenant.
- Siswa: hanya `status=published` DAN ada assignment untuk `class_name` siswa.
- Selain itu: 403.

### 4.4 Identitas

Hapus kepercayaan pada query string untuk otorisasi. `?role=` dan `?studentId=` boleh untuk debug non-prod saja, diabaikan jika sesi ada, **dilarang** di `VERCEL_ENV=production` sebagai sumber identitas.

---

## 5. Perubahan kode minimal yang mengikuti PRD (tanpa ganti infra)

Urutan sesuai Fase 1–3 PRD utama.

### 5.1 Pintu & shell

| File | Ubah |
|------|------|
| `app/page.tsx` | Hapus composer dari landing; CTA Masuk → `/masuk`; jangan tautan Dashboard tanpa sesi |
| baru `app/masuk/page.tsx` | Dua kartu: Siswa → `/login-siswa`, Guru → `/login` |
| `app/login/page.tsx` | Judul “Masuk Guru KelasKA”; sukses → `/dashboard`; sudah login → `/dashboard` |
| `app/login-siswa/page.tsx` | Tetap NISN; sudah login → `/dashboard` |
| layout app baru | Sidebar §5.2 PRD; header tenant+user; bungkus dashboard/admin/studio |
| `app/dashboard/page.tsx` | `showAuthGate` di prod = redirect `/masuk`; hapus switch peran; nav sesuai tabel |
| `app/admin/page.tsx` | Pakai shell; back → `/dashboard`; `AlertDialog` bukan `confirm`; form tanpa default 85 |
| `app/workspace/page.tsx` | Prod: `redirect('/dashboard')` |

### 5.2 Studio

Pindahkan composer + folder/riwayat generate dari `app/page.tsx` ke `app/studio/page.tsx` (guru/admin only). Setelah gen sukses: insert `classrooms` draft + upload JSON ke Storage.

### 5.3 Env Vercel

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=                      # opsional, fallback ke NEXT_PUBLIC_
SUPABASE_SERVICE_ROLE_KEY=         # server only
AUTH_JWT_SECRET=                   # min 32 hex
DEFAULT_MODEL=google:gemini-3-flash-preview
OPENAI_API_KEY=                    # atau provider lain

OPENMAIC_AGENT_RUNTIME_ENABLED=false
NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false
RENDER_SERVICE_URL=
NEXT_PUBLIC_PERSISTENCE=           # kosong = jangan janji server document store
```

`lib/supabase/server.ts` sudah fallback `SUPABASE_URL \|\| NEXT_PUBLIC_SUPABASE_URL`. **Tidak perlu** `DATABASE_URL` container.

### 5.4 Upload besar

Jangan `multipart` ke `/api/*` untuk file ≫ 4.5MB. Alur: `createSignedUploadUrl` bucket `assets` → client PUT → API terima path + `contentDigest`.

### 5.5 Generate vs timeout

- Vercel Hobby: 10s → pecah outline SSE + content per scene (sudah ada pola stream).
- Pro/Enterprise: `vercel.json` `maxDuration` 300.
- Jangan hidupkan pipeline video di API Vercel.

---

## 6. Observabilitas & kepatuhan

- **Audit:** `revoke update, delete on user_activity_logs from anon, authenticated;` insert hanya server.
- **Event wajib:** `auth.login`, `classroom.generate.*`, `classroom.publish`, `classroom.assign`, `quiz.submit`, `export.*`.
- **Logs:** `console` → Vercel Dashboard. Jangan file logger di serverless.
- **Copy & klaim:** tidak ada “4.9/5 dari 2.000+ guru”; tidak ada jam belajar baseline.

---

## 7. Trade-off tetap di Vercel

| Fitur | Status | Perilaku produk |
|-------|--------|-----------------|
| Generate kelas | ⚠️ timeout plan-dependent | SSE; dokumentasikan Pro untuk kelas panjang |
| Dashboard/CRUD | ✅ | Patch auth §4 wajib |
| Publish/assign | ✅ Postgres + Storage | Inti v1.1 |
| Workbench agent | ❌ | Redirect; tidak di sidebar |
| Export MP4 | ❌ | Sembunyikan tombol |
| Export PPTX/HTML/ZIP | ✅ (client/server ringan) | Tampilkan |
| Asset besar | ⚠️ | Signed URL Storage |
| `DATABASE_URL` | tidak dipakai | Supabase JS |

---

## 8. Checklist deploy (copy-paste)

**Supabase**

- [ ] `supabase_migration.sql` (jika proyek baru)
- [ ] `supabase_migration_enterprise_vercel.sql`
- [ ] SQL `classrooms` + `classroom_assignments` (§3.2)
- [ ] Bucket `assets` + `classrooms` private
- [ ] `tenants` default + `profiles` tiap guru (`role`, `class_names`)
- [ ] `revoke update, delete` pada `user_activity_logs`

**Vercel**

- [ ] Env §5.3, ketiga flag off
- [ ] Redeploy
- [ ] `curl -s -o /dev/null -w '%{http_code}' /api/dashboard` tanpa header → **401**
- [ ] Login siswa NISN → `/dashboard` → hanya kursus assigned
- [ ] Login guru → `/dashboard` (bukan `/admin`) → Studio → draft tidak terlihat siswa
- [ ] Publish+assign KA-101 → siswa KA-101 melihat; KA-102 tidak
- [ ] Guru tenant A tidak melihat siswa tenant B
- [ ] UI: tidak ada Workbench, MP4, Jadwal, rating fiktif, “Supabase Auth”
- [ ] Admin hapus siswa = dialog, bukan `window.confirm`

---

## 9. Keputusan produk yang masih terbuka

1. `tenant.slug` = per sekolah (rekomendasi) vs per jurusan.
2. Siswa login unifikasi `nisn` (`nim` legacy).
3. Kuota generate per tenant (rekomendasi 100/bulan via `rate_limits`).
4. Esai AI: auto vs konfirmasi guru (rekomendasi: konfirmasi).

---

> PRD produk: `PRD-KelasKA.md`. Ringkas: `PRD-KelasKA-Ringkas.md`.  
> File SQL tenant: `supabase_migration_enterprise_vercel.sql`. SQL `classrooms` §3.2 belum tentu sudah di file itu — anggap **kontrak**; tambahkan saat implementasi Fase 2.
