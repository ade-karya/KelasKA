-- =============================================================================
-- KelasKA — Enterprise hardening untuk Vercel + Supabase (tanpa pindah infra)
-- Jalankan SETELAH supabase_migration.sql di Supabase SQL Editor.
-- Prinsip: tetap Vercel serverless + Supabase Postgres/RLS, tidak perlu Docker.
-- Pola A: server pakai service_role (bypass RLS) + cek tenant manual di code.
--         RLS baru di bawah jadi safety net jika suatu saat pakai anon key (Pola B).
-- Untuk single-tenant (KA-101..103 satu sekolah) cukup pakai tenant default.
-- =============================================================================

-- 0) Pastikan extension
create extension if not exists "pgcrypto";

-- 1) Tenants
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);
insert into public.tenants (id, slug, name)
values ('00000000-0000-0000-0000-000000000001','default','SMK Default')
on conflict (slug) do nothing;

-- 2) Profiles guru/admin (menghubungkan auth.users → tenant + role + kelas ampu)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('teacher','admin')),
  class_names text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_profiles_tenant on public.profiles(tenant_id);
alter table public.profiles enable row level security;
-- RLS untuk profiles: hanya owner yang bisa baca via anon; service_role bypass otomatis
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles for select
  using (auth.uid() = id);
drop policy if exists "profiles self upsert" on public.profiles;
create policy "profiles self upsert" on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3) Tambah tenant_id ke tabel yang butuh isolasi (nullable dulu agar tidak breaking)
alter table public.classes       add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
alter table public.students      add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
alter table public.assignments   add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
alter table public.quiz_attempts add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
alter table public.user_activity_logs add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';

create index if not exists idx_students_tenant_class on public.students(tenant_id, class_name);
create index if not exists idx_assignments_tenant on public.assignments(tenant_id, class_name);
create index if not exists idx_quiz_attempts_tenant on public.quiz_attempts(tenant_id, student_id);
create index if not exists idx_activity_tenant on public.user_activity_logs(tenant_id, created_at desc);
create index if not exists idx_classes_tenant on public.classes(tenant_id, name);

-- Backfill eksplisit untuk baris lama yang mungkin null (jika default tidak ter-apply)
update public.classes       set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;
update public.students      set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;
update public.assignments   set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;
update public.quiz_attempts set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;
update public.user_activity_logs set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;

-- 4) Helper untuk RLS murni (Pola B) — cek tenant guru
create or replace function public.is_same_tenant(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and tenant_id = tid);
$$;

-- 5) Ganti policy publik Using(true) → tenant-scoped
-- Catatan: service_role bypass RLS, jadi policy ini tidak memblokir server code
-- yang pakai SUPABASE_SERVICE_ROLE_KEY, tapi akan memblokir anon key yang bocor.

-- classes — HANYA is_same_tenant, tanpa hardcoded UUID (hardcode = cross-tenant leak)
drop policy if exists "Allow public read classes" on public.classes;
drop policy if exists "Allow public all classes" on public.classes;
create policy "tenant read classes" on public.classes for select
  using (public.is_same_tenant(tenant_id));
create policy "tenant write classes" on public.classes for all
  using (public.is_same_tenant(tenant_id))
  with check (public.is_same_tenant(tenant_id));
-- service_role bypass RLS otomatis (lib/supabase/server.ts:10), tidak perlu or service_role di policy

-- subjects — tambah tenant_id agar isolasi benar (ikut classes)
alter table public.subjects add column if not exists tenant_id uuid references public.tenants(id) default '00000000-0000-0000-0000-000000000001';
update public.subjects set tenant_id = '00000000-0000-0000-0000-000000000001' where tenant_id is null;
create index if not exists idx_subjects_tenant on public.subjects(tenant_id, class_id);
drop policy if exists "Allow public read subjects" on public.subjects;
drop policy if exists "Allow public all subjects" on public.subjects;
create policy "tenant read subjects" on public.subjects for select
  using (public.is_same_tenant(tenant_id));
create policy "tenant write subjects" on public.subjects for all
  using (public.is_same_tenant(tenant_id))
  with check (public.is_same_tenant(tenant_id));
-- Catatan: service_role bypass RLS otomatis, tidak perlu dicek di policy

-- students — RLS murni untuk anon key; service_role bypass otomatis
drop policy if exists "Allow public read students" on public.students;
drop policy if exists "Allow public all students" on public.students;
create policy "tenant read students" on public.students for select
  using (public.is_same_tenant(tenant_id));
create policy "tenant write students" on public.students for all
  using (public.is_same_tenant(tenant_id))
  with check (public.is_same_tenant(tenant_id));

-- student_scores (ikut students → cek via student_id)
drop policy if exists "Allow public read student_scores" on public.student_scores;
drop policy if exists "Allow public all student_scores" on public.student_scores;
create policy "tenant read scores" on public.student_scores for select
  using (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)));
create policy "tenant write scores" on public.student_scores for all
  using (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)))
  with check (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)));

-- attendance
drop policy if exists "Allow public read attendance" on public.attendance;
drop policy if exists "Allow public all attendance" on public.attendance;
create policy "tenant read attendance" on public.attendance for select
  using (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)));
create policy "tenant write attendance" on public.attendance for all
  using (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)))
  with check (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)));

-- assignments
drop policy if exists "Allow public read assignments" on public.assignments;
drop policy if exists "Allow public all assignments" on public.assignments;
create policy "tenant read assignments" on public.assignments for select
  using (public.is_same_tenant(tenant_id));
create policy "tenant write assignments" on public.assignments for all
  using (public.is_same_tenant(tenant_id))
  with check (public.is_same_tenant(tenant_id));

-- teacher_notes
drop policy if exists "Allow public read teacher_notes" on public.teacher_notes;
drop policy if exists "Allow public all teacher_notes" on public.teacher_notes;
create policy "tenant read notes" on public.teacher_notes for select
  using (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)));
create policy "tenant write notes" on public.teacher_notes for all
  using (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)))
  with check (exists(select 1 from public.students s where s.id = student_id and public.is_same_tenant(s.tenant_id)));

-- user_activity_logs — append-only untuk audit (service_role bypass otomatis)
drop policy if exists "Allow public read user_activity_logs" on public.user_activity_logs;
drop policy if exists "Allow public insert user_activity_logs" on public.user_activity_logs;
drop policy if exists "Allow public all user_activity_logs" on public.user_activity_logs;
create policy "tenant read logs" on public.user_activity_logs for select
  using (public.is_same_tenant(tenant_id));
create policy "tenant insert logs" on public.user_activity_logs for insert
  with check (public.is_same_tenant(tenant_id));
-- no update/delete policy = append-only (enterprise audit)

-- quiz_attempts
drop policy if exists "Allow public read quiz_attempts" on public.quiz_attempts;
drop policy if exists "Allow public all quiz_attempts" on public.quiz_attempts;
create policy "tenant read attempts" on public.quiz_attempts for select
  using (public.is_same_tenant(tenant_id));
create policy "tenant write attempts" on public.quiz_attempts for all
  using (public.is_same_tenant(tenant_id))
  with check (public.is_same_tenant(tenant_id));

-- quiz_attempt_answers (ikut quiz_attempts)
drop policy if exists "Allow public read quiz_attempt_answers" on public.quiz_attempt_answers;
drop policy if exists "Allow public all quiz_attempt_answers" on public.quiz_attempt_answers;
create policy "tenant read answers" on public.quiz_attempt_answers for select
  using (exists(select 1 from public.quiz_attempts qa where qa.id = attempt_id and public.is_same_tenant(qa.tenant_id)));
create policy "tenant write answers" on public.quiz_attempt_answers for all
  using (exists(select 1 from public.quiz_attempts qa where qa.id = attempt_id and public.is_same_tenant(qa.tenant_id)))
  with check (exists(select 1 from public.quiz_attempts qa where qa.id = attempt_id and public.is_same_tenant(qa.tenant_id)));

-- 6) Rate limit table (Vercel-friendly, tanpa Redis)
create table if not exists public.rate_limits (
  tenant_id uuid not null references public.tenants(id),
  key text not null,
  window_start timestamptz not null default now(),
  count int not null default 1,
  primary key (tenant_id, key, window_start)
);
alter table public.rate_limits enable row level security;
-- rate_limits hanya diakses via service_role (bypass RLS), jadi policy deny-by-default untuk anon
drop policy if exists "rate limit service" on public.rate_limits;
create policy "rate limit no anon" on public.rate_limits for all
  using (false) with check (false);
-- catatan: akses service_role tetap lolos karena bypass RLS

-- Storage bucket untuk asset (ganti S3 di Vercel)
insert into storage.buckets (id, name, public) values ('assets','assets', false)
on conflict (id) do nothing;
-- policy storage: hanya service_role yang boleh, anon deny (upload via signed URL dari server)
drop policy if exists "assets no anon" on storage.objects;
create policy "assets no anon" on storage.objects for all
  using (false) with check (false);

-- 7) Setelah verifikasi, aktifkan NOT NULL (jalankan manual setelah cek tidak ada null)
-- alter table public.students alter column tenant_id set not null;
-- alter table public.assignments alter column tenant_id set not null;
-- alter table public.quiz_attempts alter column tenant_id set not null;
