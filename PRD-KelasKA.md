# PRD KelasKA — Product Requirements Document

> **Versi:** 1.0 — 30 Agustus 2026  
> **Status:** Draft dari reverse-engineering codebase (fork `THU-MAIC/OpenMAIC` v1.0.0)  
> **Repo:** `ade-karya/KelasKA` • Stack: `Next.js 16 / React 19 / Supabase / @openmaic/*`  
> **Dokumen ini MENGKONSOLIDASI** `README.md`, `supabase_migration.sql`, `package.json`, `app/*`, `lib/types/*`, `packages/@openmaic/dsl/*` menjadi PRD formal. Tidak ada PRD sebelumnya di repo — glob `**/*PRD*` = 0 hasil.

---

## 1. Executive Summary

**KelasKA** adalah platform pembelajaran generatif berbasis **multi-agent AI** yang mengubah *satu prompt atau satu dokumen* menjadi **kelas interaktif utuh** (slide + kuis + simulasi + PBL) yang bisa diputar layaknya kelas nyata, diekspor ke PPTX/HTML/MP4, dan dikelola via dashboard siswa/guru.

Fork ini melokalkan **OpenMAIC** untuk konteks vokasi Indonesia (seed data `KA-101..103` = Komputer Akuntansi, `supabase_migration.sql:103-107`, locale `id-ID` default, NISN/NIM login). Value proposition di landing `app/page.tsx:828-833`: *“Satu prompt, satu kelas utuh langsung jadi — <2 menit”*.

---

## 2. Visi, Misi & Tujuan

### 2.1 Visi
Memungkinkan setiap guru SMK/vokasi membuat kelas digital berkualitas tinggi **tanpa skill desain**, dan setiap siswa belajar secara **aktif & interaktif** (bukan pasif menonton video).

### 2.2 Misi
- Turunkan waktu pembuatan materi dari jam → menit.
- Sediakan tutor & teman sekelas AI yang bisa diskusi, corat-coret whiteboard, dan menilai.
- Pastikan materi bisa dipakai **offline** / intranet sekolah.

### 2.3 Goals & Success Metrics (KPI)

| Goal | Metric | Target MVP | Sumber |
|------|--------|------------|--------|
| Adopsi guru | Kelas dibuat / minggu | ≥ 50 | `quiz_attempts`, `stages` |
| Kecepatan kreasi | p50 `requirement → classroom ready` | < 2 menit | `generation-preview` |
| Engagement siswa | Quiz submit & whiteboard action / sesi | ≥ 3 interaksi | `quiz_attempt_answers` |
| Kepuasan | Rating / survei | ≥ 4.7/5 | Dashboard guru |
| Reliability | Uptime render + ASR/TTS | 99.5% | `/api/health` |

---

## 3. Stakeholder & Persona

### P1 — Guru Vokasi (Primary Creator)
- **Butuh:** Buat modul cepat dari RPP/PDF, atur kelas (KA-101..), nilai tugas.
- **Pain:** Tidak ada waktu desain slide, variasi soal terbatas.
- **Journey:** Landing → Dashboard Guru → Workbench/Agent → Atur Agen & Suara → Generate → Masuk Classroom → Ekspor PPTX/Video → Pantau nilai di `/admin`.

### P2 — Siswa SMK (Primary Learner)
- **Butuh:** Materi yang hidup, bisa tanya dengan suara, latihan kuis langsung dinilai.
- **Pain:** Materi membosankan, akses internet tidak stabil.
- **Journey:** Login NISN (`app/login-siswa`) → Dashboard Siswa → Kursus Saya (progress `lib/types/generation.ts:101-108`) → Classroom playback → Kuis & diskusi → Lihat nilai/jam belajar (`app/api/dashboard/route.ts:120-197`).

### P3 — Admin Sekolah / Operator
- **Butuh:** Kelola `classes/students/assignments`, lihat `user_activity_logs`, audit.
- **Journey:** `/admin` → manajemen kelas → lihat performa per kelas (`ClassPerf` di `app/dashboard/page.tsx:46`).

### P4 — Pengembang / Tim IT (Extender)
- **Butuh:** Fork & kustom provider/storage, tema, renderer.
- **Journey:** `skills/openmaic/references/extend.md` + paket `@openmaic/dsl`, `@openmaic/renderer`, `@openmaic/storage`.

---

## 4. Ruang Lingkup (Scope)

### 4.1 In Scope — MVP (sudah ada di codebase)

| Area | Fitur | Bukti Implementasi |
|------|-------|-------------------|
| **Landing & Generasi Cepat** | Composer free-form + upload multi-file (PDF/DOCX/PPTX/TXT/MD/Image/Audio/Video), toggle Web Search & Interactive Mode, draft cache | `app/page.tsx:135-626`, `lib/types/generation.ts:43-108`, `components/generation/generation-toolbar.tsx` |
| **Dashboard** | Dual mode Siswa/Guru, switch role saat preview, stats, kursus/progress, tugas tenggat, aktivitas mingguan, pencarian, notifikasi, ganti password siswa | `app/dashboard/page.tsx:122-1041`, `app/api/dashboard/route.ts:24-276` |
| **Auth** | Siswa: NISN+password (bcrypt, JWT), Guru/Admin: Supabase Auth email. RLS enable + fallback mock | `lib/auth/jwt.ts`, `lib/auth/student-session.ts`, `app/login-siswa`, `app/login`, `supabase_migration.sql:72-100,180-194` |
| **Kelas (Stage/Scene)** | `Stage` + 4 `SceneType`: `slide`, `quiz`, `interactive`, `pbl`; 28+ `Action` (speech, whiteboard 12 jenis, spotlight/laser, discussion, widget) | `packages/@openmaic/dsl/src/stage.ts:22-283`, `packages/@openmaic/dsl/src/action.ts:234-312`, `lib/types/stage.ts:13-148` |
| **Playback Classroom** | State machine `idle→playing→live`, TTS streaming, whiteboard SVG, roundtable debate, Q&A | `lib/playback/`, `lib/orchestration/director-graph.ts`, `app/classroom/[id]/` |
| **Interaktif Deep Mode** | 6 widget: `simulation`, `diagram` (flow/mindmap/hierarchy), `code` (py/js/ts/java/cpp + testCases), `game` (quiz/puzzle/strategy/card), `visualization3d` (molecular/solar/anatomy/geometry/physics), `procedural-skill` | `lib/types/widgets.ts:14-206`, `lib/types/generation.ts:116-195` |
| **PBL v2** | Project topic/description, targetSkills, milestones, instructor/evaluator agents | `lib/pbl/v2/types.ts`, `packages/@openmaic/generation/prompts-pbl/` |
| **Workbench Pro (Agent)** | Chat-first durable session (lease/heartbeat/resume/steer/cancel), tools: plan, stage read/patch, page gen, material read/search, web_search/fetch_url, image/video gen, voice roster, folder | `app/workbench/`, `lib/server/agent-runtime/`, `app/api/agent/` (34 route) |
| **Material Pipeline** | Upload → asset pool (`assetId` + `contentDigest` SHA-256) → ekstraksi (MinerU/AliDocMind/local ffmpeg/ffprobe) → reuse | `lib/types/generation.ts:43-82`, `app/api/extract-document/`, `app/api/materials/` |
| **Penyimpanan Pluggable** | Browser (IndexedDB/Dexie) default; server: Postgres (`DocumentStore`, `RuntimeStore`, `AssetStore`, `KvStore`) + S3 bytes, kolektor asset | `packages/@openmaic/storage/`, `lib/persistence/`, `supabase_migration.sql` |
| **Ekspor** | PPTX editable, HTML interaktif (inlining KaTeX/Three/Tailwind/Google Fonts), Classroom ZIP (`.maic.zip`), Video MP4 via `render-service` (Hyperframes + Chromium+FFmpeg) | `lib/export/`, `render-service/README.md`, `packages/pptxgenjs` |
| **Papan Tulis** | 12 aksi `wb_*` (open/draw_text/shape/chart/latex/table/line/code/edit_code/clear/delete/close) koordinat 0-1000×562 | `packages/@openmaic/dsl/src/action.ts:64-164` |
| **TTS/ASR/Search/Media** | Provider-neutral: LLM (OpenAI/Azure/Anthropic/Bedrock/Gemini/Qwen/Kimi/MiniMax/Ollama/Lemonade), TTS (VoxCPM2/Qwen), ASR (FunASR/Lemonade), Search (Brave/Baidu/Bocha/MiniMax/SearXNG/Claude), Image/Video (MiniMax/OpenAI/ComfyUI) | `lib/ai/`, `lib/audio/`, `lib/media/`, `lib/web-search/`, `.env.example` |
| **i18n & Tema** | 12 locale, termasuk `id-ID` default; light/dark/system | `app/page.tsx:672-715`, `lib/i18n/` |
| **Admin** | Kelas, siswa, nilai, attendance, assignments, activity logs | `app/admin/page.tsx`, `app/admin/activity-logs/`, `app/api/students/route.ts` |

### 4.2 Out of Scope MVP
- Pembayaran/LMS penuh (enrollment, sertifikat) — hanya dashboard nilai.
- Mobile native — responsive web only.
- Kolaborasi real-time multi-siswa pada 1 stage (saat ini single-learner playback).
- SCORM/xAPI.

### 4.3 Asumsi & Dependensi
- Minimal 1 LLM provider key terkonfigurasi (`hasUsableLLMProvider` di `app/page.tsx:194` gate `canGenerate`).
- `ffmpeg/ffprobe` opsional untuk ekstraksi lokal; tanpa ini fallback ke AliDocMind/MinerU (`README.md:210-214`).
- `DATABASE_URL` + `PERSISTENCE_DEV_TOKEN` wajib jika `NEXT_PUBLIC_PERSISTENCE=1` atau `OPENMAIC_AGENT_RUNTIME_ENABLED=true`.

---

## 5. User Stories & Acceptance Criteria

### EPIC 1 — Generasi Kelas (Core Loop)

**US-1.1** Sebagai guru, saya ingin mengetik kebutuhan bebas (“Ajarkan limit fungsi untuk SMK KA-101, 30 menit, gaya santai”) dan mendapatkan outline yang bisa diedit sebelum generate.
- **AC1:** `UserRequirements.requirement` wajib; `webSearch`/`interactiveMode`/`taskEngineMode` opsional (`generation.ts:101-108`).
- **AC2:** Pipeline 2 tahap: `scene-outlines-stream` → preview editable → `scene-content` + `scene-actions`.
- **AC3:** Bahasa output infer dari requirement (`requirements-to-outlines/system.md:14`).

**US-1.2** Sebagai guru, saya ingin unggah RPP (PDF/DOCX/PPTX) + gambar lab dan AI memakai isinya.
- **AC:** `SelectedCourseMaterial` dedup via `courseMaterialFingerprint` (`app/page.tsx:484-504`), simpan via `storeDocumentBlob` IndexedDB / asset pool (`assetId`+`contentDigest` di `generation.ts:51-58`). Ekstraksi via `/api/extract-document` (MinerU/AliDocMind) dengan fallback lokal ffmpeg.

**US-1.3** Sebagai guru, saya ingin hasil berupa slide yang bisa diedit (drag/resize/rotate) dan kuis yang dinilai AI.
- **AC:** Slide schema `SlideContent` (`stage.ts:184-189`), editor `@openmaic/editor`; kuis `QuizContent` (`stage.ts:208-214`) dengan tipe `single|multiple|short_answer` + `answer`/`analysis`/`commentPrompt`.

### EPIC 2 — Pembelajaran (Playback)

**US-2.1** Sebagai siswa, saya ingin kelas diputar dengan narasi suara guru AI, spotlight/laser, dan papan tulis yang menggambar rumus.
- **AC:** Urutan `Action` dieksekusi `lib/action/`; `speech` tunggu TTS selesai, `wb_draw_*` tunggu render; spotlight/laser `FIRE_AND_FORGET`.

**US-2.2** Sebagai siswa, saya ingin bertanya via ketik/suara dan berdiskusi dengan beberapa agen.
- **AC:** `DiscussionAction` (`action.ts:195-201`) → `director-graph.ts` (LangGraph) atur giliran; ASR via FunASR/Lemonade (`ASR_FUNASR_BASE_URL`).

**US-2.3** Sebagai siswa, saya ingin simulasi interaktif (misal ubah variabel kapasitor) dan mini-game.
- **AC:** Scene `type: 'interactive'` wajib `widgetType+widgetOutline` (`generation.ts:192-194`); 6 widget config ter-typed (`widgets.ts:202-206`).

### EPIC 3 — Dashboard & Kelas

**US-3.1** Sebagai siswa, saya melihat `kursusAktif, tugasPending, rataRata, jamBelajar` dan grafik mingguan.
- **AC:** `GET /api/dashboard?role=siswa&studentId` hitung dari `student_scores` + `assignments` + `quiz_attempts` (`route.ts:110-197`); `jamBelajar = attempts*0.5h + 8h baseline`.

**US-3.2** Sebagai guru, saya melihat per-kelas `avgScore, submitted/total, attendance` dan top 5 siswa.
- **AC:** Aggregasi `studentsData` per `class_name` (`route.ts:198-271`).

**US-3.3** Sebagai siswa, saya login dengan NISN.
- **AC:** `POST /api/auth/student-login` cek `password_hash` (bcrypt), terbit JWT, `student-session.ts` verifikasi Bearer tiap `dashboard` call.

### EPIC 4 — Ekspor & Offline

**US-4.1** Sebagai guru, saya ekspor PPTX yang bisa diedit di PowerPoint (rumus LaTeX tetap).
- **AC:** `lib/export/pptx` via `pptxgenjs` + `mathml2omml`; aset inline atau reference `assetId`.

**US-4.2** Sebagai operator sekolah, saya ekspor HTML yang jalan offline di intranet.
- **AC:** Inlining KaTeX/Three/Tailwind/Fonts jadi `data:` URI; aset host CORS fallback dilaporkan.

### EPIC 5 — Workbench Pro (Opsional, gated)

**US-5.1** Sebagai guru power-user, saya chat dengan agen untuk “buat kurikulum 5 pertemuan + revisi halaman 3”.
- **AC:** Flag `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED` + `OPENMAIC_AGENT_RUNTIME_ENABLED` + `DATABASE_URL`; endpoint `/api/agent/sessions*` 404 jika off (`app/page.tsx:158-182`). Sesi durable: lease/heartbeat, cancel, steer follow-up.

### EPIC 6 — Admin & Kepatuhan

**US-6.1** Sebagai admin, saya lihat log aktivitas dan kelola data siswa.
- **AC:** `GET /api/students?className&query` (`app/api/students/route.ts:139-156`) + RLS `user_activity_logs`/`quiz_attempts`.

---

## 6. Persyaratan Fungsional Terperinci (by Module)

### 6.1 Halaman & Rute
| Rute | Fungsi | File |
|------|--------|------|
| `/` | Landing + composer + folder/riwayat kelas + mode pro toggle | `app/page.tsx` |
| `/generation-preview` | Edit outline sebelum full gen | `app/generation-preview/` |
| `/classroom/[id]` | Playback stage | `app/classroom/[id]/` |
| `/workspace` | Workbench listing | `app/workspace/` |
| `/workbench/new` | Chat agen | `app/workbench/new/` |
| `/dashboard` | Siswa/Guru dashboard | `app/dashboard/page.tsx` |
| `/admin`, `/admin/activity-logs` | Manajemen | `app/admin/` |
| `/login-siswa`, `/login` | Auth | `app/login-*` |
| `/api/*` (34 grup) | Lihat `app/api/` — generate, agent, stages, materials, dashboard, students, quiz-grade, dll | `app/api/` |

### 6.2 Model Data (Kontrak)

**Stage** (`dsl/stage.ts:141-174`): `id, name, description, createdAt, updatedAt, languageDirective, style, whiteboard[], videoManifest, agentIds, generatedAgentConfigs, interactiveMode, taskEngineMode`

**Scene** (`stage.ts:248-283` ∪ `lib/types/stage.ts:99-111`): `id, stageId, title, order, actions?: Action[], whiteboards?, multiAgent?, content: Slide|Quiz|Interactive|PBL`

**SceneOutline** (`generation.ts:151-195`): `id, type, title, description, keyPoints[3-5], teachingObjective, estimatedDuration, languageNote, suggestedImageIds, mediaGenerations, quizConfig, widgetType/widgetOutline, pblConfig`

**Asset** (`storage.ts`): `assetId` (allocated), `contentDigest` SHA-256, `oss_key` (server), `AssetRef` di `audioId`/`videoManifest`.

**Supabase** (10 tabel, `supabase_migration.sql:5-235`): `classes, subjects, students(id, nim unique, nisn unique, password_hash bcrypt, class_name, attendance_rate, average_score), student_scores, attendance, assignments, teacher_notes, user_activity_logs, quiz_attempts(id, student_id, stage_id, scene_id, attempt_id unique, score...), quiz_attempt_answers`

**UserRequirements** (`generation.ts:101-108`): `requirement(*) + userNickname + userBio + webSearch? + interactiveMode? + taskEngineMode?`

### 6.3 Generasi Pipeline (Kontrak `@openmaic/generation`)

1. **Outline** (`POST /api/generate/scene-outlines-stream` SSE): dari `UserRequirements` + `SessionDocumentSource[]` + web search → `SceneOutline[]`.
2. **Estimasi durasi & bahasa** di outline → `courseTitle` ringkas.
3. **Content** (`POST /api/generate/scene-content`): per outline `type` → `GeneratedSlideContent | GeneratedQuizContent | GeneratedInteractiveContent | GeneratedPBLContent`.
4. **Actions** (`POST /api/generate/scene-actions`): per scene → `Action[]` (speech whiteboard etc.).
5. **TTS** (`POST /api/generate/tts`): `speech.text` → `audioId` (AssetRef).
6. **Image/Video** (`POST /api/generate/image|video`): prompt → `assetId`.

Provider gagal → fail-loud, bukan fallback tebak vendor (`README.md:565-567`).

### 6.4 Widget Interaktif (Ultra Mode)

| Widget | Konfigurasi kunci | File |
|--------|-------------------|------|
| simulation | `variables[{name,label,min,max,default,unit}] + presets` | `widgets.ts:13-31` |
| diagram | `diagramType + nodes[] + edges[] + revealOrder` | `32-58` |
| code | `language + starterCode + testCases[] + hints + solution` | `61-78` |
| game | `gameType + questions[] + scoring + achievements` | `82-110` |
| visualization3d | `visualizationType + objects[] + interactions[] + camera/lighting` | `113-179` |
| procedural-skill | `task + tools + steps[] + successCriteria` | `183-198` |

### 6.5 Pencarian, Media, Audio
- Web search provider switch `SEARCH_<PREFIX>_ENABLED=false` force-off.
- Image/Video/TTS/ASR resolve dari `server-providers.yml` + env `IMAGE_*/TTS_*/ASR_*_BASE_URL` (`lib/media/types`).

---

## 7. Persyaratan Non-Fungsional

| Kategori | Requirement | Metrik |
|----------|-------------|--------|
| **Performa** | p50 generasi <2m, p95 <5m; render slide 60fps, lazy scene fetch via `per-scene revision` triggers (`CHANGELOG 1.0.0 #1214`) | Lighthouse, `quiz_attempts.created_at` |
| **Skalabilitas** | Stateless app; Postgres + S3 elastic; `render-service` concurrency `RENDER_MAX_CONCURRENCY` | k8s HPA |
| **Keamanan** | JWT siswa (jose), bcrypt, RLS Supabase, `ACCESS_CODE` guard, SSRF hardening di `fetch_url` trust gate (`lib/server/agent-runtime/`) | OWASP |
| **Reliabilitas** | Durable session resume setelah crash; SSE retry; fallback mock dashboard jika Supabase down (`api/dashboard/route.ts:97-108`) | 99.5% |
| **Offline** | Ekspor HTML inlining; Classroom ZIP import | Manual QA intranet |
| **Aksesibilitas** | WCAG AA, keyboard shortcut, kontras, i18n 12 locale | axe |
| **Kualitas Data** | `contentDigest` SHA-256 untruncated; ETag/Last-Modified dilarang di asset bytes (`storage/docs/asset-http-contract.md:9`) | Contract test |
| **Observability** | Logger `createLogger`, `user_activity_logs` indexed (`idx_*`), `/api/health` | Grafana |

---

## 8. Keamanan, Privasi & Kepatuhan

- **Auth:** Siswa `nim/nisn + password_hash` (`$2b$10$...`), JWT 7 hari (`jwt.ts`), Guru via Supabase Auth (`supabase-auth-context`).
- **RLS:** Semua 10 tabel `ENABLE ROW LEVEL SECURITY` + policy `Allow public read/all` saat ini — **risiko**: sebelum produksi wajib ganti `server-auth.ts` jadi session real & `x-learner-key` isolation (`README.md:383-391`).
- **RLS TODO (P0 pre-prod):** Ganti policy `FOR ALL USING (true)` jadi role-based; `quiz_attempts.student_id` hanya owner/guru kelas.
- **Asset:** Bytes share cross-principal, hanya `Content-Length` boleh bocor; `Last-Modified/Age/ETag` disabled.
- **URL trust gate:** Per-session `fetch_url` whitelist (`agent-runtime/.../trust-gate`).
- **Data retention:** `ASSET_COLLECTION_GRACE_MS` default 1 jam; `ASSET_COLLECTION_INTERVAL_MS` 15 menit (`README.md:408-416`).

---

## 9. UX / UI Requirements

- **Design system:** Tailwind 4 + shadcn/ui + Radix (`package.json:143,32-33`), font Inter/JetBrains/Literata, animasi `motion`.
- **Landing (`app/page.tsx:648-1063`):** Navbar sticky, hero gradient, badge 4.9/5, composer card (textarea 140-300px, toolbar webSearch/interactiveMode, SpeechButton, generate), stats 4 kartu, fitur 6 kartu, cara kerja timeline, testimoni.
- **Composer states:** Disabled jika `!requirement.trim() || !hasUsableProvider`; `Cmd+Enter` generate; error toast `PERSISTENCE_UNAVAILABLE`.
- **Dashboard (`app/dashboard/page.tsx:342-950`):** Tema slate-950 dark, sidebar desktop + overlay mobile, dual header, pencarian debounced, notifikasi urgency, stat cards gradient, kursus progress bar, klasemen top 5.
- **Classroom:** Canvas `@openmaic/renderer`, editing via `@openmaic/editor` (drag/resize/rotate/multi-select), TTS preview single-flight, timeline.
- **Aksesibilitas:** Fokus ring, `aria-pressed` pada toggle, `sr-only` labels.

---

## 10. Analitik & Event

| Event | Payload | Tabel |
|-------|---------|-------|
| `classroom.generate.start` | `requirement length, webSearch, doc count` | `user_activity_logs` |
| `classroom.generate.complete` | `stageId, sceneCount, duration` | `user_activity_logs` |
| `quiz.submit` | `attempt_id, score, retry_number` | `quiz_attempts` + `quiz_attempt_answers` |
| `whiteboard.draw` | `type, sceneId` | `user_activity_logs` |
| `export.pptx/html/mp4` | `stageId, format` | `user_activity_logs` |

Dashboard query `avgClassScore = avg(average_score)`, `avgAttendance = avg(attendance_rate)` (`api/students/route.ts:195-203`).

---

## 11. Integrasi & Konfigurasi

**Env utama (`.env.example` + `README.md:119-476`):**

```
# LLM (≥1 wajib)
OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY / BEDROCK_REGION ...
DEFAULT_MODEL=google:gemini-3-flash-preview
MODEL_ROUTES='{"maic-agent-driver":{"model":"openai:gpt-5.5","api":"openai-completions"}}'

# Fitur opsional
IMAGE_MINIMAX_API_KEY / VIDEO_MINIMAX_API_KEY
TTS_MINIMAX_API_KEY / TTS_VOXCPM_BASE_URL
ASR_FUNASR_BASE_URL / ASR_LEMONADE_BASE_URL
PDF_MINERU_BASE_URL (+ API_KEY)
SEARCH_* (Brave/Baidu/Bocha/MiniMax/SearXNG)

# Persistensi + Agent
DATABASE_URL=postgres://openmaic:openmaic-dev@postgres:5432/openmaic
PERSISTENCE_DEV_TOKEN=openmaic-local-dev
NEXT_PUBLIC_PERSISTENCE=1 (build-time)
NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=true
OPENMAIC_AGENT_RUNTIME_ENABLED=true
RENDER_SERVICE_URL=http://render-service:3001
```

**Mode jalan:** `pnpm dev` (browser-only) | `docker compose --profile server-persistence up` | `+ video-export`.

---

## 12. Peta Endpoint (Ringkas)

- `POST /api/generate/scene-outlines-stream` — SSE outlines
- `POST /api/generate/scene-content` + `/scene-actions` — per scene
- `POST /api/generate/tts|image|video` — media
- `GET /api/stages, /api/stages/:id, /api/folders` — CRUD kelas/folder
- `POST /api/extract-document, /api/parse-pdf` — ekstraksi
- `GET/POST /api/agent/sessions*` — durable workbench (gated 404 jika off)
- `GET /api/dashboard?role=siswa|guru&studentId` — ringkasan (`route.ts:24-276`)
- `GET /api/students?className&query` — daftar siswa (`route.ts:133-223`)
- `POST /api/auth/student-login, /api/auth/change-password` — auth siswa
- `GET /api/health` — probe

---

## 13. Roadmap

### Fase 1 — MVP Stabil (Done, v1.0.0)
Landing→Generate→Classroom→Export + Dashboard dual + Auth NISN + Supabase seed KA-101..103.

### Fase 2 — Hardening (P0, 2-4 minggu)
- [ ] Ganti RLS `FOR ALL USING (true)` → RBAC nyata (guru hanya kelasnya).
- [ ] Tambah `quiz_attempts.stage_id` FK + index `scene_id`.
- [ ] Rate limit generate + upload size cap (`import_pptx` sudah #1268).
- [ ] Audit SSRF/CORS asset redirect (`ASSET_BYTE_EGRESS=redirect` prereq `s3:ListBucket`).

### Fase 3 — Fitur Guru (4-8 minggu)
- [ ] CRUD `assignments` dari UI (saat ini read-only, fallback mock).
- [ ] Penilaian kuis esai AI (`quiz-grade`) tampil di dashboard guru.
- [ ] Kalender `Jadwal` (saat ini toast “segera hadir” `dashboard/page.tsx:225`).

### Fase 4 — Skala & Ekosistem
- [ ] Multi-tenant sekolah, SSO Kemendik.
- [ ] Mobile PWA + notif push tugas.
- [ ] Marketplace template kurikulum Merdeka.

---

## 14. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Biaya LLM melambung | Burn rate | Cache outline, `MODEL_ROUTES` pilih model murah default, limit per user |
| Halusinasi materi | Miskonsepsi siswa | Wajib webSearch + prompt “media-safety”, review guru sebelum publish |
| RLS longgar | Kebocoran nilai | P0 hardening di 13 Fase 2 |
| Supabase down | Dashboard blank | Fallback mock sudah ada (`route.ts:99-108,225-263`) + toast retry |
| Ekspor offline gagal (CORS) | Sekolah intranet tidak jalan | Laporkan host gagal fetch, re-eksport setelah allowlist |

---

## 15. Acceptance Criteria Rilis (Definition of Done)

- [ ] Semua 5 Epic US-*.1 lolos E2E `playwright` (`playwright.config.ts`) + `vitest run` (1425 test di v1.0.0).
- [ ] `pnpm build` tanpa type error (`tsconfig.build.json` scoped prod).
- [ ] Lighthouse performa ≥90, aksesibilitas ≥90.
- [ ] Ekspor PPTX/HTML/MP4 + import `.maic.zip` round-trip lolos di intranet simulasi (tanpa CDN).
- [ ] Dashboard siswa/guru dengan Supabase hidup & mati (fallback) tampil tanpa crash.

---

## 16. Lampiran — Jejak File Sumber

- `README.md:45-1038` — overview, fitur, quick start, arsitektur
- `package.json:2-33` — deps & scripts
- `app/page.tsx:135-1144` — landing + composer + folder
- `app/dashboard/page.tsx:122-1041` + `app/api/dashboard/route.ts:24-276` — dashboard
- `app/api/students/route.ts:133-223` — siswa
- `app/classroom/[id]/` — playback
- `app/workbench/new/` + `lib/server/agent-runtime/` — agent workbench
- `packages/@openmaic/dsl/src/stage.ts:22-311`, `action.ts:18-340`, `storage.ts` — kontrak Stage/Scene/Action/Asset
- `lib/types/generation.ts:101-278`, `lib/types/stage.ts:13-148`, `lib/types/widgets.ts:14-206` — tipe app
- `supabase_migration.sql:1-236` — skema 10 tabel + seed
- `lib/auth/jwt.ts`, `lib/auth/student-session.ts` — auth
- `vitest.config.ts`, `playwright.config.ts` — testing

---

## 17. Pertanyaan Terbuka (butuh keputusan Produk)

1. Apakah kebijakan RLS final: guru boleh lintas kelas atau hanya kelas ampu?
2. Apakah nilai AI untuk esai bersifat final atau butuh konfirmasi guru?
3. Apakah NISN sebagai username final (saat ini `nim` unik, `nisn` unik terpisah) — unifikasi?
4. Batas kuota asset per user/sekolah?
5. Model default untuk produksi Indonesia (biaya vs mutu bahasa Indonesia) — `google:gemini-3-flash` vs `minimax` vs lokal Lemonade?

---

> **Cara pakai dokumen ini:** Jadikan `PRD-KelasKA.md` sebagai sumber kebenaran. Tiap perubahan fitur wajib update baris “Bukti Implementasi” + `CHANGELOG.md`. Jalankan `graphify update .` setelah edit kode agar graf pengetahuan sinkron.
