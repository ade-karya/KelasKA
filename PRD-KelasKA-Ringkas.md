# PRD Ringkas — KelasKA

> Versi 1.0 · 30 Agustus 2026 · Ringkasan dari `PRD-KelasKA.md` (379 baris)  
> Repo `ade-karya/KelasKA` = fork `THU-MAIC/OpenMAIC v1.0.0` untuk SMK KA-101..103

---

## 1. Satu Kalimat
Platform AI yang mengubah **1 prompt / 1 dokumen → 1 kelas interaktif utuh** (slide, kuis, simulasi, PBL) yang bisa diputar dengan tutor AI, dinilai otomatis, dan diekspor PPTX/HTML/MP4 + dipakai offline.

## 2. Untuk Siapa
| Persona | Butuh | Metric |
|---------|-------|--------|
| **Guru Vokasi** | Buat modul dari RPP/PDF dalam menit, tanpa desain | Kelas/minggu ≥50 |
| **Siswa SMK (login NISN)** | Materi hidup, bisa tanya via suara, kuis langsung dinilai | Interaksi/sesi ≥3 |
| **Admin Sekolah** | Kelola kelas `KA-101..103`, nilai, kehadiran, log | Uptime 99.5% |

## 3. Alur Inti (Happy Path)
```
Guru: Landing (app/page.tsx:828) → ketik kebutuhan + upload PDF/PPTX/gambar/audio/video
      → toggle Web Search / Interactive Mode → Generate (Cmd+Enter)
      → pipeline: outline (SSE) → edit outline → content + actions + TTS/image per scene
      → Classroom (app/classroom/[id]) playback: speech + spotlight/laser + whiteboard
      → Ekspor PPTX/HTML/ZIP/MP4 + Dashboard pantau nilai
Siswa: Login NISN (app/login-siswa) → Dashboard (app/dashboard/page.tsx)
      → Kursus Saya (progress), Tugas Tenggat, Grafik Mingguan → Play classroom → Kuis → Nilai
```

## 4. Scope MVP — Apa yang Sudah Ada
- **Generate:** Free-form `UserRequirements.requirement` (`lib/types/generation.ts:101`), dedup `SelectedCourseMaterial` (`app/page.tsx:484`), gate `hasUsableProvider`
- **Stage/Scene:** 4 tipe `slide|quiz|interactive|pbl` (`packages/@openmaic/dsl/src/stage.ts:22`), 28 `Action` (`action.ts:234` — speech, 12× `wb_*`, spotlight/laser, discussion, widget_*)
- **Interaktif:** 6 widget `simulation|diagram|code|game|visualization3d|procedural-skill` (`lib/types/widgets.ts:202`)
- **Dashboard:** Dual siswa/guru (`app/api/dashboard/route.ts:24` — stats dari `student_scores+assignments+quiz_attempts`), pencarian, notifikasi, ganti password
- **Auth:** Siswa bcrypt+JWT (`lib/auth/jwt.ts`), Guru Supabase Auth, RLS 10 tabel (`supabase_migration.sql:5`)
- **Ekspor+Offline:** PPTX (`pptxgenjs`), HTML inlining, ZIP, MP4 via `render-service` (Hyperframes)
- **Workbench Pro (gated):** Chat agent durable lease/heartbeat/steer/cancel (`app/workbench/`, `lib/server/agent-runtime/`), butuh `DATABASE_URL`+`OPENMAIC_AGENT_RUNTIME_ENABLED`

**Out of scope MVP:** Pembayaran/sertifikat, kolaborasi multi-siswa real-time, mobile native, SCORM.

## 5. 10 Requirement Kunci (Acceptance)
1. Prompt wajib, doc opsional → outline editable sebelum full gen
2. Upload PDF/DOCX/PPTX/TXT/MD/Image/Audio/Video → ekstrak (MinerU/AliDocMind/ffmpeg) → `assetId+contentDigest` SHA-256
3. Per scene generate slide/quiz/interaktif/PBL + `Action[]`
4. TTS streaming + whiteboard 0-1000×562 + spotlight/laser
5. Quiz `single|multiple|short_answer` (`QuizContent` `stage.ts:208`) dinilai AI, simpan `quiz_attempts`+`answers`
6. Playback bisa Q&A suara (ASR FunASR/Lemonade) + diskusi multi-agen (LangGraph `director-graph.ts`)
7. Dashboard siswa: `kursusAktif, tugasPending, rataRata, jamBelajar (=attempts*0.5h+8)` + `weeklyActivity`
8. Login NISN → JWT → RLS; **P0: ganti policy `FOR ALL USING (true)` jadi RBAC per kelas**
9. Ekspor PPTX editable (LaTeX via `mathml2omml`) + HTML offline (inlining) round-trip `.maic.zip`
10. Semua provider fail-loud, bukan tebak vendor (`README.md:565`)

## 6. Non-Fungsional
Performa p50 <2m / p95 <5m · 60fps · Stateless + Postgres/S3 · Work offline · WCAG AA + i18n `id-ID` · Observability `/api/health`+`user_activity_logs`

## 7. Stack & Konfigurasi
`Next.js 16 / React 19 / Supabase / @openmaic/dsl|renderer|editor|storage|generation` · Env wajib: 1 LLM key + `DATABASE_URL` jika persistence/agent on · Mode: `pnpm dev` / `docker compose --profile server-persistence` / `+ video-export`

## 8. Risiko Top 3
Biaya LLM → cache+model murah · Halusinasi → wajib webSearch+review guru · RLS longgar → hardening segera

## 9. Roadmap
**Done v1.0:** Generate→Classroom→Export+Dashboard+NISN  
**2-4 mg (P0):** RBAC, rate limit, validasi upload  
**4-8 mg:** CRUD assignments, nilai esai AI, Kalender Jadwal (sekarang toast `dashboard/page.tsx:225`)  
**Next:** Multi-tenant sekolah, PWA push, marketplace Kurikulum Merdeka

## 10. Definition of Done
`pnpm build` hijau · `vitest+playwright` lolos · Lighthouse ≥90 · Ekspor/import round-trip lolos intranet tanpa CDN

---
*Rujuk lengkap:* `PRD-KelasKA.md:1`, `README.md:70`, `supabase_migration.sql:1`, `packages/@openmaic/dsl/src/stage.ts:141`, `lib/types/generation.ts:101`
