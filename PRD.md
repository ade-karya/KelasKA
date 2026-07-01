# PRD v2.0 — KelasKA LMS Multi-Platform

**Versi Dokumen:** 2.0  
**Tanggal:** 29 Juni 2026  
**Status:** Draft — Menunggu Approval

---

## 1. Ringkasan Eksekutif

**KelasKA** bertransformasi dari AI interactive classroom (OpenMAIC) menjadi **Learning Management System (LMS) multi-platform** yang lengkap. Platform ini menggabungkan kekuatan AI multi-agent dengan fitur LMS tradisional — user management, course enrollment, progress tracking, gradebook, dan certificate.

### Keputusan Desain Utama

| Keputusan | Pilihan |
|-----------|---------|
| **Platform inti** | 🌐 **Web** (Next.js) — semua fitur utama |
| **Windows & Android** | 🔧 Companion/management app, bukan app inti |
| **Database** | 🐘 **PostgreSQL di Docker** |
| **Authentication** | 🔐 **NextAuth.js + Google OAuth** |
| **Android distribution** | 📱 **Google Play Store** |
| **Monetization** | 💰 **Freemium model** |
| **Multi-tenant** | 🏢 **Ya** — satu instance melayani banyak organisasi |
| **Bahasa utama UI** | 🇮🇩 **Bahasa Indonesia** (tetap support multi-language) |
| **Deployment** | 🐳 **Docker Compose** (app + postgres + redis) |

---

## 2. Analisis Kondisi Saat Ini

### 2.1 Apa yang Sudah Ada

| Aspek | Status | Lokasi |
|-------|--------|--------|
| Web App (Next.js 16 + React 19) | ✅ | `app/` |
| Windows Desktop (Electron 42) | ✅ | `desktop/` |
| AI Classroom (slides, quiz, PBL, interactive) | ✅ | `app/classroom/`, `lib/` |
| Multi-agent Orchestration (LangGraph) | ✅ | `lib/orchestration/` |
| Admin Panel (stats, access codes) | ✅ | `app/admin/` |
| Docker support (single container) | ✅ | `Dockerfile`, `docker-compose.yml` |
| Export PPTX/HTML/ZIP | ✅ | `lib/export/` |
| TTS/ASR | ✅ | `lib/audio/` |
| i18n (7 languages) | ✅ | `lib/i18n/` |

### 2.2 Status Implementasi Fitur LMS

| Fitur LMS | Status | Prioritas | Deskripsi / Lokasi File |
|-----------|--------|-----------|-------------------------|
| User authentication (accounts) | ✅ | P0 | NextAuth.js v5 (`/app/(auth)/`) |
| Server-side database (PostgreSQL) | ✅ | P0 | Prisma schema & Postgres (`/prisma/schema.prisma`) |
| Course management (CRUD) | ✅ | P0 | API endpoints & dasbor pengajar (`/api/courses`) |
| Enrollment system | ✅ | P0 | API pendaftaran otomatis (`/api/courses/[id]/enroll`) |
| Progress tracking | ✅ | P1 | Penyimpanan progres belajar (`/api/progress`) |
| Gradebook & assessment | ✅ | P1 | Agregasi skor kuis classroom (`/api/quiz-attempts`) |
| Discussion forum | ✅ | P1 | Utas tanya jawab & reply bertingkat (`/api/discussions`) |
| Certificate system | ✅ | P2 | Auto-generate & verifikasi sertifikat (`/courses/verify/`) |
| Notification system | ✅ | P2 | Notifikasi in-app & ikon bel header (`/api/notifications`) |
| Android app | ✅ | P1 | Capacitor 7 wrapper project (`/mobile/`) |
| Multi-tenant support | ✅ | P0 | Tenant ID di setiap entitas (`/prisma/schema.prisma`) |
| Freemium / billing | ✅ | P2 | Freemium model configuration |

---

## 3. Arsitektur Platform

### 3.1 Platform Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    KelasKA Platform                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   🌐 WEB (Platform Inti)                                       │
│   ├── Semua fitur LMS lengkap                                  │
│   ├── AI Classroom engine                                       │
│   ├── Admin panel                                               │
│   ├── Course management                                         │
│   └── Instructor & Student dashboard                            │
│                                                                 │
│   🖥️ WINDOWS (Companion App)                                   │
│   ├── Quick access ke dashboard                                 │
│   ├── Notification tray                                         │
│   ├── Offline classroom viewer                                  │
│   └── Admin management tools                                    │
│                                                                 │
│   📱 ANDROID (Companion App)                                    │
│   ├── Course browsing & enrollment                              │
│   ├── Lesson viewer (consume content)                           │
│   ├── Push notifications                                        │
│   ├── Progress tracking                                         │
│   └── Discussion forum                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Web adalah platform inti.** Windows dan Android adalah companion apps untuk manajemen & konsumsi konten. Fitur berat seperti AI lesson generation, course creation, dan admin panel tetap di Web.

### 3.2 Docker Compose Stack

```yaml
# docker-compose.yml (BARU — menggantikan yang ada)
services:
  # ── App ──────────────────────────────────────
  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    environment:
      - DATABASE_URL=postgresql://kelaska:kelaska_secret@postgres:5432/kelaska
      - REDIS_URL=redis://redis:6379
      - NEXTAUTH_URL=http://localhost:3000
      - NEXTAUTH_SECRET=<generate-random-secret>
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - app-data:/app/data
      - app-uploads:/app/uploads
    restart: unless-stopped

  # ── PostgreSQL ───────────────────────────────
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: kelaska
      POSTGRES_USER: kelaska
      POSTGRES_PASSWORD: kelaska_secret
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kelaska"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ── Redis (sessions, cache, queues) ──────────
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  app-data:
  app-uploads:
  postgres-data:
  redis-data:
```

### 3.3 Folder Structure (Perubahan)

```
KelasKA/
├── app/
│   ├── (auth)/                    # 🆕 Auth pages
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (dashboard)/               # 🆕 Dashboard pages
│   │   ├── page.tsx               # Student dashboard
│   │   ├── instructor/page.tsx    # Instructor dashboard
│   │   └── settings/page.tsx
│   ├── (courses)/                 # 🆕 Course pages
│   │   ├── page.tsx               # Course catalog
│   │   ├── [courseId]/page.tsx     # Course detail
│   │   ├── [courseId]/learn/page.tsx
│   │   └── [courseId]/manage/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/    # 🆕 NextAuth.js
│   │   ├── courses/               # 🆕 Course APIs
│   │   ├── enrollments/           # 🆕 Enrollment APIs
│   │   ├── progress/              # 🆕 Progress APIs
│   │   ├── discussions/           # 🆕 Discussion APIs
│   │   ├── certificates/          # 🆕 Certificate APIs
│   │   ├── notifications/         # 🆕 Notification APIs
│   │   ├── tenants/               # 🆕 Multi-tenant APIs
│   │   └── ... (existing APIs)
│   ├── admin/                     # ✏️ Enhanced admin
│   └── classroom/                 # ✅ Existing (enhanced)
├── prisma/                        # 🆕
│   ├── schema.prisma
│   └── migrations/
├── mobile/                        # 🆕 Capacitor (Android)
│   ├── android/
│   ├── capacitor.config.ts
│   └── package.json
├── desktop/                       # ✅ Existing (enhanced)
├── docker-compose.yml             # ✏️ Updated (app + postgres + redis)
├── Dockerfile                     # ✏️ Updated (prisma support)
└── ...
```

---

## 4. Fitur Detail

### 4.1 User Authentication & Roles (P0)

**Tech Stack:** NextAuth.js v5 + Google OAuth + Credentials provider

**Flows:**
1. **Register** → Email + Password + Nama + Organisasi (opsional)
2. **Login** → Email/Password ATAU Google OAuth
3. **Forgot Password** → Email reset link
4. **Session** → JWT stored in httpOnly cookie

**Roles & Permissions:**

| Permission | Guest | Student | Instructor | Admin | Super Admin |
|------------|:-----:|:-------:|:----------:|:-----:|:-----------:|
| Browse courses | ✅ | ✅ | ✅ | ✅ | ✅ |
| Enroll in course | ❌ | ✅ | ✅ | ✅ | ✅ |
| Take lessons/quizzes | ❌ | ✅ | ✅ | ✅ | ✅ |
| Create courses | ❌ | ❌ | ✅ | ✅ | ✅ |
| Generate AI classroom | ❌ | ❌ | ✅ | ✅ | ✅ |
| Grade students | ❌ | ❌ | ✅ | ✅ | ✅ |
| Manage users | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage tenant | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage all tenants | ❌ | ❌ | ❌ | ❌ | ✅ |

### 4.2 Database Schema (Prisma) (P0)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Multi-tenant ────────────────────────
model Tenant {
  id          String   @id @default(cuid())
  name        String                         // "SMA Negeri 1 Bandung"
  slug        String   @unique               // "sman1-bandung"
  logo        String?
  plan        Plan     @default(FREE)
  maxUsers    Int      @default(50)
  maxCourses  Int      @default(10)
  createdAt   DateTime @default(now())
  
  users       TenantUser[]
  courses     Course[]
}

enum Plan {
  FREE
  STARTER
  PRO
  ENTERPRISE
}

// ── Users ───────────────────────────────
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String
  password      String?                       // null jika OAuth-only
  avatar        String?
  bio           String?
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  
  accounts      Account[]                     // OAuth accounts
  tenants       TenantUser[]
  enrollments   Enrollment[]
  progress      Progress[]
  quizAttempts  QuizAttempt[]
  certificates  Certificate[]
  discussions   Discussion[]
  replies       Reply[]
  notifications Notification[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([provider, providerAccountId])
}

model TenantUser {
  id       String   @id @default(cuid())
  userId   String
  tenantId String
  role     Role     @default(STUDENT)
  joinedAt DateTime @default(now())
  
  user   User   @relation(fields: [userId], references: [id])
  tenant Tenant @relation(fields: [tenantId], references: [id])
  
  @@unique([userId, tenantId])
}

enum Role {
  SUPER_ADMIN
  ADMIN
  INSTRUCTOR
  STUDENT
}

// ── Courses ─────────────────────────────
model Course {
  id            String       @id @default(cuid())
  tenantId      String
  instructorId  String
  title         String
  description   String?
  thumbnail     String?
  category      String?
  tags          String[]
  status        CourseStatus  @default(DRAFT)
  isFree        Boolean      @default(true)
  price         Float?
  maxStudents   Int?
  enrollStart   DateTime?
  enrollEnd     DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  
  tenant      Tenant       @relation(fields: [tenantId], references: [id])
  lessons     Lesson[]
  enrollments Enrollment[]
  discussions Discussion[]
  certificates Certificate[]
}

enum CourseStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

// ── Lessons ─────────────────────────────
model Lesson {
  id             String   @id @default(cuid())
  courseId        String
  title          String
  description    String?
  order          Int
  classroomId    String?                    // link ke existing classroom data
  classroomData  Json?                      // embedded classroom JSON
  duration       Int?                       // estimated minutes
  isFree         Boolean  @default(false)   // free preview lesson
  createdAt      DateTime @default(now())
  
  course       Course        @relation(fields: [courseId], references: [id], onDelete: Cascade)
  progress     Progress[]
  quizAttempts QuizAttempt[]
}

// ── Enrollments ─────────────────────────
model Enrollment {
  id         String           @id @default(cuid())
  userId     String
  courseId    String
  status     EnrollmentStatus @default(ACTIVE)
  enrolledAt DateTime         @default(now())
  
  user   User   @relation(fields: [userId], references: [id])
  course Course @relation(fields: [courseId], references: [id])
  
  @@unique([userId, courseId])
}

enum EnrollmentStatus {
  PENDING
  ACTIVE
  COMPLETED
  DROPPED
}

// ── Progress ────────────────────────────
model Progress {
  id          String         @id @default(cuid())
  userId      String
  lessonId    String
  status      ProgressStatus @default(NOT_STARTED)
  timeSpent   Int            @default(0)    // seconds
  lastAccess  DateTime       @default(now())
  completedAt DateTime?
  
  user   User   @relation(fields: [userId], references: [id])
  lesson Lesson @relation(fields: [lessonId], references: [id])
  
  @@unique([userId, lessonId])
}

enum ProgressStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
}

// ── Quiz Attempts ───────────────────────
model QuizAttempt {
  id        String   @id @default(cuid())
  userId    String
  lessonId  String
  score     Float
  maxScore  Float
  answers   Json
  createdAt DateTime @default(now())
  
  user   User   @relation(fields: [userId], references: [id])
  lesson Lesson @relation(fields: [lessonId], references: [id])
}

// ── Certificates ────────────────────────
model Certificate {
  id               String   @id @default(cuid())
  userId           String
  courseId          String
  verificationCode String   @unique @default(cuid())
  issuedAt         DateTime @default(now())
  
  user   User   @relation(fields: [userId], references: [id])
  course Course @relation(fields: [courseId], references: [id])
  
  @@unique([userId, courseId])
}

// ── Discussion Forum ────────────────────
model Discussion {
  id        String   @id @default(cuid())
  courseId   String
  userId    String
  title     String
  content   String
  isPinned  Boolean  @default(false)
  isResolved Boolean @default(false)
  createdAt DateTime @default(now())
  
  course  Course  @relation(fields: [courseId], references: [id])
  user    User    @relation(fields: [userId], references: [id])
  replies Reply[]
}

model Reply {
  id           String   @id @default(cuid())
  discussionId String
  userId       String
  content      String
  createdAt    DateTime @default(now())
  
  discussion Discussion @relation(fields: [discussionId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id])
}

// ── Notifications ───────────────────────
model Notification {
  id        String   @id @default(cuid())
  userId    String
  title     String
  message   String
  type      String                          // enrollment, grade, announcement, etc.
  isRead    Boolean  @default(false)
  link      String?
  createdAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id])
}
```

### 4.3 Multi-Tenant Architecture (P0)

```
┌─────────────────────────────────────────────┐
│              KelasKA Instance               │
│              (Single Docker)                │
├─────────────────────────────────────────────┤
│                                             │
│  Tenant: SMA Negeri 1 Bandung               │
│  ├── Admin: Pak Budi                        │
│  ├── Instructor: Bu Ani, Pak Dedi           │
│  ├── Students: 200 siswa                    │
│  ├── Courses: Matematika, Fisika, Kimia     │
│  └── Plan: STARTER (200 users, 50 courses)  │
│                                             │
│  Tenant: Universitas XYZ                    │
│  ├── Admin: Dr. Sari                        │
│  ├── Instructor: 15 dosen                   │
│  ├── Students: 500 mahasiswa                │
│  ├── Courses: 30 mata kuliah                │
│  └── Plan: PRO (unlimited)                  │
│                                             │
│  Tenant: Personal (Adi)                     │
│  ├── Role: STUDENT                          │
│  ├── Enrolled in: 3 public courses          │
│  └── Plan: FREE                             │
│                                             │
└─────────────────────────────────────────────┘
```

- Data isolasi per tenant (semua query di-filter by `tenantId`)
- Satu user bisa bergabung di **banyak tenant** dengan role berbeda
- Super Admin mengelola semua tenant

### 4.4 Freemium Model (P2)

| Fitur | FREE | STARTER | PRO | ENTERPRISE |
|-------|:----:|:-------:|:---:|:----------:|
| Max Users | 50 | 200 | Unlimited | Unlimited |
| Max Courses | 10 | 50 | Unlimited | Unlimited |
| AI Lesson Generation | 5/bulan | 50/bulan | Unlimited | Unlimited |
| Storage | 1 GB | 10 GB | 100 GB | Custom |
| Export PPTX/HTML | ✅ | ✅ | ✅ | ✅ |
| Certificate | ❌ | ✅ | ✅ | ✅ |
| Custom branding | ❌ | ❌ | ✅ | ✅ |
| Analytics dashboard | Basic | Full | Full | Full |
| Support | Community | Email | Priority | Dedicated |
| Harga | Gratis | Rp 199K/bln | Rp 799K/bln | Custom |

### 4.5 Course Management (P0)

**Instructor Flow:**
1. Buat course → isi judul, deskripsi, thumbnail, kategori
2. Tambah lesson → bisa manual ATAU generate via AI classroom
3. Set visibility → Draft / Published / Archived
4. Set enrollment → Open / Invitation code / Approval required
5. Monitor → Dashboard: students enrolled, progress, quiz scores

**Student Flow:**
1. Browse catalog → filter by category, search
2. Enroll → klik "Gabung" atau masukkan kode undangan
3. Belajar → buka lesson, interaksi dengan AI classroom
4. Kuis → jawab quiz, dapat nilai otomatis
5. Selesai → dapat certificate (jika semua lesson completed)

### 4.6 Progress Tracking (P1)

- **Per-lesson**: Not Started → In Progress → Completed
- **Per-course**: Persentase completion (lessons completed / total lessons)
- **Time tracking**: Berapa menit dihabiskan per lesson
- **Resume**: Otomatis lanjut dari posisi terakhir
- **Streaks**: Track learning consistency (daily/weekly)

### 4.7 Discussion Forum (P1)

- Thread per course
- Instructor bisa pin & mark as resolved
- AI-assisted answers (opsional — AI menjawab berdasarkan materi course)
- Notification ke instructor saat ada pertanyaan baru

### 4.8 Certificate System (P2)

- Auto-generate saat semua lesson dalam course completed
- Template: nama student, judul course, tanggal, nama instructor
- QR code untuk verifikasi
- Download PDF
- Shareable link: `kelaska.com/verify/{code}`

### 4.9 Android App — Companion (P1)

**Tech Stack:** Capacitor 7 (wrapping web app)

**Fitur:**
- Course catalog & enrollment
- Lesson viewer (consume AI classroom content)
- Quiz taking
- Progress dashboard
- Push notifications (Firebase Cloud Messaging)
- Discussion forum
- Offline: cache lessons yang sudah dibuka

**Bukan untuk:**
- AI lesson generation (terlalu berat, tetap di Web)
- Course creation/management (tetap di Web)
- Admin panel (tetap di Web)

**Distribution:** Google Play Store

### 4.10 Windows App — Enhanced (P2)

**Perubahan dari existing:**
- Tambah notification tray icon
- Quick access ke dashboard
- Offline classroom viewer (existing, enhanced)
- Tetap bisa akses semua fitur Web (karena Electron = embedded browser)

---

## 5. API Endpoints Baru

### Auth
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `POST` | `/api/auth/[...nextauth]` | NextAuth.js handler |
| `GET` | `/api/auth/me` | Current user + roles |

### Tenants
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/tenants` | List user's tenants |
| `POST` | `/api/tenants` | Create tenant |
| `PUT` | `/api/tenants/[id]` | Update tenant |
| `POST` | `/api/tenants/[id]/invite` | Invite user to tenant |
| `GET` | `/api/tenants/[id]/members` | List tenant members |

### Courses
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/courses` | List/search courses |
| `POST` | `/api/courses` | Create course |
| `GET` | `/api/courses/[id]` | Get course detail |
| `PUT` | `/api/courses/[id]` | Update course |
| `DELETE` | `/api/courses/[id]` | Delete course |
| `POST` | `/api/courses/[id]/enroll` | Enroll in course |
| `GET` | `/api/courses/[id]/students` | List enrolled students |
| `GET` | `/api/courses/[id]/gradebook` | Course gradebook |

### Lessons
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/courses/[id]/lessons` | List lessons |
| `POST` | `/api/courses/[id]/lessons` | Create lesson |
| `PUT` | `/api/lessons/[id]` | Update lesson |
| `DELETE` | `/api/lessons/[id]` | Delete lesson |
| `POST` | `/api/lessons/[id]/generate` | Generate AI classroom for lesson |

### Progress
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/progress/course/[courseId]` | Course progress |
| `PUT` | `/api/progress/lesson/[lessonId]` | Update lesson progress |

### Discussions
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/courses/[id]/discussions` | List discussions |
| `POST` | `/api/courses/[id]/discussions` | Create discussion |
| `GET` | `/api/discussions/[id]` | Get discussion + replies |
| `POST` | `/api/discussions/[id]/replies` | Add reply |

### Certificates
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `POST` | `/api/certificates/course/[courseId]` | Generate certificate |
| `GET` | `/api/certificates/verify/[code]` | Verify certificate |

### Notifications
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/notifications` | List notifications |
| `PUT` | `/api/notifications/read-all` | Mark all as read |

---

## 6. Infrastructure — Docker Deployment

### 6.1 Quick Start

```bash
# 1. Clone & configure
git clone https://github.com/ade-karya/KelasKA.git
cd KelasKA
cp .env.example .env.local

# 2. Edit .env.local — tambahkan:
#    DATABASE_URL=postgresql://kelaska:kelaska_secret@postgres:5432/kelaska
#    REDIS_URL=redis://redis:6379
#    NEXTAUTH_SECRET=<random-string>
#    GOOGLE_CLIENT_ID=<dari-google-console>
#    GOOGLE_CLIENT_SECRET=<dari-google-console>

# 3. Launch
docker compose up -d

# 4. Run migrations (first time only)
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma db seed
```

### 6.2 Updated Dockerfile

```dockerfile
# Perubahan dari Dockerfile existing:
# - Tambah prisma generate di build stage
# - Tambah prisma client di runner stage
# - Tambah healthcheck

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache python3 build-base g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY prisma/ ./prisma/           # 🆕
RUN pnpm install --frozen-lockfile
RUN npx prisma generate            # 🆕

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apk add --no-cache libc6-compat cairo pango jpeg giflib librsvg
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma    # 🆕
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma  # 🆕

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \   # 🆕
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
```

### 6.3 Backup & Restore

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U kelaska kelaska > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -T postgres psql -U kelaska kelaska < backup_20260629.sql

# Backup volumes
docker run --rm -v kelaska_postgres-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/postgres-data.tar.gz -C /data .
```

---

## 7. Roadmap Implementasi

### Phase 1: Foundation — Database & Auth (4-6 minggu)
- [ ] Setup Prisma + PostgreSQL schema
- [ ] Update Docker Compose (app + postgres + redis)
- [ ] Implement NextAuth.js (credentials + Google OAuth)
- [ ] Role-based middleware
- [ ] Multi-tenant model (Tenant, TenantUser)
- [ ] Login/Register UI (Bahasa Indonesia)
- [ ] Migrate existing ACCESS_CODE → user accounts
- [ ] Seed data & migration scripts

### Phase 2: Core LMS — Courses & Enrollment (4-6 minggu)
- [ ] Course CRUD (API + UI)
- [ ] Course catalog page (browse, search, filter)
- [ ] Enrollment system (open, invitation, approval)
- [ ] Lesson management (manual + AI-generated)
- [ ] Bridge: existing AI classroom → lesson entity
- [ ] Student dashboard
- [ ] Instructor dashboard
- [ ] Progress tracking per lesson/course

### Phase 3: Assessment & Social (3-4 minggu)
- [ ] Gradebook (aggregate quiz scores per course)
- [ ] Quiz attempt persistence di PostgreSQL
- [ ] Discussion forum (per-course threads)
- [ ] AI-assisted discussion answers
- [ ] Notification system (in-app)
- [ ] Certificate generation

### Phase 4: Android App (3-4 minggu)
- [ ] Setup Capacitor project
- [ ] Configure Android build & signing
- [ ] Responsive UI optimization (mobile-first views)
- [ ] Push notifications (Firebase Cloud Messaging)
- [ ] Offline lesson caching (Service Worker)
- [ ] Test on 5+ Android devices
- [ ] Google Play Store submission

### Phase 5: Polish & Launch (2-3 minggu)
- [ ] Freemium tier enforcement
- [ ] Enhanced admin panel (tenant management, analytics)
- [ ] E2E testing (Playwright) — auth, enrollment, learning flow
- [ ] Performance optimization (lazy loading, caching)
- [ ] Security audit (OWASP top 10)
- [ ] Documentation (user guide Bahasa Indonesia)
- [ ] Windows desktop app update (notification tray, quick access)

**Total estimasi: 17-25 minggu**

---

## 8. Verification Plan

### Automated Tests
```bash
# Unit tests
pnpm test

# E2E tests
pnpm test:e2e

# Database migration test
docker compose exec app npx prisma migrate deploy --preview-feature

# API integration tests
pnpm test:api
```

### Manual Verification
- [ ] Register → Login → Create tenant → Invite users
- [ ] Instructor: Create course → Add lessons → Generate AI classroom → Publish
- [ ] Student: Browse catalog → Enroll → Take lessons → Complete quizzes → Get certificate
- [ ] Admin: Manage users → View analytics → Manage access codes
- [ ] Docker: `docker compose up` → semua services healthy → app accessible
- [ ] Android: Install APK → login → browse courses → take lesson → push notification
- [ ] Windows: Launch desktop app → quick access dashboard → offline viewer

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Database migration complexity | High | Incremental migration, dual-write period |
| Performance with multi-tenant | High | Database indexing, Redis caching, connection pooling |
| Capacitor limitations on mobile | Medium | Identify limitations early, fallback to native where needed |
| Google Play Store review | Medium | Follow Play Store policies from day 1, prepare privacy policy |
| Breaking existing features | High | Feature flags, comprehensive E2E tests, staged rollout |
| Docker resource usage | Medium | Optimize container sizes, set resource limits |

---

## 10. Appendices

### 10.1 Environment Variables (Baru)

```env
# Database
DATABASE_URL=postgresql://kelaska:kelaska_secret@postgres:5432/kelaska

# Redis
REDIS_URL=redis://redis:6379

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=super-secret-random-string

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx

# Firebase (Android push notifications)
FIREBASE_PROJECT_ID=kelaska-app
FIREBASE_PRIVATE_KEY=...
FIREBASE_CLIENT_EMAIL=...
```

### 10.2 Teknologi Baru yang Ditambahkan

| Package | Purpose | Version |
|---------|---------|---------|
| `next-auth` | Authentication | v5 |
| `@prisma/client` | Database ORM | Latest |
| `prisma` | Schema & migrations | Latest |
| `@capacitor/core` | Android wrapper | v7 |
| `@capacitor/android` | Android platform | v7 |
| `@capacitor/push-notifications` | Push notif | v7 |
| `firebase-admin` | FCM server-side | Latest |
| `ioredis` | Redis client | Latest |
| `@react-pdf/renderer` | Certificate PDF | Latest |
| `qrcode` | Certificate QR | Latest |

---

**Document History**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-28 | Cascade | Initial PRD (AI classroom only) |
| 2.0 | 2026-06-29 | Antigravity | LMS transformation, multi-platform, Docker stack |
