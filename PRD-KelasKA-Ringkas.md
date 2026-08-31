# PRD Ringkas — KelasKA

> Versi 1.1 · 31 Agustus 2026 · Ringkasan normatif dari `PRD-KelasKA.md`  
> **Infra:** Vercel + Supabase saja. Tidak ada Docker / render-service / Workbench di produksi.  
> Repo `ade-karya/KelasKA` = fork `THU-MAIC/OpenMAIC v1.0.0` untuk SMK KA-101..103

---

## 1. Satu kalimat

Platform AI sekolah: guru membuat **1 prompt / 1 dokumen → 1 kelas interaktif**, **mereview, publish, assign ke kelas**; siswa login NISN memutar materi itu, dinilai, dan guru mengekspor PPTX/HTML/ZIP — semua di **Vercel + Supabase**.

## 2. Untuk siapa

| Persona | Butuh | Metric jujur |
|---------|-------|----------------|
| **Guru Vokasi** | Studio di dalam app, review wajib, assign KA-101..103 | Kelas **published**/minggu ≥20 |
| **Siswa SMK (NISN)** | Hanya materi assigned, kuis, nilai sendiri | ≥1 submit kuis / sesi |
| **Admin Sekolah** | Siswa/kelas/tugas/log dalam **shell yang sama** | API tanpa auth = 401 |

## 3. Alur inti (wajib)

```
Publik:  /  (landing, TANPA composer) → /masuk (Siswa | Guru)

Guru:    /login → /dashboard (shell)
         → /studio (generate) → preview outline → draft
         → review di /classroom/[id] → publish → assign class_names
         → Penilaian + ekspor PPTX/HTML/ZIP
         → BUKAN workbench, BUKAN /admin sebagai halaman pertama

Siswa:   /login-siswa → /dashboard
         → Kursus Saya (published+assigned saja) → Play → Kuis → Nilai
```

Siklus materi: `draft → in_review → published → assigned → terlihat siswa` (bisa `archived`).

## 4. Tampilan (satu produk)

- **Satu app shell** setelah login: header (logo + tenant + user) + sidebar per peran.
- Landing boleh marketing; **token warna/logo sama**. Admin **bukan** skin terpisah.
- Sidebar **hanya item hidup** (tidak ada Jadwal, Workbench, MP4, Laporan palsu).
- Login guru copy: **“Masuk Guru KelasKA”** (bukan “Supabase Auth…”).
- Dialog shadcn + toast; **dilarang** `alert`/`confirm`. Form siswa **tanpa** default nilai 85.
- **Dilarang:** badge 4.9/5 fiktif; `jamBelajar = attempts*0.5 + 8`.

## 5. Scope produksi Vercel+Supabase

**Ada:** Auth NISN + Supabase Auth, studio generate (4 scene type, widget, TTS), review/publish/assign, dashboard dual, admin CRUD, ekspor PPTX/HTML/ZIP, i18n `id-ID`, tenant_id, activity logs.

**Tidak ada di prod:** Workbench/agent durable, export MP4, mode pratinjau dashboard, mock data, kalender Jadwal, pembayaran/SCORM, native mobile.

**Flag wajib off:** `OPENMAIC_AGENT_RUNTIME_ENABLED=false`, `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false`, `RENDER_SERVICE_URL=` kosong.

## 6. 10 requirement kunci (acceptance)

1. `/` tanpa composer; Masuk → `/masuk`; app tanpa sesi → `/masuk` (prod).
2. Peran dari sesi, bukan switch preview; guru land di `/dashboard`.
3. Prompt wajib → outline editable → full gen → row `classrooms` status `draft`.
4. Upload besar via **signed URL Supabase Storage** (bukan body 4.5MB Vercel).
5. Siswa 403 pada draft; hanya `published` + `classroom_assignments` untuk `class_name`-nya.
6. Quiz `single|multiple|short_answer` → `quiz_attempts` dengan `student_id` dari JWT + `tenant_id`.
7. Dashboard siswa: kursus assigned, tugas pending, rata-rata **nyata**; jam belajar hanya jika ada sesi.
8. API dashboard/students tanpa auth → **401**; query selalu `tenant_id`; guru scoped `class_names`.
9. Ekspor PPTX/HTML/ZIP; tombol MP4 disembunyikan.
10. LLM fail-loud; RLS publik `USING(true)` dihapus (migrasi enterprise).

## 7. Non-fungsional

p50 draft <2m · 60fps · Vercel serverless + Supabase · HTML/ZIP offline · WCAG AA · Vercel Logs + `user_activity_logs` append-only · `maxDuration` 300 butuh plan yang mendukung.

## 8. Stack & env

`Next.js 16 / React 19 / Supabase Auth+Postgres+Storage / @openmaic/*`  
Wajib: 1 LLM key + Supabase URL/anon/service_role + `AUTH_JWT_SECRET`.  
Tidak wajib: `DATABASE_URL` container, Docker compose sebagai prod.

## 9. Risiko top 3

Timeout Hobby 10s → SSE + plan Pro · Halusinasi → review wajib sebelum publish · `service_role` bypass RLS → cek tenant di setiap API.

## 10. Roadmap (sistem mengikuti ini)

**P0 Shell:** `/masuk`, `/studio`, satu layout, auth gate, copy, dialog, nav hidup, sembunyikan Workbench/MP4.  
**P0 Materi:** tabel `classrooms` + `classroom_assignments`, persist draft, gate playback, UI publish/assign.  
**P0 Tenant:** SQL enterprise, patch API, rate limit, log append-only.  
**Berikut:** assignments UI, esai+konfirmasi, jam belajar nyata, baru kemudian Jadwal.

## 11. Definition of Done

`pnpm build` hijau · Playwright: 401 tanpa auth, siswa tidak lihat draft, guru tidak lintas tenant · Lighthouse a11y ≥90 pada login/dashboard · UI prod tanpa mock, tanpa rating fiktif, tanpa nav mati.

---

*Lengkap:* `PRD-KelasKA.md` · *Infra/SQL/env:* `PRD-KelasKA-Enterprise-Vercel-Supabase.md`
