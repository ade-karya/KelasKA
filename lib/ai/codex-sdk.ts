/**
 * Native `@openai/codex-sdk` bridge for the OpenMAIC Pro Workbench agent driver.
 *
 * Reference: https://learn.chatgpt.com/docs/codex-sdk
 *
 * The SDK is the *typed* client of the local Codex agent (JSON-RPC over the
 * `codex exec` process the SDK spawns itself). OpenMAIC uses it as a model
 * transport only: the pi harness in `lib/agent/runtime/codex-stream-fn.ts` asks
 * for one turn, gets back the assistant text + tool calls, and keeps owning the
 * loop (tools, allowlist, timeouts, transcript, usage). Codex's own tools stay
 * out of the path: the thread is pinned to a read-only sandbox, no approvals,
 * no network and no web search, so a turn can only produce text.
 *
 * Server-side only. This module deliberately imports the SDK *lazily* (type
 * imports are erased) so a client bundle that reaches it — directly or through
 * a registry module — never pulls `node:child_process` in. Only server code
 * (the agent runtime and its driver) imports the functions here; the registry
 * imports types alone.
 */

import type {
  CodexOptions,
  ModelReasoningEffort,
  RunResult,
  SandboxMode,
  ThreadEvent,
  ThreadOptions,
  Usage,
} from '@openai/codex-sdk';

// The SDK declares `Turn` but does not export it; `RunResult` is the exported
// alias of the same completed-turn shape.
export type {
  CodexOptions,
  ModelReasoningEffort,
  RunResult,
  SandboxMode,
  ThreadEvent,
  ThreadOptions,
  Usage,
};
export type Turn = RunResult;

/** Route `api` value that selects the Codex SDK transport. */
export const CODEX_SDK_DRIVER_API = 'codex-sdk' as const;

/**
 * Model a codex provider reference uses when the config names none. The id is
 * passed straight to `codex exec --model`; the operator can point the provider
 * at any model its Codex login can reach (`CODEX_MODELS` / openmaic.yml).
 */
export const CODEX_SDK_DEFAULT_MODEL = 'gpt-5.6-codex';

/** Per-turn ceiling: the same budget as the keyed HTTP transport (15 minutes). */
export const CODEX_SDK_DEFAULT_TIMEOUT_MS = 900_000;

/** Minimal structural view of the SDK client, so the transport is injectable in tests. */
export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread?(id: string, options?: ThreadOptions): CodexThreadLike;
}

export interface CodexThreadLike {
  runStreamed(
    input: string,
    options?: { outputSchema?: unknown; signal?: AbortSignal },
  ): Promise<{ events: AsyncIterable<ThreadEvent> }>;
}

export interface CodexSdkSettings {
  /** `codex exec --model`; omitted means the CLI's configured default. */
  model?: string;
  /** API key handed to the CLI (ChatGPT login sessions need none). */
  apiKey?: string;
  /** OpenAI-compatible base URL (`openai_base_url`). */
  baseUrl?: string;
  /** Explicit `codex` binary, when the SDK's bundled platform package is absent. */
  codexPathOverride?: string;
  /** Defaults to `read-only`: a transport turn must not touch the filesystem. */
  sandboxMode?: SandboxMode;
  /** Defaults to a dedicated empty temp directory. */
  workingDirectory?: string;
  /** Turn ceiling; defaults to {@link CODEX_SDK_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** `model_reasoning_effort` for the turn (pi thinking config, mapped). */
  reasoningEffort?: ModelReasoningEffort;
  /** Extra `--config key=value` overrides. */
  config?: CodexOptions['config'];
}

type CodexSdkModule = typeof import('@openai/codex-sdk');

let sdkModule: Promise<CodexSdkModule> | null = null;

/** Load the SDK once; never at module scope (see the header comment). */
function loadCodexSdk(): Promise<CodexSdkModule> {
  sdkModule ??= import('@openai/codex-sdk');
  return sdkModule;
}

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readNumberEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Deployment settings for the Codex transport, from the environment.
 *
 * - `CODEX_API_KEY` / `OPENAI_API_KEY` — key auth; without either the CLI's
 *   own `codex login` session (CODEX_HOME / `~/.codex/auth.json`) is used.
 * - `CODEX_BASE_URL` — OpenAI-compatible endpoint.
 * - `CODEX_PATH` — explicit binary, for hosts where the SDK's bundled platform
 *   package was pruned (`codexPathOverride`).
 * - `CODEX_MODEL` / `OPENMAIC_CODEX_MODEL` — default model for the provider.
 * - `OPENMAIC_CODEX_WORKDIR` — sandbox cwd (default: empty temp dir).
 * - `OPENMAIC_CODEX_SANDBOX` — `read-only` (default), `workspace-write` or
 *   `danger-full-access`. Anything but `read-only` is an operator decision to
 *   let the transport's agent touch the host; the transport itself never
 *   forwards its tool calls, so this only widens what a stray turn may do.
 * - `OPENMAIC_CODEX_TIMEOUT_MS` — per-turn ceiling.
 */
export function codexSdkSettingsFromEnv(overrides: CodexSdkSettings = {}): CodexSdkSettings {
  const sandbox = readEnv('OPENMAIC_CODEX_SANDBOX');
  const settings: CodexSdkSettings = {
    model: overrides.model ?? readEnv('OPENMAIC_CODEX_MODEL', 'CODEX_MODEL'),
    apiKey: overrides.apiKey ?? readEnv('CODEX_API_KEY', 'OPENAI_API_KEY'),
    baseUrl: overrides.baseUrl ?? readEnv('CODEX_BASE_URL'),
    codexPathOverride: overrides.codexPathOverride ?? readEnv('CODEX_PATH'),
    sandboxMode:
      overrides.sandboxMode ??
      (sandbox === 'workspace-write' || sandbox === 'danger-full-access' ? sandbox : 'read-only'),
    workingDirectory: overrides.workingDirectory ?? readEnv('OPENMAIC_CODEX_WORKDIR'),
    timeoutMs: overrides.timeoutMs ?? readNumberEnv('OPENMAIC_CODEX_TIMEOUT_MS'),
  };
  if (overrides.reasoningEffort) settings.reasoningEffort = overrides.reasoningEffort;
  if (overrides.config) settings.config = overrides.config;
  return settings;
}

/** Thread options for a transport turn: no tools, no network, no prompts. */
export function codexThreadOptions(settings: CodexSdkSettings): ThreadOptions {
  const options: ThreadOptions = {
    sandboxMode: settings.sandboxMode ?? 'read-only',
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
  };
  if (settings.model) options.model = settings.model;
  if (settings.workingDirectory) options.workingDirectory = settings.workingDirectory;
  if (settings.reasoningEffort) options.modelReasoningEffort = settings.reasoningEffort;
  return options;
}

function codexOptions(settings: CodexSdkSettings): CodexOptions {
  const options: CodexOptions = {};
  if (settings.apiKey) options.apiKey = settings.apiKey;
  if (settings.baseUrl) options.baseUrl = settings.baseUrl;
  if (settings.codexPathOverride) options.codexPathOverride = settings.codexPathOverride;
  if (settings.config) options.config = settings.config;
  return options;
}

/**
 * Create the SDK client. Throws when the platform binary is missing or the SDK
 * cannot be loaded; callers turn that into an actionable message with
 * {@link describeCodexSdkError}.
 */
export async function createCodexClient(
  settings: CodexSdkSettings = codexSdkSettingsFromEnv(),
): Promise<CodexClientLike> {
  const { Codex } = await loadCodexSdk();
  return new Codex(codexOptions(settings));
}

/** Whether a turn can even start: the SDK loads and the Codex binary resolves. */
export async function codexSdkAvailability(
  settings: CodexSdkSettings = codexSdkSettingsFromEnv(),
): Promise<{ available: true } | { available: false; reason: string }> {
  try {
    await createCodexClient(settings);
    return { available: true };
  } catch (error) {
    return { available: false, reason: describeCodexSdkError(error) };
  }
}

/**
 * Turn a transport failure into something an operator can act on. Everything
 * else keeps the SDK's own message (it carries the CLI's stderr tail, which is
 * the only place the real cause — auth, quota, unknown model — shows up).
 */
export function describeCodexSdkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const detail = message.trim() || 'Codex turn failed';
  if (
    /Unable to locate Codex CLI binaries|Cannot find (?:module|package) '@openai\/codex/i.test(
      detail,
    )
  ) {
    return (
      'Codex CLI is not installed for this platform. Install @openai/codex with its optional ' +
      'platform package (the @openai/codex-sdk dependency) or point CODEX_PATH at a codex binary.'
    );
  }
  if (
    /not logged in|unauthori[sz]ed|401|invalid api key|missing (?:api|openai) key/i.test(detail)
  ) {
    return (
      `Codex is not authenticated: ${detail}. Run \`codex login\` on the server or set CODEX_API_KEY ` +
      '(an OpenAI API key) for this deployment.'
    );
  }
  return detail;
}

/**
 * Run a single prompt through a fresh Codex thread and return the completed
 * turn (including `finalResponse` and `usage`).
 */
export async function runCodexPrompt(
  prompt: string,
  options: {
    settings?: CodexSdkSettings;
    outputSchema?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<Turn> {
  const settings = options.settings ?? codexSdkSettingsFromEnv();
  const codex = await createCodexClient(settings);
  const thread = codex.startThread(codexThreadOptions(settings));
  const { events } = await thread.runStreamed(prompt, {
    ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return collectCodexTurn(events);
}

/** Fold a Codex event stream into the completed turn shape. */
export async function collectCodexTurn(events: AsyncIterable<ThreadEvent>): Promise<Turn> {
  const items: Turn['items'] = [];
  let finalResponse = '';
  let usage: Usage | null = null;
  let failure: string | null = null;
  for await (const event of events) {
    if (event.type === 'item.completed') {
      if (event.item.type === 'agent_message') finalResponse = event.item.text;
      items.push(event.item);
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
    } else if (event.type === 'turn.failed') {
      failure = event.error.message;
      break;
    } else if (event.type === 'error') {
      failure = event.message;
      break;
    }
  }
  if (failure) throw new Error(describeCodexSdkError(failure));
  return { items, finalResponse, usage };
}

/**
 * Resume an existing Codex thread by id and run a follow-up prompt.
 *
 * The agent transport does not use this: OpenMAIC replays the full pi history
 * into a fresh thread each turn so a recovered session never depends on the
 * host's `~/.codex/sessions` state. Kept for callers that do own a thread id.
 */
export async function resumeCodexThread(
  threadId: string,
  prompt: string,
  options: {
    settings?: CodexSdkSettings;
    outputSchema?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<Turn> {
  const settings = options.settings ?? codexSdkSettingsFromEnv();
  const codex = await createCodexClient(settings);
  const thread = codex.resumeThread
    ? codex.resumeThread(threadId, codexThreadOptions(settings))
    : codex.startThread(codexThreadOptions(settings));
  const { events } = await thread.runStreamed(prompt, {
    ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return collectCodexTurn(events);
}
