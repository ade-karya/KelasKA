---
name: code-review
description: Review KelasKA/OpenMAIC code changes for correctness, security, i18n, multi-tenant isolation, and project standards. Use when reviewing pull requests, examining diffs, performing self-review before submit, or when the user asks for a code review.
---

# KelasKA Code Review

Review changes against project standards in [STANDARDS.md](STANDARDS.md). Be specific — cite file paths and line ranges.

## Quick Start

1. Read the diff and identify change type: bug fix, feature, LMS/auth, UI, API, AI/orchestration, or refactor.
2. Run or verify CI-equivalent checks when reviewing local changes:
   ```bash
   pnpm check && pnpm lint && npx tsc --noEmit && pnpm check:i18n-keys && pnpm test
   ```
3. Apply the checklist below for the change type.
4. Report findings using the output format at the bottom.

## Universal Checklist

- [ ] Change is focused — one concern per PR; no unrelated edits
- [ ] Linked issue or clear justification (required for PRs per CONTRIBUTING.md)
- [ ] Conventional commit / PR description explains **why**, not just what
- [ ] No secrets, API keys, or `.env` values committed
- [ ] TypeScript types are explicit; avoid `any` unless justified
- [ ] Error paths handled; no silent failures
- [ ] Existing behavior not regressed (manual verification described for UI/API changes)

## Area-Specific Checks

### UI / Components

- [ ] User-facing strings use i18n (`t('key')`), not hardcoded text
- [ ] New/changed keys added to **all** locale files; `pnpm check:i18n-keys` passes
- [ ] Interpolation variables (`{{name}}`) preserved — see `lib/i18n/TRANSLATION_GUIDE.md`
- [ ] Screenshots or before/after evidence for visual changes
- [ ] Follows existing component patterns (`components/ui/` shadcn, Zustand stores in `lib/store/`)

### API Routes (`app/api/`)

- [ ] Auth checked via `getCurrentUser()` or appropriate guard before data access
- [ ] Role checks for instructor/admin endpoints (`INSTRUCTOR`, `ADMIN`, `SUPER_ADMIN`)
- [ ] **Tenant scoping**: queries filter by `tenantId`; user cannot access other tenants' data
- [ ] Input validated; malformed JSON returns 400
- [ ] Consistent error responses (`NextResponse.json` or `apiError` helper)
- [ ] No raw stack traces leaked to clients in production

### Database / Prisma

- [ ] Schema changes include migration; no hand-edited DB without migration
- [ ] Relations and cascades intentional (`onDelete` behavior)
- [ ] Queries use indexes-friendly filters; avoid N+1 (use `include`/`select` deliberately)
- [ ] Tenant-bound models always scoped by `tenantId`

### Auth & Security

- [ ] Session via NextAuth (`auth()` / `getCurrentUser()`); cookies are `httpOnly`, `secure` in production
- [ ] Sensitive comparisons use constant-time checks where applicable
- [ ] Security issues reported privately — never suggest public issue filing for vulnerabilities
- [ ] Refactor-only PRs flagged — project does not accept unless maintainer-requested

### AI / Classroom / Orchestration (`lib/generation/`, `lib/orchestration/`, `lib/pbl/`)

- [ ] Prompt changes preserve JSON output contracts and existing template structure
- [ ] Provider resolution uses server-side config; no client-side key bypass
- [ ] Streaming/SSE error handling does not leave hung connections
- [ ] State machine transitions in playback/orchestration remain valid

## PR Scope Rules (from CONTRIBUTING.md)

| Change type | Review note |
|-------------|-------------|
| Bug fix / docs / provider extension | OK to merge if quality checks pass |
| New feature / architecture / UI redesign | Should have prior Discussion unless trivial |
| Refactor-only | **Reject** unless explicitly requested by maintainer |
| AI-assisted PR | Must note AI use; author should have self-reviewed first |

## Output Format

Structure every review as:

```markdown
## Summary
[1–2 sentences: what changed and overall assessment]

## Findings

### Critical (must fix)
- [file:line] Issue — suggested fix

### Suggestions (should consider)
- [file:line] Issue — suggested fix

### Nice to have
- [file:line] Optional improvement

## Checklist gaps
- [ ] Missing i18n keys
- [ ] No tenant scoping on query X
- [ ] CI checks not verified
[List only items that failed or were not verifiable]

## Verdict
**Approve** | **Approve with nits** | **Request changes**
```

Severity guide:
- **Critical**: bugs, security holes, data leaks across tenants, broken auth, missing i18n on user-facing text, CI failures
- **Suggestions**: readability, edge cases, missing tests for non-trivial logic, inconsistent patterns
- **Nice to have**: naming, minor refactors, documentation gaps

## Additional Resources

- Detailed KelasKA domain rules: [STANDARDS.md](STANDARDS.md)
- Contributing guide: [CONTRIBUTING.md](../../CONTRIBUTING.md)
- Translation rules: [lib/i18n/TRANSLATION_GUIDE.md](../../lib/i18n/TRANSLATION_GUIDE.md)
