<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent Guidance

Guidance for coding agents working in this repository, including the automated Codex review that runs on every non-draft pull request. The contribution workflow is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Working Agreement

- Update this file (`AGENTS.md`) as part of every change. Record the durable build, test, deployment, or debugging lesson the work produced, in the relevant section below. Keep it short and actionable; do not duplicate code or CONTRIBUTING.md.
- After all work for a task is finished and verified, commit the changes and push them to `origin` on the current branch (Conventional Commit message), then report the branch, commit hash, and push result. Never leave finished work uncommitted; if the push is rejected or credentials are unavailable, say so explicitly instead of silently skipping it.

## Build and Test Resources

- Maximize the RAM a memory-heavy Node task may use instead of leaving Node's default heap. The Next.js production build type-checks a large module graph and can exceed the default ~2 GB limit, failing with `FATAL ERROR: Reached heap limit`.
- Check `free -h` first, then set `NODE_OPTIONS` below the available RAM so the OS keeps headroom. On the 12 GB Colab host, use:
  ```bash
  NODE_OPTIONS="--max-old-space-size=8192" bun run build
  ```
- Use the same setting for other heavy runs (large test suites, type checks). Do not run several memory-heavy tasks at once.
- `install.sh` sizes the build heap as `min(8192, RAM - 2048)` MB, so a 12 GB Colab host gets the 8192 MB above instead of the old 3072 MB cap. On Colab's 2 vCPU the Turbopack production build dominates a cold `--colab` run (~10-15 min) and Bun cannot speed it up; the installer's wins are building workspace packages two at a time and running model discovery alongside the build. Use `--dev --colab` for a fast server without the production build.
- Bun is downloaded from the npm registry (`@oven/bun-linux-<arch>`, override with `BUN_NPM_REGISTRY`) before the official `bun.sh` installer. The official installer fetches from GitHub Releases, which intermittently answers `504` on Colab and used to abort `--colab` at `bun: instalasi`; both paths now go through `unduh_retry`. To test the Bun step without a full install, extract `unduh_retry`/`pasang_bun_npm` into a scratch script with a temporary `BUN_INSTALL_PREFIX`.
- Antigravity is the local `agy` CLI (`lib/ai/antigravity-cli.ts`, transport api `antigravity-sdk`), never a Python bridge. The installer installs `agy` and refreshes `ANTIGRAVITY_MODELS` from `agy models` (login-aware, like the Codex/OpenCode discovery); there is no `.venv-antigravity` and no `google-antigravity` pip package anywhere.
- All workbench auth UI copy lives in `workspace.auth.*` and `workspace.modelPicker.*` in `lib/i18n/locales/<locale>.json` (13 locales, kept in sync by the i18n script); never hardcode Indonesian/English strings in the panels.
- Model-selector tests must pin `OPENCODE_ACTIVE_MODEL_FILE` to a scratch path: a local `data/agent-driver-model.json` would otherwise leak into every resolution path and fail unrelated suites.
- This app deploys `.next/standalone` through PM2. `next build` does not copy the client assets into it, so after every build sync them before restarting, or the HTML loads but every `/_next/static/*` request is a 404 and the page shows "This page couldn't load":
  ```bash
  rm -rf .next/standalone/.next/static .next/standalone/public
  cp -a .next/static .next/standalone/.next/static
  cp -a public .next/standalone/public
  pm2 restart kelaska
  ```
  `install.sh --with-pm2` performs the same sync automatically.

## Workspace UI

- The agent login entry (OpenCode Console / Antigravity / Codex) lives in the Pro Workbench model picker's footer action, not in the chat header. `WorkbenchAuthDialog` is controlled (`open`/`onOpenChange`/`onStatusChange`) and mounted by `WorkbenchModelPicker`; classic `components/settings/model-picker.tsx` renders the same popover without it via the optional `footerAction` prop.
- The model popover caps its whole content at `--radix-popover-content-available-height` (flex column, list `min-h-0 max-h-[320px] overflow-y-auto`), not just the list. The search row and footer action are fixed height, so a list-only cap still overflows the viewport and clips the search field when the trigger sits near an edge.
- The picker shows only models the signed-in account can actually use: live `opencode models` (login-aware; `OPENCODE_MODELS`/`OPENCODE_GO_MODELS` act as an optional operator allowlist intersected with the live list), Codex `model/list` gated on `codex login status`, and `agy models` (Antigravity also gated on `antigravityCliAuthStatus().authenticated`; a stale cache must never survive a logout). Empty or failed discovery means an empty group — never fall back to the static catalog in the dynamic path. `isActivatedDriverModel` trusts live discovery once `activatedDriverModelsDynamic()` has run.
- Per-conversation driver models: `agent_sessions.driver_model` (migration v4, `@openmaic/storage` >= 0.39.4) carries `{model, api?, thinking?}`. The chat-header picker writes it via `POST /api/agent/models {sessionId}` and reads it via `GET /api/agent/models?sessionId=`, so old conversations never switch models when a new one is created; the home picker still writes the global default (`data/agent-driver-model.json`) that seeds new conversations. The runner resolves slot → session override (validated against live discovery) → global default.

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
