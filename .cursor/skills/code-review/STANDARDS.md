# KelasKA Code Review Standards

Project-specific rules beyond generic TypeScript/React best practices.

## Stack Reference

| Layer | Technology |
|-------|------------|
| Web | Next.js 16 App Router, React 19 |
| State | Zustand (`lib/store/`) |
| DB | PostgreSQL + Prisma (`prisma/schema.prisma`) |
| Auth | NextAuth.js v5 (`auth()`, `lib/auth/session.ts`) |
| UI | shadcn/ui + Radix (`components/ui/`) |
| i18n | i18next, locales in `lib/i18n/locales/` |
| AI | LangGraph orchestration, multi-provider LLM abstraction |
| Package manager | pnpm (monorepo workspace) |

## Directory Conventions

```
app/           → Pages and API routes (App Router)
components/    → React UI; co-locate feature components by domain
lib/           → Business logic, hooks, types, providers
packages/      → Internal workspace packages
prisma/        → Schema and migrations
mobile/        → Capacitor Android companion
desktop/       → Electron Windows companion
```

Prefer extending existing modules over creating parallel implementations.

## Multi-Tenant Rules

KelasKA is multi-tenant. Every data-access path must enforce tenant isolation.

**Roles** (per `TenantUser.role`): `SUPER_ADMIN`, `ADMIN`, `INSTRUCTOR`, `STUDENT`

Review questions:
1. Does the query include `tenantId` in the `where` clause?
2. Is the `tenantId` taken from the authenticated user's membership — not blindly from request body/query?
3. Can a student escalate to instructor actions without a role check?
4. Do list endpoints paginate (`skip`/`take`) to avoid unbounded responses?

Example pattern (courses API):
```typescript
const user = await getCurrentUser();
if (!user) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });

const tenantId = searchParams.get("tenantId") || (await getUserPrimaryTenantId(user.id));
// Verify user belongs to tenantId before querying
```

Flag any endpoint that accepts `tenantId` from the client without verifying membership.

## Authentication Patterns

- Server components/routes: `import { auth } from "@/auth"` or `getCurrentUser()` from `@/lib/auth/session`
- Return `401` for unauthenticated, `403` for authenticated but unauthorized
- Admin panel uses separate cookie auth (`lib/admin/admin-auth.ts`) — do not mix with user session
- Legacy access-code gate (`ACCESS_CODE` env) uses `openmaic_access` cookie with constant-time comparison

## i18n Requirements

**All user-facing UI text must be internationalized.** Primary UI language is Bahasa Indonesia; all 7+ locales must stay aligned.

When reviewing UI changes:
1. Search diff for string literals in JSX — flag hardcoded labels, buttons, toasts, errors shown to users
2. API error messages shown to users should also be i18n on the client, or use keys the client translates
3. New keys: add to every file in `lib/i18n/locales/*.json` with identical key structure
4. Run `pnpm check:i18n-keys` — CI enforces key alignment
5. Never rename or remove `{{interpolation}}` variables without updating call sites

Server-only log messages and developer comments do not require i18n.

## API Response Conventions

Two patterns exist — match the surrounding route:

**LMS routes** (courses, enrollments, auth):
```typescript
return NextResponse.json({ error: "..." }, { status: 4xx });
```

**Legacy OpenMAIC routes** (generation, chat):
```typescript
import { apiError, apiSuccess } from '@/lib/server/api-response';
return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
```

Do not introduce a third pattern without justification.

## Prisma & Migrations

- Schema changes → `prisma migrate dev` → commit migration SQL
- Use `@default(cuid())` for IDs (existing convention)
- Enum changes affect existing data — review for backward compatibility
- Avoid `findMany` without `take` on user-controlled queries

## Testing Expectations

CI runs:
- Prettier (`pnpm check`)
- ESLint (`pnpm lint`)
- TypeScript (`npx tsc --noEmit`)
- i18n key alignment (`pnpm check:i18n-keys`)
- Unit tests (`pnpm test`, `@openmaic/importer` filter)
- Playwright e2e

For non-trivial logic changes, expect unit tests. For UI flows, expect manual verification steps in the PR. Flag missing regression checks on playback, generation, or enrollment flows.

## Code Style

- Prettier + ESLint (Next.js config); run `pnpm format` and `pnpm lint --fix` before commit
- `@typescript-eslint/no-unused-vars` enforced — prefix intentionally unused with `_`
- Prefer `import` aliases `@/` over deep relative paths
- Hooks in `lib/hooks/`; shared types in `lib/types/`

## Commit & Branch Naming

```
feat/   → new features
fix/    → bug fixes
docs/   → documentation
```

Commits: Conventional Commits — `feat(scope): description`, `fix(scope): description`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`

## Security Review Focus

| Area | What to check |
|------|---------------|
| Auth bypass | Missing `getCurrentUser()` guard |
| IDOR | Resource fetched by ID without tenant/ownership check |
| Injection | Unsanitized input in raw queries or `dangerouslySetInnerHTML` |
| Secrets | Env vars, API keys, tokens in code or logs |
| Cookies | Missing `httpOnly`/`secure`/`sameSite` |
| File upload | Unrestricted type/size, path traversal |
| LLM prompts | User input concatenated without boundaries |

Report security vulnerabilities privately via GitHub Security Advisories — not public issues.

## AI-Assisted PRs

If the PR is AI-generated:
- Author must disclose AI assistance
- Author must have self-reviewed before requesting maintainer review
- Reviewer applies the same quality bar — do not accept "AI slop" with missing edge cases

## Common Anti-Patterns in This Codebase

| Anti-pattern | Why it matters |
|--------------|----------------|
| Hardcoded UI strings | Breaks i18n; fails CI key checks |
| `tenantId` from body without membership check | Cross-tenant data leak |
| Client-side API key for generation | Bypasses server provider config |
| Large refactor mixed with feature | Hard to review; project rejects refactor-only PRs |
| New locale keys in one language only | Breaks `check:i18n-keys` |
| `any` on Prisma `where` clauses | Hides type errors; acceptable only in legacy routes being migrated |
