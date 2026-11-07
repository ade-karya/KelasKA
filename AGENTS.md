<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent Guidance

Guidance for coding agents working in this repository, including the automated Codex review that runs on every non-draft pull request. The contribution workflow is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Working Agreement

- Update this file (`AGENTS.md`) as part of every change. Record the durable build, test, deployment, or debugging lesson the work produced, in the relevant section below. Keep it short and actionable; do not duplicate code or CONTRIBUTING.md.

## Build and Test Resources

- Maximize the RAM a memory-heavy Node task may use instead of leaving Node's default heap. The Next.js production build type-checks a large module graph and can exceed the default ~2 GB limit, failing with `FATAL ERROR: Reached heap limit`.
- Check `free -h` first, then set `NODE_OPTIONS` below the available RAM so the OS keeps headroom. On the 12 GB Colab host, use:
  ```bash
  NODE_OPTIONS="--max-old-space-size=8192" bun run build
  ```
- Use the same setting for other heavy runs (large test suites, type checks). Do not run several memory-heavy tasks at once.
- This app deploys `.next/standalone` through PM2. `next build` does not copy the client assets into it, so after every build sync them before restarting, or the HTML loads but every `/_next/static/*` request is a 404 and the page shows "This page couldn't load":
  ```bash
  rm -rf .next/standalone/.next/static .next/standalone/public
  cp -a .next/static .next/standalone/.next/static
  cp -a public .next/standalone/public
  pm2 restart kelaska
  ```
  `install.sh --with-pm2` performs the same sync automatically.

## Code Review Rules

### Severity

- P1 is only for problems that produce wrong behavior at runtime: user-visible breakage, data loss, data exposed across owners, an authentication or access-control bypass, a storage migration that fails on an existing database, a published package that ships broken, or a leaked secret.
- Inaccuracies that only affect documentation, comments, skill text or the PR description are at most P2. Do not report wording that cannot cause a failure or a wrong action.
- Do not report pure style, naming or readability preferences.

### Context and scope

- Read the PR description before reviewing. Do not raise an issue the description already accounts for (handled in another PR or issue, or a deliberate trade-off with its reason) unless you can show that explanation is wrong.
- Do not raise again an issue whose thread already has a reply explaining why it stays.
- When reviewing new commits, report only problems introduced or exposed by the new or changed code. Do not add edge cases on code the push did not touch.
- Do not report pre-existing behavior that the PR does not change.
- When a fix needs changes outside the PR (callers, documentation, other packages), name the file paths.

### Focus areas

- Owner scoping: reads and writes of courses, sessions, materials and settings stay within the requesting owner.
- Storage schema changes (`packages/@openmaic/storage`): compatible with databases that are already deployed.
- Published packages (`packages/@openmaic/*`): a change to published behavior comes with the version bump described in [Changing a Published Package](CONTRIBUTING.md#changing-a-published-package).
- Provider neutrality: shared layers do not hard-code a specific model or service vendor; vendor-specific behavior stays in that provider's module.
- Server-side requests to user-supplied URLs go through the existing URL guard.
