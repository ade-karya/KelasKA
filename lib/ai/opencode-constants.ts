/**
 * Client-safe OpenCode constants.
 *
 * Split out from `lib/ai/opencode-cli.ts` so client-bundled code
 * (`lib/ai/opencode-model.ts` -> `lib/ai/providers.ts` -> `lib/store/settings.ts`
 * -> settings UI) can reference the provider id and timeout without pulling
 * `node:child_process` / `node:fs` into the browser bundle. This module must
 * stay free of Node builtins.
 */

/** Provider id shared with the `PROVIDERS` catalog entry and `x-model` strings. */
export const OPENCODE_PROVIDER_ID = 'opencode' as const;

/**
 * Default wall-clock budget per CLI invocation. Mirrors `LLM_FETCH_TIMEOUT_MS`
 * in `lib/ai/providers.ts` (kept as a literal here so the CLI transport stays
 * importable without pulling the whole provider registry).
 */
export const OPENCODE_CLI_TIMEOUT_MS = 15 * 60 * 1000;
