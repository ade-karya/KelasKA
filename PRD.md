# Product Requirements Document (PRD)
## OpenMAIC - Open Multi-Agent Interactive Classroom

**Versi Dokumen:** 1.0  
**Tanggal:** 28 Juni 2026  
**Status:** Draft

---

## 1. Product Overview

### 1.1 Deskripsi Produk
OpenMAIC adalah platform AI open-source yang mengubah topik atau dokumen apa pun menjadi pengalaman kelas interaktif yang kaya. Didukung oleh orkestrasi multi-agent, platform ini menghasilkan slide, kuis, simulasi interaktif, dan aktivitas pembelajaran berbasis proyek — semua disampaikan oleh guru AI dan teman sekelas AI yang dapat berbicara, menggambar di papan tulis, dan berdiskusi secara real-time dengan pengguna.

### 1.2 Value Proposition
- **One-click lesson generation** - Jelaskan topik atau lampirkan materi; AI membangun pelajaran lengkap dalam hitungan menit
- **Multi-agent classroom** - Guru dan teman sekelas AI memberikan kuliah, berdiskusi, dan berinteraksi secara real-time
- **Rich scene types** - Slide, kuis, simulasi HTML interaktif, dan pembelajaran berbasis proyek (PBL)
- **Whiteboard & TTS** - Agent menggambar diagram, menulis rumus, dan menjelaskan dengan suara
- **Export anywhere** - Unduh slide `.pptx` yang dapat diedit atau halaman `.html` interaktif
- **OpenClaw integration** - Generate kelas dari Feishu, Slack, Telegram, dan 20+ aplikasi messaging

### 1.3 Target Users
- **Siswa** - Pelajar yang ingin belajar topik baru dengan cara interaktif
- **Guru/Pengajar** - Educator yang ingin membuat materi pembelajaran dengan cepat
- **Professional** - Pekerja yang perlu mempelajari skill baru atau presentasi
- **Researcher** - Peneliti yang perlu menganalisis paper atau dokumen
- **Content Creator** - Kreator konten edukasi

---

## 2. Key Features

### 2.1 Lesson Generation
**Priority:** P0 (Critical)

**Deskripsi:** Sistem dua tahap untuk menghasilkan pelajaran dari input pengguna:
- **Stage 1: Outline** - AI menganalisis input dan menghasilkan struktur pelajaran
- **Stage 2: Scenes** - Setiap item outline menjadi scene kaya — slide, kuis, modul interaktif, atau aktivitas PBL

**Input:**
- Teks deskripsi topik (wajib)
- File PDF/Dokumen (opsional)
- Konfigurasi mode (standard/interactive/vocational)
- Web search toggle (opsional)

**Output:**
- Struktur pelajaran terorganisir
- Scene dengan berbagai tipe (slide, quiz, interactive, PBL)
- Media yang digenerate (images, audio, video)

### 2.2 Classroom Components

#### 2.2.1 Slides
**Priority:** P0 (Critical)

**Fitur:**
- AI teachers deliver lectures dengan voice narration
- Spotlight effects dan laser pointer animations
- Canvas-based slide editor dengan Pro Mode
- Export ke PowerPoint (.pptx) yang dapat diedit
- Support LaTeX formulas, charts, tables

#### 2.2.2 Quiz
**Priority:** P1 (High)

**Fitur:**
- Interactive quizzes (single/multiple choice, short answer)
- Real-time AI grading dan feedback
- Persistent quiz state
- Completion tracking

#### 2.2.3 Interactive Simulation
**Priority:** P1 (High)

**Fitur:**
- HTML-based interactive experiments
- Physics simulators, flowcharts, dan visualisasi
- Hands-on learning untuk topik teknis
- Responsive design untuk semua device

#### 2.2.4 Project-Based Learning (PBL)
**Priority:** P1 (High)

**Fitur:**
- Pilih role dan kolaborasi dengan AI agents
- Structured projects dengan milestones dan deliverables
- Real-time collaboration
- Progress tracking

### 2.3 Deep Interactive Mode
**Priority:** P1 (High)

**Deskripsi:** Mode interaktif yang lebih dalam untuk hands-on learning.

**5 Tipe Interactive UI:**
1. **3D Visualization** - Representasi visual tiga dimensi untuk struktur abstrak
2. **Simulation** - Simulasi proses dan environment eksperimental
3. **Game** - Mini-games berbasis pengetahuan untuk reinforcement learning
4. **Mind Map** - Organisasi pengetahuan terstruktur
5. **Online Programming** - Coding in-browser dengan eksekusi instan

**Fitur Tambahan:**
- AI teacher guidance (highlight, set conditions, provide hints)
- Fully responsive (desktop, tablet, mobile)
- Cross-device compatibility

### 2.4 Multi-Agent Interaction
**Priority:** P0 (Critical)

**Mode Interaksi:**
- **Classroom Discussion** - Agents inisiasi diskusi proaktif
- **Roundtable Debate** - Multiple agents dengan personas berbeda berdiskusi
- **Q&A Mode** - Tanya jawab bebas dengan AI teacher
- **Whiteboard** - AI agents menggambar di shared whiteboard secara real-time

**Agent Capabilities:**
- Speech synthesis dengan berbagai voice providers
- Whiteboard drawing (shapes, text, diagrams)
- Action execution (28+ action types)
- Persona-based responses

### 2.5 OpenClaw Integration
**Priority:** P2 (Medium)

**Deskripsi:** Integrasi dengan OpenClaw untuk generate kelas dari messaging apps.

**Fitur:**
- Hosted mode (akses code dari open.maic.chat)
- Self-hosted mode (clone, config, startup guidance)
- Async generation job dengan polling
- Support 20+ messaging platforms (Feishu, Slack, Discord, Telegram, WhatsApp, dll)

### 2.6 Export & Import
**Priority:** P1 (High)

**Format Export:**
- **PowerPoint (.pptx)** - Slide yang dapat diedit dengan images, charts, LaTeX formulas
- **Interactive HTML** - Halaman web self-contained dengan interactive simulations
- **Classroom ZIP** - Full classroom export untuk backup/sharing

**Offline/Intranet Support:**
- Inline external assets sebagai data: URIs
- Full offline playback setelah import
- CORS-restricted image handling

**Format Import:**
- Classroom ZIP (.maic.zip)
- PowerPoint (.pptx) - experimental/flag-gated

### 2.7 Text-to-Speech & Speech Recognition
**Priority:** P1 (High)

**TTS Providers:**
- OpenAI, Azure, GLM, MiniMax, Lemonade (local)
- VoxCPM2 (self-hosted dengan voice cloning)
- Custom voice prompts dan voice cloning

**ASR Providers:**
- OpenAI Whisper, Azure, Lemonade (local)
- Browser-native speech recognition

### 2.8 Web Search Integration
**Priority:** P2 (Medium)

**Providers:**
- Brave, Baidu, Bocha, MiniMax
- Up-to-date information retrieval
- Context-aware search

### 2.9 Internationalization (i18n)
**Priority:** P2 (Medium)

**Supported Languages:**
- Chinese (Simplified - zh-CN)
- Chinese (Traditional - zh-TW)
- English (en-US)
- Japanese (ja-JP)
- Russian (ru-RU)
- Arabic (ar-SA)
- Portuguese (Brazil - pt-BR)

### 2.10 Settings & Configuration
**Priority:** P0 (Critical)

**LLM Providers:**
- OpenAI, Anthropic, Google Gemini, DeepSeek, Qwen, Kimi, MiniMax, Grok (xAI), OpenRouter, Doubao, Tencent Hunyuan/TokenHub, Xiaomi MiMo, GLM (Zhipu), Ollama (local), Lemonade (local)
- Provider configuration via .env atau server-providers.yml
- Model selection per provider

**PDF Parsing:**
- Default parser
- MinerU (advanced parsing untuk complex tables, formulas, OCR)

**Media Generation:**
- Image generation providers
- Video generation providers
- Custom base URLs dan API keys

### 2.11 User Profile
**Priority:** P2 (Medium)

**Fitur:**
- Custom nickname dan bio
- Avatar selection
- Personalization untuk generation context

---

## 3. User Stories

### 3.1 Lesson Generation
- Sebagai **siswa**, saya ingin memasukkan topik "Python programming" dan mendapatkan pelajaran lengkap dengan slide dan kuis
- Sebagai **guru**, saya ingin mengupload PDF materi kuliah dan generate slide presentasi otomatis
- Sebagai **professional**, saya ingin mempelajari "machine learning basics" dengan simulasi interaktif

### 3.2 Classroom Interaction
- Sebagai **siswa**, saya ingin berdiskusi dengan AI teacher dan teman sekelas AI tentang topik yang sulit
- Sebagai **siswa**, saya ingin melihat AI menggambar diagram di whiteboard untuk menjelaskan konsep
- Sebagai **siswa**, saya ingin menggunakan voice input untuk bertanya kepada AI teacher

### 3.3 Deep Interactive Mode
- Sebagai **siswa**, saya ingin menjalankan simulasi physics untuk memahami konsep secara visual
- Sebagai **siswa**, saya ingin bermain mini-game untuk menguji pemahaman saya
- Sebagai **siswa**, saya ingin menulis dan menjalankan code langsung di browser

### 3.4 Export & Sharing
- Sebagai **guru**, saya ingin export slide ke PowerPoint untuk presentasi di kelas
- Sebagai **siswa**, saya ingin download classroom sebagai HTML untuk belajar offline
- Sebagai **professional**, saya ingin share classroom dengan rekan kerja via ZIP file

### 3.5 OpenClaw Integration
- Sebagai **user**, saya ingin generate kelas langsung dari Feishu/Slack tanpa membuka browser
- Sebagai **user**, saya ingin menggunakan hosted mode tanpa setup lokal
- Sebagai **developer**, saya ingin self-host dengan guidance dari OpenClaw skill

---

## 4. Technical Requirements

### 4.1 Tech Stack
- **Frontend Framework:** Next.js 16 (App Router)
- **UI Framework:** React 19
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 4
- **State Management:** Zustand
- **Multi-Agent Orchestration:** LangGraph 1.1
- **AI SDK:** Vercel AI SDK (@ai-sdk/*)
- **Canvas/Graphics:** @napi-rs/canvas
- **Markdown:** ProseMirror
- **Math:** KaTeX, Temml
- **Charts:** ECharts
- **Animation:** Motion (Framer Motion)
- **i18n:** i18next, react-i18next
- **Package Manager:** pnpm 10

### 4.2 Architecture

#### Generation Pipeline
- **Two-stage pipeline:** Outline generation → Scene content generation
- **Async job processing:** Background generation dengan polling
- **Media generation:** Parallel image/audio/video generation
- **Caching:** Draft cache untuk requirement text

#### Multi-Agent Orchestration
- **LangGraph state machine:** Managing agent turns dan discussions
- **Director graph:** Coordinating multiple agents
- **Action engine:** 28+ action types (speech, whiteboard, effects)

#### Playback Engine
- **State machine:** idle → playing → live
- **SSE streaming:** Real-time chat dan agent responses
- **Stage API:** Slide/canvas/scene manipulation

### 4.3 API Endpoints

#### Generation
- `POST /api/generate/outline` - Generate lesson outline
- `POST /api/generate/scenes` - Generate scene content
- `POST /api/generate-classroom` - Submit async classroom job
- `GET /api/generate-classroom/[id]` - Poll job status

#### Chat & Interaction
- `POST /api/chat` - Multi-agent discussion (SSE streaming)
- `POST /api/quiz-grade` - Grade quiz answers

#### Media
- `POST /api/parse-pdf` - Parse PDF documents
- `POST /api/transcription` - Speech-to-text
- `GET /api/proxy-media` - Proxy media requests
- `POST /api/verify-image-provider` - Verify image provider
- `POST /api/verify-video-provider` - Verify video provider

#### Classroom
- `GET /api/classroom/[id]` - Get classroom data
- `POST /api/classroom-media` - Upload classroom media

#### PBL
- `POST /api/pbl/start` - Start PBL session
- `POST /api/pbl/submit` - Submit PBL deliverable

#### Admin & Settings
- `POST /api/access-code/verify` - Verify access code
- `GET /api/server-providers` - Get server providers config
- `POST /api/verify-model` - Verify LLM model
- `POST /api/verify-pdf-provider` - Verify PDF provider

### 4.4 Database & Storage
- **Client-side storage:** IndexedDB untuk media blobs, voice clips
- **Session storage:** Generation session state
- **Local storage:** User preferences, draft cache
- **File system:** Stage storage untuk classroom data

### 4.5 Deployment
- **Platform:** Vercel (recommended), Docker
- **Node.js:** >= 20.9.0
- **Environment variables:** .env.local untuk configuration
- **Access control:** ACCESS_CODE untuk shared deployments

---

## 5. Non-Functional Requirements

### 5.1 Performance
- **Generation time:** < 5 menit untuk pelajaran standar (10-15 scenes)
- **First contentful paint:** < 2 detik
- **Time to interactive:** < 5 detik
- **Streaming latency:** < 500ms untuk chat responses
- **Image generation:** < 30 detik per image

### 5.2 Scalability
- **Concurrent users:** Support 100+ concurrent classroom sessions
- **Storage:** Efficient media blob management dengan URL revocation
- **Caching:** Draft cache dan thumbnail caching

### 5.3 Reliability
- **Error handling:** Graceful degradation untuk API failures
- **Retry logic:** Automatic retry untuk failed generation steps
- **Validation:** Provider verification sebelum generation
- **Offline support:** Exported classrooms playable offline

### 5.4 Security
- **API key protection:** Server-side only untuk sensitive keys
- **SSRF protection:** Block localhost URLs di production
- **Access control:** Optional ACCESS_CODE untuk site-level protection
- **CORS handling:** Proper CORS configuration untuk media proxying

### 5.5 Usability
- **Responsive design:** Desktop, tablet, mobile
- **Accessibility:** Keyboard navigation, screen reader support
- **Dark mode:** Full dark mode support
- **Internationalization:** 7 languages dengan RTL support
- **Error messages:** Clear, actionable error messages

### 5.6 Compatibility
- **Browsers:** Chrome, Firefox, Safari, Edge (latest versions)
- **Mobile browsers:** iOS Safari, Chrome Mobile
- **LLM providers:** 15+ providers dengan OpenAI-compatible API support

---

## 6. Success Metrics

### 6.1 Adoption Metrics
- **Active users:** Monthly active users (MAU)
- **Classrooms generated:** Number of classrooms created per week
- **Completion rate:** Percentage of classrooms completed to the end
- **Export rate:** Percentage of classrooms exported

### 6.2 Engagement Metrics
- **Session duration:** Average time spent per classroom session
- **Interaction rate:** Average number of user interactions per session
- **Feature usage:** Usage breakdown by feature (slides, quiz, interactive, PBL)
- **Return rate:** Percentage of users who return within 7 days

### 6.3 Quality Metrics
- **Generation success rate:** Percentage of successful generations
- **Error rate:** Percentage of failed generations or API errors
- **User satisfaction:** NPS score atau user feedback ratings
- **Bug reports:** Number of bug reports per week

### 6.4 Performance Metrics
- **Generation latency:** Average generation time
- **API latency:** Average API response time
- **Page load time:** Average page load time
- **Uptime:** Platform uptime percentage

---

## 7. Roadmap

### Phase 1: Core Features (Current - v0.2.2)
- ✅ Lesson generation (outline + scenes)
- ✅ Slides dengan voice narration
- ✅ Quiz dengan AI grading
- ✅ Interactive simulations
- ✅ Multi-agent discussion
- ✅ Whiteboard drawing
- ✅ Export ke PPTX dan HTML
- ✅ 15+ LLM providers
- ✅ TTS/ASR integration
- ✅ Web search
- ✅ i18n (7 languages)
- ✅ Dark mode

### Phase 2: Enhancement (Q3 2026)
- 🔄 MAIC Editor Pro Mode (editable outline before generation)
- 🔄 Offline-ready classroom export
- 🔄 New search providers (Brave/Baidu/Bocha/MiniMax)
- 🔄 Azure STT integration
- 🔄 New models (Claude Opus 4.8, MiniMax M3, Gemini 3.5 Flash)
- 🔄 Traditional Chinese (zh-TW) dan Brazilian Portuguese (pt-BR)
- 🔄 Vocational test mode
- 🔄 PPTX import (end-to-end)

### Phase 3: Advanced Features (Q4 2026)
- 📋 Enhanced Deep Interactive Mode
- 📋 More interactive UI types
- 📋 Advanced PBL workflows
- 📋 Collaboration features (multi-user classrooms)
- 📋 Analytics dashboard
- 📋 Custom agent personas
- 📋 Integration dengan LMS platforms

### Phase 4: Ecosystem (2027)
- 📋 Plugin system
- 📋 API untuk third-party integrations
- 📋 Mobile apps (iOS, Android)
- 📋 Enterprise features (SSO, admin dashboard)
- 📋 Content marketplace
- 📋 Teacher tools (assessment, grading)

---

## 8. Risks & Mitigations

### 8.1 Technical Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM API rate limits | High | Implement retry logic, multiple provider support, queue management |
| Generation failures | High | Graceful error handling, partial generation recovery, clear error messages |
| Media generation latency | Medium | Async generation, progress indicators, caching |
| Browser compatibility | Medium | Cross-browser testing, polyfills, progressive enhancement |

### 8.2 Business Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| API cost overruns | High | Cost monitoring, provider selection, usage limits |
| User adoption | Medium | Onboarding improvements, tutorials, demo content |
| Competition | Medium | Differentiation through multi-agent approach, open-source community |
| Maintenance burden | Medium | Modular architecture, automated testing, documentation |

### 8.3 Security Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| API key exposure | High | Server-side storage, environment variables, no client-side keys |
| SSRF attacks | Medium | URL validation, localhost blocking, allowlist |
| Data privacy | Medium | Local storage options, clear data policy, GDPR compliance |
| Malicious content | Low | Content filtering, user reporting, moderation tools |

---

## 9. Open Questions

1. **Monetization:** Bagaimana model monetization untuk sustainabilitas jangka panjang?
2. **Enterprise features:** Fitur enterprise apa yang paling dibutuhkan (SSO, admin dashboard, analytics)?
3. **Mobile strategy:** Prioritas mobile apps vs responsive web?
4. **Content marketplace:** Apakah perlu marketplace untuk template/classroom yang sudah dibuat?
5. **Collaboration:** Real-time multi-user collaboration - priority dan timeline?
6. **Assessment:** Fitur assessment dan grading yang lebih advanced - requirement detail?

---

## 10. Appendices

### 10.1 Terminology
- **Scene:** Unit konten dalam classroom (slide, quiz, interactive, PBL)
- **Agent:** AI persona (teacher, student) dengan karakteristik unik
- **Stage:** Canvas area untuk rendering slides dan interactive content
- **Outline:** Struktur hierarkis dari pelajaran
- **PBL:** Project-Based Learning - pembelajaran berbasis proyek

### 10.2 References
- [README.md](./README.md) - Project documentation
- [CHANGELOG.md](./CHANGELOG.md) - Version history
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [JCST Paper](https://jcst.ict.ac.cn/en/article/doi/10.1007/s11390-025-6000-0) - Academic paper

### 10.3 Contact
- **Email:** thu_maic@mail.tsinghua.edu.cn
- **Discord:** https://discord.gg/p8Pf2r3SaG
- **Feishu:** https://community/feishu.md
- **GitHub:** https://github.com/THU-MAIC/OpenMAIC

---

**Document History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-28 | Cascade | Initial PRD creation |
