---
name: kelaska
description: >
  Skill lengkap untuk berinteraksi dengan platform KelasKA Dinas Pendidikan Riau via API publik.
  Gunakan skill ini saat pengguna ingin: (1) generate kelas/classroom dari deskripsi atau PDF,
  (2) melihat katalog kelas yang sudah dipublikasikan, (3) menganalisis kesesuaian kurikulum Merdeka,
  (4) membuat soal ujian otomatis, (5) mengelola sesi PIN, (6) melihat analytics penggunaan platform,
  (7) menggunakan PBL (Project-Based Learning) chat, atau (8) mengakses fitur-fitur lain KelasKA.
  Base URL: https://kelaska-disdik.riau.ai
user-invocable: true
metadata: { "openclaw": { "emoji": "🏫" } }
---

# KelasKA Skill — API Reference untuk OpenClaw

Platform KelasKA adalah sistem manajemen kelas berbasis AI untuk Dinas Pendidikan Riau.
URL publik: **https://kelaska-disdik.riau.ai**

## Aturan Inti

- Selalu cek health endpoint terlebih dahulu sebelum operasi penting.
- Jangan pernah menampilkan API key atau token pengguna dalam respons.
- Polling job generation: tunggu 5 detik antar poll, beri tahu pengguna jika akan lama.
- Untuk operasi yang memerlukan PIN: cek session dulu via `GET /api/auth/pin` sebelum meminta login.
- Saat mengembalikan URL classroom, tampilkan URL lengkap di baris tersendiri tanpa format markdown.
- Jangan meminta pengguna paste API key ke dalam chat untuk endpoint publik.

---

## Daftar Lengkap API

### 1. Health Check

**`GET /api/health`**

Cek status layanan dan kapabilitas yang aktif.

```http
GET https://kelaska-disdik.riau.ai/api/health
```

Respons:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "x.y.z",
    "capabilities": {
      "webSearch": true,
      "imageGeneration": false,
      "videoGeneration": false,
      "tts": true
    }
  }
}
```

Gunakan ini untuk: memverifikasi platform aktif, mengetahui fitur apa yang tersedia.

---

### 2. Generate Classroom (Asinkron)

#### 2a. Mulai Job Generate

**`POST /api/generate-classroom`**

Buat classroom baru dari deskripsi teks atau konten PDF. Job berjalan di latar belakang.

```http
POST https://kelaska-disdik.riau.ai/api/generate-classroom
Content-Type: application/json

{
  "requirement": "Buat kelas pengantar mekanika kuantum untuk siswa SMA Fase F",
  "language": "id-ID",
  "enableWebSearch": false,
  "enableImageGeneration": false,
  "enableVideoGeneration": false,
  "enableTTS": false,
  "agentMode": "default"
}
```

Field yang didukung:
- `requirement` (string, **wajib**) — deskripsi kelas yang ingin dibuat
- `pdfContent` (object, opsional) — `{ text: string, images: string[] }` konten PDF yang sudah di-parse
- `language` (string, opsional) — `"id-ID"` | `"en-US"` | `"ar-SA"`, default `"id-ID"`
- `enableWebSearch` (boolean, opsional) — enriches outline dengan pencarian web real-time via Tavily
- `enableImageGeneration` (boolean, opsional) — izinkan metadata image generation di outline
- `enableVideoGeneration` (boolean, opsional) — izinkan metadata video generation di outline
- `enableTTS` (boolean, opsional) — aktifkan server-side TTS untuk aksi speech
- `agentMode` (string, opsional) — `"default"` (pakai agent bawaan) atau `"generate"` (LLM generate agent profiles kustom, 3-5 agent, tepat 1 teacher)
- `pinToken` (string, opsional) — token sesi PIN untuk konfigurasi provider per-user

Respons (202):
```json
{
  "success": true,
  "data": {
    "jobId": "abc123XYZ",
    "status": "pending",
    "step": "queued",
    "message": "...",
    "pollUrl": "https://kelaska-disdik.riau.ai/api/generate-classroom/abc123XYZ",
    "pollIntervalMs": 5000
  }
}
```

#### 2b. Poll Status Job

**`GET /api/generate-classroom/{jobId}`**

Poll setiap 5 detik sampai `done: true`.

```http
GET https://kelaska-disdik.riau.ai/api/generate-classroom/abc123XYZ
```

Respons:
```json
{
  "success": true,
  "data": {
    "jobId": "abc123XYZ",
    "status": "running",
    "step": "generating-scenes",
    "progress": 60,
    "message": "Generating scene 3 of 5...",
    "pollUrl": "...",
    "pollIntervalMs": 5000,
    "scenesGenerated": 3,
    "totalScenes": 5,
    "result": null,
    "error": null,
    "done": false
  }
}
```

`status` bisa: `pending` | `running` | `succeeded` | `failed`

Saat `done: true` dan `status: "succeeded"`, field `result` berisi data classroom lengkap.

**Alur polling yang benar:**
1. POST ke `/api/generate-classroom` → dapat `jobId`
2. Tunggu 5 detik
3. GET `/api/generate-classroom/{jobId}` → cek `done`
4. Ulangi langkah 2–3 sampai `done: true`
5. Jika `status: "succeeded"` → ambil URL classroom dari `result.url`
6. Jika `status: "failed"` → tampilkan `error` ke pengguna

---

### 3. Classroom (Simpan & Baca)

#### 3a. Simpan Classroom

**`POST /api/classroom`**

Simpan data classroom (stage + scenes) ke server.

```http
POST https://kelaska-disdik.riau.ai/api/classroom
Content-Type: application/json

{
  "stage": { "id": "optional-id", "title": "..." },
  "scenes": [...]
}
```

Respons (201):
```json
{
  "success": true,
  "data": { "id": "abc123", "url": "https://kelaska-disdik.riau.ai/classroom/abc123" }
}
```

#### 3b. Baca Classroom

**`GET /api/classroom?id={classroomId}`**

Ambil data classroom berdasarkan ID.

```http
GET https://kelaska-disdik.riau.ai/api/classroom?id=abc123
```

Respons berisi `data.classroom` dengan seluruh stage dan scenes.

#### 3c. Media Classroom

**`GET /api/classroom-media/{classroomId}/media/{filename}`**
**`GET /api/classroom-media/{classroomId}/audio/{filename}`**

Serve file media (gambar, video, audio) yang terkait dengan classroom tertentu.
Hanya subdirektori `media/` dan `audio/` yang diizinkan.

---

### 4. Chat (Stateless SSE)

**`POST /api/chat`**

Kirim pesan dan terima stream SSE dari agent AI. Endpoint ini stateless — kirim seluruh riwayat percakapan setiap request.

```http
POST https://kelaska-disdik.riau.ai/api/chat
Content-Type: application/json

{
  "messages": [...],
  "storeState": { "stage": {...}, "scenes": [...], "currentSceneId": "...", "mode": "..." },
  "config": { "agentIds": ["teacher"] },
  "apiKey": "sk-...",
  "model": "openai:gpt-4o-mini",
  "baseUrl": "https://api.openai.com/v1"
}
```

Field penting:
- `messages` (array, **wajib**) — riwayat pesan lengkap
- `storeState` (object, **wajib**) — state stage dan scenes saat ini
- `config.agentIds` (array, **wajib**) — minimal 1 agent ID
- `apiKey` (string) — API key LLM (jika server tidak punya key sendiri)
- `model` (string) — string model dengan prefix provider, misal `"anthropic:claude-3-5-haiku-20241022"`
- `providerType` (string, opsional) — override tipe provider
- `requiresApiKey` (boolean, opsional) — set `false` jika server sudah punya key

Respons: SSE stream dengan event `data: {...}\n\n`, format `StatelessEvent`.

---

### 5. Server Providers

**`GET /api/server-providers`**

Dapatkan daftar provider yang dikonfigurasi di server (LLM, TTS, ASR, PDF, image, video, web search).

```http
GET https://kelaska-disdik.riau.ai/api/server-providers
```

Jika menggunakan PIN session, sertakan cookie `kelaska_pin` untuk mendapat info provider per-PIN user.

Respons berisi: `providers`, `tts`, `asr`, `pdf`, `image`, `video`, `webSearch`, dan opsional `pinUser`, `pinDefaultLanguage`.

---

### 6. Parse PDF

**`POST /api/parse-pdf`**

Upload PDF dan ekstrak konten teks + gambar. Hasil bisa digunakan sebagai `pdfContent` di generate-classroom.

```http
POST https://kelaska-disdik.riau.ai/api/parse-pdf
Content-Type: multipart/form-data

pdf: <file binary>
providerId: unpdf      (opsional, default: "unpdf")
apiKey: ...            (opsional, jika pakai provider eksternal)
baseUrl: ...           (opsional)
```

Respons berisi `data.data` dengan field `text`, `images`, `metadata` (pageCount, fileName, fileSize).

---

### 7. Web Search

**`POST /api/web-search`**

Lakukan pencarian web via Tavily. Server harus dikonfigurasi dengan `TAVILY_API_KEY`.

```http
POST https://kelaska-disdik.riau.ai/api/web-search
Content-Type: application/json

{
  "query": "Kurikulum Merdeka SMA 2025",
  "pdfText": "konteks PDF opsional untuk memperkaya query..."
}
```

Respons: `{ answer, sources, context, query, responseTime }`

---

### 8. Quiz Grading

**`POST /api/quiz-grade`**

Nilai jawaban essay siswa menggunakan LLM. Untuk soal pilihan ganda, nilai secara lokal tanpa API ini.

```http
POST https://kelaska-disdik.riau.ai/api/quiz-grade
Content-Type: application/json

{
  "question": "Jelaskan hukum Newton pertama!",
  "userAnswer": "Benda diam akan tetap diam...",
  "points": 10,
  "commentPrompt": "Periksa konsep inersia",
  "language": "id-ID"
}
```

Respons: `{ score: number, comment: string }`

---

### 9. Transcription (ASR)

**`POST /api/transcription`**

Transkripsi audio ke teks menggunakan provider ASR yang dikonfigurasi.

```http
POST https://kelaska-disdik.riau.ai/api/transcription
Content-Type: multipart/form-data

audio: <file binary>
providerId: openai-whisper   (opsional, default: "openai-whisper")
modelId: whisper-1           (opsional)
language: auto               (opsional, default: "auto")
apiKey: sk-...               (opsional)
baseUrl: ...                 (opsional)
```

Respons: `{ text: string }`

---

### 10. Proxy Media

**`POST /api/proxy-media`**

Proxy download file media dari URL eksternal (untuk menghindari error CORS di browser).

```http
POST https://kelaska-disdik.riau.ai/api/proxy-media
Content-Type: application/json

{ "url": "https://cdn.example.com/image.png" }
```

Respons: binary blob dengan Content-Type yang sesuai.
URL internal/private network diblokir (SSRF protection).

---

### 11. Verify Model

**`POST /api/verify-model`**

Test konektivitas ke model LLM tertentu.

```http
POST https://kelaska-disdik.riau.ai/api/verify-model
Content-Type: application/json

{
  "model": "openai:gpt-4o-mini",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "providerType": "openai",
  "requiresApiKey": true
}
```

Respons sukses: `{ message: "Connection successful", response: "OK" }`
Respons gagal: pesan error spesifik (invalid key, model not found, rate limit, dll).

---

### 12. Verify Image Provider

**`POST /api/verify-image-provider`**

Test konektivitas ke provider image generation.

```http
POST https://kelaska-disdik.riau.ai/api/verify-image-provider
x-image-provider: seedream
x-api-key: your-key
x-image-model: model-id (opsional)
x-base-url: https://... (opsional)
```

Respons: `{ message: string }` atau error.

---

### 13. Azure Voices

**`POST /api/azure-voices`**

Ambil daftar voice yang tersedia dari Azure Speech Services.

```http
POST https://kelaska-disdik.riau.ai/api/azure-voices
Content-Type: application/json

{
  "apiKey": "azure-speech-key",
  "baseUrl": "https://southeastasia.api.cognitive.microsoft.com"
}
```

Respons: `{ voices: [...] }` — array voice Azure.

---

### 14. Verify Canva

**`POST /api/verify-canva`**

Test koneksi ke Canva API.

```http
POST https://kelaska-disdik.riau.ai/api/verify-canva
x-canva-token: your-token
x-canva-base-url: https://... (opsional)
```

Respons: `{ success: boolean, message: string }`

---

### 15. MCP Config

#### 15a. Baca Konfigurasi MCP

**`GET /api/mcp-config`**

Ambil konfigurasi MCP server saat ini.

```http
GET https://kelaska-disdik.riau.ai/api/mcp-config
```

Respons: `{ success: true, config: { mcpServers: {...} } }`

#### 15b. Update MCP Server

**`POST /api/mcp-config`**

Enable atau disable MCP server tertentu. Perubahan langsung berlaku (reconnect otomatis).

```http
POST https://kelaska-disdik.riau.ai/api/mcp-config
Content-Type: application/json

{
  "serverName": "brave-search",
  "disabled": false
}
```

---

### 16. MCP Endpoint

**`GET /api/mcp`** / **`POST /api/mcp`**

Endpoint MCP (Model Context Protocol) untuk integrasi tool eksternal.
Di production, memerlukan header `Authorization: Bearer <MCP_SECRET_KEY>`.
Di development lokal, header auth tidak wajib.

```http
POST https://kelaska-disdik.riau.ai/api/mcp
Authorization: Bearer your-mcp-secret-key
Content-Type: application/json

{ ...JSON-RPC payload... }
```

---

### 17. Autentikasi PIN

#### 17a. Login dengan PIN

**`POST /api/auth/pin`**

Autentikasi pengguna dengan PIN. Menyimpan session cookie `kelaska_pin` (httpOnly, 30 hari).

```http
POST https://kelaska-disdik.riau.ai/api/auth/pin
Content-Type: application/json

{ "pin": "1234" }
```

Respons sukses: `{ success: true, user: { index: 0, name: "Nama Pengguna" } }`
Respons gagal: 401 dengan pesan "Invalid PIN"

#### 17b. Logout

**`DELETE /api/auth/pin`**

Hapus session cookie.

```http
DELETE https://kelaska-disdik.riau.ai/api/auth/pin
```

#### 17c. Cek Sesi

**`GET /api/auth/pin`**

Periksa apakah sesi PIN aktif.

```http
GET https://kelaska-disdik.riau.ai/api/auth/pin
```

Respons:
```json
{
  "success": true,
  "authenticated": true,
  "pinEnabled": true,
  "user": { "index": 0, "name": "Nama" }
}
```

---

### 18. Dinas Pendidikan — Analytics

**`GET /api/dinas/analytics`**

Statistik penggunaan platform: total kelas, distribusi jenjang/fase/mapel, 10 entri terbaru.

```http
GET https://kelaska-disdik.riau.ai/api/dinas/analytics
```

Respons: `{ analytics: { totalKelas, distribusiJenjang, distribusiFase, distribusiMapel, recentEntries } }`

---

### 19. Dinas Pendidikan — Katalog Kelas

#### 19a. Daftar Katalog

**`GET /api/dinas/catalog`**

Daftar kelas yang dipublikasikan, dengan filter dan pagination.

```http
GET https://kelaska-disdik.riau.ai/api/dinas/catalog?jenjang=SMP&fase=D&mataPelajaran=IPA&search=fisika&page=1&limit=20
```

Query params (semua opsional):
- `jenjang`: `PAUD` | `SD` | `SMP` | `SMA` | `SMK`
- `fase`: `Fondasi` | `A` | `B` | `C` | `D` | `E` | `F`
- `mataPelajaran`: filter by subject (partial match)
- `search`: search di judul, deskripsi, tags
- `page`: halaman (default: 1)
- `limit`: per halaman (default: 20, max: 100)

Respons: `{ entries: [...], pagination: { page, limit, total, totalPages } }`

#### 19b. Publikasi ke Katalog

**`POST /api/dinas/catalog`**

Daftarkan classroom yang sudah ada ke katalog publik dinas.

```http
POST https://kelaska-disdik.riau.ai/api/dinas/catalog
Content-Type: application/json

{
  "classroomId": "abc123XYZ",
  "judul": "Mekanika Kuantum Dasar",
  "deskripsi": "Pengantar mekanika kuantum untuk SMA Fase F",
  "jenjang": "SMA",
  "fase": "F",
  "mataPelajaran": "Fisika",
  "kelas": "XII",
  "tags": ["fisika modern", "kuantum", "SMA"]
}
```

Field wajib: `classroomId`, `judul`, `jenjang`, `fase`, `mataPelajaran`, `kelas`
Field opsional: `deskripsi`, `tags`

Jenjang valid: `PAUD`, `SD`, `SMP`, `SMA`, `SMK`
Fase valid: `Fondasi`, `A`, `B`, `C`, `D`, `E`, `F`

Respons (201): `{ entry: { id, classroomId, judul, url, publishedAt, ... } }`

---

### 20. Dinas Pendidikan — Kurikulum Merdeka

#### 20a. Referensi Kurikulum

**`GET /api/dinas/curriculum`**

Ambil data referensi struktur Kurikulum Merdeka (Permendikdasmen No. 13 Tahun 2025).

```http
GET https://kelaska-disdik.riau.ai/api/dinas/curriculum
GET https://kelaska-disdik.riau.ai/api/dinas/curriculum?jenjang=SMP
GET https://kelaska-disdik.riau.ai/api/dinas/curriculum?fase=D
```

- Tanpa parameter: seluruh referensi (fasePembelajaran, profilLulusan, komponenKurikulum)
- `?jenjang=SD` (PAUD/SD/SMP/SMA/SMK): struktur + mata pelajaran jenjang tersebut
- `?fase=D` (Fondasi/A/B/C/D/E/F): info fase + struktur kurikulum fase tersebut

#### 20b. Analisis Keselarasan Kurikulum

**`POST /api/dinas/curriculum`**

Analisis otomatis kesesuaian materi pembelajaran dengan Kurikulum Merdeka menggunakan LLM.

```http
POST https://kelaska-disdik.riau.ai/api/dinas/curriculum
Content-Type: application/json

{
  "requirement": "Materi pembelajaran tentang sel dan jaringan tumbuhan",
  "fase": "D",
  "mataPelajaran": "Ilmu Pengetahuan Alam"
}
```

Field wajib: `requirement`, `fase`, `mataPelajaran`

Respons: `{ analysis: { skorKeselarasan, ringkasan, capaianPembelajaran, dimensiProfilLulusan, standarProses, rekomendasi, kompetensiKurang }, metadata }`

`skorKeselarasan`: 0–100

---

### 21. Dinas Pendidikan — Generator Soal Ujian

**`POST /api/dinas/exam-generator`**

Generate soal ujian otomatis sesuai Kurikulum Merdeka menggunakan LLM.

```http
POST https://kelaska-disdik.riau.ai/api/dinas/exam-generator
Content-Type: application/json

{
  "topik": "Hukum Newton dan Gerak Benda",
  "fase": "E",
  "mataPelajaran": "Fisika",
  "jumlahSoal": 10,
  "tingkatKesulitan": "campuran",
  "tipeSoal": "campuran",
  "dimensiProfilLulusan": ["Bernalar Kritis"],
  "language": "id-ID"
}
```

Field wajib: `topik`, `fase`, `mataPelajaran`

Field opsional:
- `jumlahSoal`: 1–50, default 10
- `tingkatKesulitan`: `"mudah"` | `"sedang"` | `"sulit"` | `"campuran"` (default: `"campuran"`)
- `tipeSoal`: `"pilihan_ganda"` | `"essay"` | `"campuran"` (default: `"campuran"`)
- `dimensiProfilLulusan`: array dimensi yang difokuskan (opsional)
- `language`: `"id-ID"` | `"en-US"`, default `"id-ID"`

Respons:
```json
{
  "exam": {
    "metadata": { "topik", "fase", "mataPelajaran", "jumlahSoal", "totalSkor", "tingkatKesulitan" },
    "soal": [
      {
        "nomor": 1,
        "tipe": "pilihan_ganda",
        "soal": "...",
        "opsi": [{ "label": "A", "teks": "..." }, ...],
        "kunciJawaban": "A",
        "pembahasan": "...",
        "capaianPembelajaran": "...",
        "taksonomiBloom": "menerapkan",
        "skor": 2
      }
    ]
  },
  "regulasi": "Permendikdasmen No. 13 Tahun 2025 (Kurikulum Merdeka)"
}
```

---

### 22. PBL (Project-Based Learning) Chat

**`POST /api/pbl/chat`**

Chat dengan agent PBL saat runtime. Mendukung dua mode: `question` (tanya agent) dan `judge` (agent evaluasi jawaban).

```http
POST https://kelaska-disdik.riau.ai/api/pbl/chat
Content-Type: application/json

{
  "message": "Bagaimana cara mengukur kecepatan angin?",
  "agent": {
    "name": "Pak Arif",
    "system_prompt": "Kamu adalah guru Fisika yang membantu siswa..."
  },
  "currentIssue": {
    "title": "Pengukuran Angin",
    "description": "...",
    "person_in_charge": "Budi",
    "generated_questions": "..."
  },
  "recentMessages": [
    { "agent_name": "Pak Arif", "message": "Selamat pagi!" }
  ],
  "userRole": "Peneliti",
  "agentType": "question"
}
```

`agentType`: `"question"` (default) atau `"judge"`

Respons: `{ message: string, agentName: string }`

---

## Skenario Penggunaan Umum

### Generate Kelas dari Deskripsi
1. `GET /api/health` — pastikan platform aktif
2. `POST /api/generate-classroom` dengan `requirement` — dapat `jobId`
3. Poll `GET /api/generate-classroom/{jobId}` setiap 5 detik
4. Saat `done: true && status: "succeeded"` → ambil URL dari `result.url`
5. Tampilkan URL classroom di baris tersendiri

### Generate Kelas dari PDF
1. `POST /api/parse-pdf` (multipart) — dapat `text` dan `images`
2. `POST /api/generate-classroom` dengan `pdfContent: { text, images }` + `requirement`
3. Poll sampai selesai

### Lihat Katalog Kelas Dinas
1. `GET /api/dinas/catalog?jenjang=SMP&fase=D` — daftar kelas yang sudah dipublikasikan
2. Tampilkan entri dengan judul, deskripsi, jenjang, fase, URL

### Analisis Keselarasan Materi
1. `POST /api/dinas/curriculum` dengan requirement, fase, mataPelajaran
2. Tampilkan `skorKeselarasan`, `ringkasan`, `rekomendasi`

### Buat Soal Ujian
1. `POST /api/dinas/exam-generator` dengan topik, fase, mataPelajaran, jumlahSoal
2. Tampilkan soal dalam format yang rapi (termasuk opsi, kunci, pembahasan)

### Cek Sesi & Login PIN
1. `GET /api/auth/pin` — cek apakah sudah login
2. Jika `authenticated: false` dan `pinEnabled: true` → `POST /api/auth/pin` dengan PIN
3. Gunakan cookie session untuk request selanjutnya

---

## Kode Error Umum

| Kode | Arti | Tindakan |
|------|------|----------|
| `MISSING_REQUIRED_FIELD` | Field wajib tidak ada | Periksa field yang disebutkan di pesan error |
| `MISSING_API_KEY` | API key tidak ada/tidak dikonfigurasi | Server belum dikonfigurasi untuk fitur ini |
| `INVALID_REQUEST` | Data tidak valid | Periksa format/nilai field |
| `INTERNAL_ERROR` | Error server | Coba lagi atau laporkan ke admin |
| `TRANSCRIPTION_FAILED` | Transkripsi gagal | Periksa format audio atau API key ASR |
| `PARSE_FAILED` | PDF gagal diparse | Periksa file PDF atau provider |
| `UPSTREAM_ERROR` | Error dari layanan eksternal | Provider eksternal bermasalah |
| `INVALID_URL` | URL berbahaya terdeteksi | SSRF protection aktif |

---

## Format Model String

Saat menentukan model, selalu gunakan format `provider:model-id`:

- `anthropic:claude-3-5-haiku-20241022`
- `openai:gpt-4o-mini`
- `google:gemini-2.0-flash`
- `deepseek:deepseek-chat`

Tanpa prefix provider, sistem akan mencoba parse sebagai model OpenAI.

---

## Catatan Tambahan

- **Polling timeout**: Jika job tidak selesai dalam satu sesi, beri tahu pengguna bahwa proses masih berjalan dan minta mereka cek ulang dengan `GET /api/generate-classroom/{jobId}` yang disimpan.
- **PDF besar**: Batasi `pdfContent.text` sesuai batas request (sekitar 5MB). Untuk PDF sangat panjang, pertimbangkan hanya kirim excerpt yang relevan.
- **Fase Kurikulum Merdeka**: Fondasi (PAUD), A (SD 1-2), B (SD 3-4), C (SD 5-6), D (SMP 7-9), E (SMA 10), F (SMA 11-12).
- **PIN Session**: Cookie `kelaska_pin` disimpan 30 hari. Endpoint API yang mendukung PIN akan otomatis membaca cookie ini.
- **SSRF Protection**: URL internal/private network (`localhost`, `127.x.x.x`, `10.x.x.x`, `192.168.x.x`) diblokir di endpoint proxy-media dan parse-pdf (production).
