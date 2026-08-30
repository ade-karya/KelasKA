# Addendum Enterprise — KelasKA di Vercel + Supabase (Tanpa Pindah Infra)

> Melengkapi `PRD-KelasKA.md:1` & `PRD-KelasKA-Ringkas.md:1`. Fokus: **jadikan enterprise-ready sambil tetap deploy di Vercel + Supabase yang sudah ada**. Tidak perlu Docker/Postgres self-host atau pindah ke VM.

---

## 0. Prinsip

1. **Tetap Vercel + Supabase** — tidak ada container `postgres:16` / `render-service` di prod Vercel. Semua yang butuh proses panjang dimatikan via flag.
2. **Enterprise = RLS + RBAC + tenant + audit**, bukan ganti infra. Supabase sudah punya semua primitifnya.
3. **Zero-downtime migration** — migrasi `tenant_id` non-breaking: kolom nullable → backfill → not null → aktifkan RLS baru.

---

## 1. Arsitektur Target (Vercel + Supabase)

```
Vercel (Next.js 16)
 ├─ Edge/Serverless Functions  maxDuration 300  vercel.json:7
 │   ├─ /api/generate/*       → LLM (fail-loud)  OPENAI_API_KEY dkk
 │   ├─ /api/dashboard        → Supabase (anon key + RLS, bukan service_role bypass)
 │   ├─ /api/students         → RLS + class scoping
 │   └─ /api/auth/*           → jose JWT (siswa) + Supabase Auth (guru)
 └─ Static + ISR  (landing, classroom playback)

Supabase (Postgres + Auth + Storage + Realtime)
 ├─ Postgres 10 tabel + tenants  (lihat §3)
 ├─ RLS policies  role = student|teacher|admin  (§4)
 ├─ Supabase Auth  guru/admin (email, Google)  lib/contexts/supabase-auth-context.tsx:76
 ├─ Storage Bucket  `assets` (ganti S3)  ASSET_S3_BUCKET → Supabase Storage
 └─ Realtime  (opsional) untuk dashboard live

Dimatikan di Vercel prod:
  OPENMAIC_AGENT_RUNTIME_ENABLED=false  (.env.example:344)
  NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false
  RENDER_SERVICE_URL= (kosong) → fallback ZIP, bukan MP4  docker-compose.yml:33
```

**Kenapa dimatikan:** Agent durable runner butuh `DATABASE_URL` + heartbeat lease (`lib/server/agent-runtime`) yang tidak survive di serverless Vercel (function freeze setelah response). Render-service butuh 8GB + Chromium (`docker-compose.yml:121`) — tidak ada di Vercel. Menyalakannya di Vercel = 500/timeout.

---

## 2. Apa yang Diubah vs PRD Awal

| Item PRD | Sebelum (pilot) | Sesudah (enterprise Vercel+Supabase) | Effort |
|----------|----------------|--------------------------------------|--------|
| RLS | `USING(true)` 10 tabel `supabase_migration.sql:81` | RLS per `tenant_id` + `class_name` + `role` (§4) | 1 hari |
| Auth siswa | JWT custom `AUTH_JWT_SECRET` `lib/auth/jwt.ts:9` + `service_role` bypass `lib/supabase/server.ts:10` | Tetap JWT siswa **tapi** tambah `tenant_id` di payload + server cek manual sebelum query; guru via Supabase Auth RLS | 0.5 hari |
| Tenant | Tidak ada | Tabel `tenants` + `profiles` linking `auth.users.id → tenant_id + role` | 0.5 hari |
| Asset | Postgres/S3 `ASSET_S3_BUCKET` | Supabase Storage bucket `assets` (gratis, CORS sudah benar) | 1 jam |
| Rate limit | Tidak ada | Vercel KV `@vercel/kv` atau `supabase rpc` sederhana | 0.5 hari |
| Observability | `createLogger` file | Vercel Logs + Supabase `user_activity_logs` append-only (§6) | 0.5 hari |

Total hardening P0: **~3 hari kerja** tanpa pindah infra.

---

## 3. Model Data — Tambahan Minimal (Supabase)

Jalankan **setelah** `supabase_migration.sql:1` — file lengkap ada di `supabase_migration_enterprise_vercel.sql`.

```sql
-- 1) Tenant = sekolah / yayasan
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null, -- ex: 'smkn1-jakarta'
  name text not null,
  created_at timestamptz default now()
);
insert into public.tenants (id, slug, name)
values ('00000000-0000-0000-0000-000000000001','default','SMK Default')
on conflict (slug) do nothing;

-- 2) Profile guru/admin — hubungkan auth.users → tenant + role
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  role text not null check (role in ('teacher','admin')),
  class_names text[] default '{}', -- kelas ampu, ex: '{KA-101,KA-102}'
  created_at timestamptz default now()
);

-- 3) Tambah tenant_id ke tabel existing (nullable dulu agar tidak breaking)
alter table public.classes       add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
alter table public.students      add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
alter table public.assignments   add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
alter table public.quiz_attempts add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
-- subjects, student_scores, attendance, teacher_notes ikut tenant via parent FK — tidak perlu kolom sendiri untuk MVP

-- Backfill sudah otomatis via DEFAULT di atas, lalu:
-- alter table public.students alter column tenant_id set not null; -- aktifkan setelah cek
create index if not exists idx_students_tenant_class on public.students(tenant_id, class_name);
create index if not exists idx_quiz_attempts_tenant on public.quiz_attempts(tenant_id, student_id);
```

> `students.tenant_id` + `profiles.tenant_id` = isolasi antar sekolah tanpa ubah `class_name` logic di `app/api/dashboard/route.ts:44`.

---

## 4. RLS Enterprise untuk Supabase (tetap pakai Supabase RLS)

**Kunci (cek ulang):** `lib/supabase/server.ts:10` pakai `SUPABASE_SERVICE_ROLE_KEY` → **bypass RLS sepenuhnya**. Artinya RLS baru di `supabase_migration_enterprise_vercel.sql` **tidak ditegakkan** untuk semua route yang pakai `getSupabaseServer()` (yaitu `app/api/dashboard/route.ts:46`, `app/api/students/route.ts:139`). RLS hanya jadi safety net jika ada yang pakai `anon` key atau kebocoran `SUPABASE_SERVICE_ROLE_KEY`.

Karena itu ada 2 pola:

- **Pola A (dipakai sekarang, tetap Vercel):** Tetap `service_role` tapi **wajib cek manual** `tenant_id` & `role` di code (`§5`) — ini **primary enforcement**, bukan RLS. Paling simpel, tidak perlu ganti client.
- **Pola B (RLS murni, lebih enterprise):** Ganti server client jadi `anon` + `auth.getUser(token)` sehingga RLS aktif. Lebih aman tapi butuh refactor `lib/supabase/server.ts`.

Addendum ini **pakai Pola A** (sesuai codebase sekarang) + RLS sebagai jaring pengaman. Jika butuh audit ketat, migrasi ke Pola B di sprint berikut.

```sql
-- Hapus policy publik
drop policy if exists "Allow public all students" on public.students;
drop policy if exists "Allow public read students" on public.students;
-- dst untuk semua tabel — lihat file migrasi

-- Helper: cek kepemilikan tenant (RLS murni Pola B)
create or replace function public.is_same_tenant(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and tenant_id = tid);
$$;

-- Policy baru — HANYA is_same_tenant. service_role bypass RLS otomatis,
-- jadi tidak perlu `or current_setting('request.jwt.claim.role','')='service_role'`
-- (check itu tidak pernah dievaluasi untuk service_role karena bypass).
create policy "tenant read students"
on public.students for select using (public.is_same_tenant(tenant_id));

-- Untuk single-tenant (KA-101..103 satu sekolah) tetap pakai tenant_id,
-- jangan hardcode `tenant_id='000...001'` (itu = cross-tenant leak).
```

> **Koreksi cek:** Sebelumnya ada bug `subjects USING(true)` (selalu lolos) dan `classes USING(tenant_id='000...001' OR ...)` (bocor lintas tenant) — **sudah diperbaiki** di `supabase_migration_enterprise_vercel.sql:81` sekarang `subjects` punya `tenant_id` sendiri + semua policy = `is_same_tenant(tenant_id)` tanpa hardcode UUID.

**Untuk single-tenant enterprise (kasus KelasKA sekarang: hanya KA-101..103 satu sekolah):** cukup ganti semua `USING(true)` jadi `USING(tenant_id = '00000000-0000-0000-0000-000000000001')` — langsung blokir tenant lain tanpa ubah code.

---

## 5. Perubahan Code Minimal di Vercel (tanpa ubah infra)

### 5.1 `app/api/dashboard/route.ts:24` — **wajib** (bukan opsional) karena `service_role` bypass RLS

```ts
// SEBELUM (bisa spoof — cek lagi: param dipercaya):
let effectiveRole = roleParam ?? (authenticatedStudent ? 'siswa' : 'guru');
const activeStudentId = activeStudent?.id ?? studentIdParam; // studentId bisa curi data orang
let authenticatedStudent = await getAuthenticatedStudent(req); // JWT siswa, tapi fallback ke guru preview

// SESUDAH (enterprise Vercel — Pola A: cek manual tenant):
let authenticatedStudent = await getAuthenticatedStudent(req);
if (authenticatedStudent) {
  effectiveRole = 'siswa';
  activeStudentId = authenticatedStudent.student.id; // paksa dari JWT, ignore ?studentId=
  activeClass = authenticatedStudent.student.class_name;
  tenantId = (authenticatedStudent.student as any).tenant_id ?? '00000000-0000-0000-0000-000000000001';
  // semua query nanti: .eq('tenant_id', tenantId)
} else {
  const token = extractBearerToken(req) ?? req.headers.get('authorization')?.replace('Bearer ','');
  const { data: { user } } = await getSupabaseServer().auth.getUser(token ?? '');
  if (!user) return apiError('UNAUTHENTICATED', 401, 'Login guru diperlukan');
  const { data: profile } = await getSupabaseServer().from('profiles').select('tenant_id, role, class_names').eq('id', user.id).single();
  if (!profile || !['teacher','admin'].includes(profile.role)) return apiError('UNAUTHENTICATED', 403, 'Role tidak diizinkan');
  effectiveRole = 'guru';
  tenantId = profile.tenant_id;
  // filter: .eq('tenant_id', tenantId).in('class_name', profile.class_names) jika teacher
}
// HAPUS fallback MOCK_STUDENTS di prod: if (!tenantId) return 401
```

### 5.2 `app/api/students/route.ts:133` — tambah guard + tenant filter

```ts
export async function GET(req: Request){
  // wajib auth
  const supa = getSupabaseServer();
  // cek JWT siswa ATAU Supabase guru (seperti di atas)
  // ...
  dbQuery = dbQuery.eq('tenant_id', tenantId); // isolasi
  if (profile.role === 'teacher') dbQuery = dbQuery.in('class_name', profile.class_names);
}
```

### 5.3 Env Vercel (Project → Settings → Environment Variables)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (anon, untuk client RLS)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ... (hanya di server, jangan expose)
AUTH_JWT_SECRET=  # min 16 char, generate: openssl rand -hex 32
DEFAULT_MODEL=google:gemini-3-flash-preview
OPENAI_API_KEY=sk-...
# Matikan yang tidak support Vercel serverless:
OPENMAIC_AGENT_RUNTIME_ENABLED=false
NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false
NEXT_PUBLIC_PERSISTENCE=  # kosong = IndexedDB saja, atau 1 jika pakai Supabase storage
```

> `lib/supabase/server.ts:9` sudah fallback `SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL` — jadi cukup set `NEXT_PUBLIC_*` saja di Vercel, tidak perlu `DATABASE_URL` Postgres direct (gunakan Supabase pooler jika butuh `DATABASE_URL`).

---

## 6. Observabilitas & Kepatuhan di Vercel+Supabase

- **Audit:** Jadikan `user_activity_logs` append-only: `revoke update, delete on user_activity_logs from anon, authenticated;` + hanya `insert` via `service_role`. Query dashboard tidak pernah `delete`.
- **Rate limit (Vercel-friendly):** tanpa Redis, pakai tabel `rate_limits(tenant_id, key, count, window)` + `rpc` atau Vercel KV `@vercel/kv` 1 baris: `await kv.incr(`rl:${ip}:${path}`)`.
- **Logs:** Vercel Logs (otomatis) + `lib/logger` → `console.log` sudah muncul di Vercel Dashboard. Tambah `vercel.json:7` `maxDuration 300` untuk LLM streaming tidak terpotong.

---

## 7. Trade-off Tetap di Vercel

| Fitur | Status di Vercel | Solusi / Catatan |
|-------|------------------|------------------|
| Generate kelas (Next.js API) | ⚠️ Jalan tapi `maxDuration 300` (`vercel.json:7`) **hanya di Pro/Enterprise plan**; Hobby = 10s, Pro = 60s default, 300s perlu upgrade. Untuk Hobby, pecah jadi streaming SSE atau cron. | Set `vercel.json:7` + upgrade plan, atau keep streaming `scene-outlines-stream` |
| Dashboard & CRUD | ✅ Jalan | Patch §5 wajib, karena `service_role` bypass RLS |
| Workbench Agent durable | ❌ Tidak survive serverless (freeze after response) | Tetap off; jika butuh, pindah ke Supabase Edge Function + pg_cron |
| Export MP4 | ❌ Butuh Chromium 8GB | Fallback ZIP (`RENDER_SERVICE_URL` kosong) — user render lokal via `pnpm dlx hyperframes` |
| Asset besar | ⚠️ Vercel limit 4.5MB payload / 10s | Pakai Supabase Storage direct upload (signed URL) + `storage.buckets assets` (`supabase_migration_enterprise_vercel.sql:170`) |
| Env `DATABASE_URL` | ⚠️ Tidak ada di Vercel, pakai Supabase pooler | `lib/supabase/server.ts:9` fallback `NEXT_PUBLIC_SUPABASE_URL`, jadi tidak perlu `DATABASE_URL` kecuali agent runtime |

---

## 8. Checklist Deploy Enterprise ke Vercel (Copy-Paste)

- [ ] Jalankan `supabase_migration_enterprise_vercel.sql` di Supabase SQL Editor (1x)
- [ ] Isi `tenants` default + `profiles` untuk tiap guru (`insert into profiles(id, tenant_id, role, class_names) values (auth.uid(), '000...001','teacher','{KA-101}')`)
- [ ] Set env di Vercel (§5.3), redeploy
- [ ] Uji: `curl /api/students?className=KA-101` tanpa `Authorization` → harus 401, bukan data mock
- [ ] Uji lintas tenant: login guru KA-101 tidak bisa lihat siswa `tenant_id` lain
- [ ] Matikan fallback mock di prod: `if (process.env.VERCEL_ENV === 'production' && !tenantId) return 401` (hapus `MOCK_STUDENTS` fallback di prod)

---

## 9. Keputusan Produk yang Masih Perlu (tetap)

1. `tenant slug` = per sekolah atau per jurusan? (rekom: per sekolah, `class_names` untuk jurusan)
2. Siswa `nisn` vs `nim` — unifikasi jadi `nisn` sebagai login (kolom `nim` legacy)
3. Kuota LLM per tenant (mis. 100 generate/bulan) — enforce di `rate_limits`

---
> File migrasi siap pakai: `supabase_migration_enterprise_vercel.sql`. Patch code contoh ada di §5 — bisa saya terapkan langsung ke `app/api/dashboard/route.ts` & `app/api/students/route.ts` jika diminta.
