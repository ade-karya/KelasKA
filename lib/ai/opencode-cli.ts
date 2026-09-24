/**
 * OpenCode CLI transport (server-only).
 *
 * OpenCode's free tier (`opencode/*` models on the Zen gateway) can only be
 * used *from within* the OpenCode client — direct HTTPS calls to
 * `https://opencode.ai/zen/v1` with the public key are rejected with
 * `FreeTierError`. The supported way to consume those models from OpenMAIC is
 * therefore the locally installed `opencode` binary, which carries the
 * client's own attestation:
 *
 *   opencode run --format json -m opencode/<model> [--title openmaic-llm] <prompt>
 *
 * This module owns everything that touches the binary: discovery, prompt
 * rendering, process management, and parsing the `--format json` JSONL event
 * stream (`step_start` / `text` / `step_finish` / ...). Node builtins are
 * resolved lazily via `process.getBuiltinModule` (see `nodeBuiltins()` below)
 * so the module stays statically free of `node:*` imports and can be bundled
 * for the browser without pulling `node:child_process` into client chunks —
 * the transport functions themselves only ever run on the Node server.
 */

import type { ChildProcess } from 'node:child_process';

/**
 * Node builtins, resolved lazily through `process.getBuiltinModule` instead of
 * static `node:*` imports.
 *
 * This module is (transitively) imported from client-bundled code
 * (`opencode-model.ts` -> `providers.ts` -> settings UI). A static
 * `node:child_process` import makes Turbopack fail the whole client build
 * ("does not support external modules"), while a `webpackIgnore` dynamic
 * `import('./opencode-cli')` does not resolve at dev-server runtime. Looking
 * the builtins up behind a global call keeps the module bundlable everywhere
 * and fully functional wherever it actually runs (Node server only — these
 * helpers throw when invoked without Node).
 */
interface OpencodeNodeBuiltins {
  spawn: typeof import('node:child_process').spawn;
  existsSync: typeof import('node:fs').existsSync;
  mkdirSync: typeof import('node:fs').mkdirSync;
  writeFileSync: typeof import('node:fs').writeFileSync;
  rmSync: typeof import('node:fs').rmSync;
  randomUUID: typeof import('node:crypto').randomUUID;
  tmpdir: typeof import('node:os').tmpdir;
  delimiter: string;
  join: (...parts: string[]) => string;
}

let cachedNodeBuiltins: OpencodeNodeBuiltins | undefined;

function nodeBuiltins(): OpencodeNodeBuiltins {
  cachedNodeBuiltins ??= loadNodeBuiltins();
  return cachedNodeBuiltins;
}

function loadNodeBuiltins(): OpencodeNodeBuiltins {
  const getBuiltinModule = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
    .getBuiltinModule;
  if (typeof getBuiltinModule !== 'function') {
    throw new Error(
      'opencode CLI transport requires Node.js (process.getBuiltinModule is unavailable).',
    );
  }
  const childProcess = getBuiltinModule(
    'node:child_process',
  ) as typeof import('node:child_process');
  const fs = getBuiltinModule('node:fs') as typeof import('node:fs');
  const os = getBuiltinModule('node:os') as typeof import('node:os');
  const crypto = getBuiltinModule('node:crypto') as typeof import('node:crypto');
  const path = getBuiltinModule('node:path') as typeof import('node:path');
  return {
    spawn: childProcess.spawn.bind(childProcess),
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    rmSync: fs.rmSync,
    randomUUID: crypto.randomUUID,
    tmpdir: os.tmpdir,
    delimiter: path.delimiter,
    join: path.join,
  };
}
import { OPENCODE_CLI_TIMEOUT_MS, OPENCODE_PROVIDER_ID } from './opencode-constants';

// Re-exported so server-side consumers have a single import site; the
// canonical definitions live in `./opencode-constants` (client-safe).
export { OPENCODE_CLI_TIMEOUT_MS, OPENCODE_PROVIDER_ID };

/** CLI model reference prefix, e.g. `opencode/muse-spark-1.3-contributor-free`. */
export const OPENCODE_MODEL_PREFIX = 'opencode/' as const;

/** Session title so opencode-side sessions are attributable to OpenMAIC. */
export const OPENCODE_SESSION_TITLE = 'openmaic-llm';

/** Upper bound for a single captured stdout stream (32 MiB). */
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;

export interface OpencodeUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type OpencodeFinishReason = 'stop' | 'length' | 'error' | 'other';

/**
 * One tool call the CLI's own agent loop made during a run.
 *
 * These calls are executed INSIDE the CLI (its built-ins, or the tools of any
 * MCP server wired through {@link OpencodeMcpServer}); they are reported here
 * so a caller can render them — the model never returns tool calls to us.
 */
export interface OpencodeToolCall {
  /** CLI call id, when reported. */
  id?: string;
  name: string;
  input?: unknown;
  /** The tool's result text, once the call completed. */
  output?: string;
  status: 'running' | 'completed' | 'error';
}

export interface OpencodeCompletion {
  text: string;
  reasoning: string;
  usage: OpencodeUsage;
  finishReason: OpencodeFinishReason;
  errorMessage?: string;
  /** Every tool call the CLI made, in completion order. */
  toolCalls?: OpencodeToolCall[];
}

const EMPTY_USAGE: OpencodeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Resolve the `opencode` binary. Precedence: explicit path >
 * `OPENCODE_CLI_PATH` env > directories on `PATH` > `~/.opencode/bin/opencode`
 * (the documented install location of `opencode upgrade`). Returns undefined
 * when no executable candidate is found.
 */
export function resolveOpencodeCliPath(explicitPath?: string): string | undefined {
  const { existsSync, delimiter, join } = nodeBuiltins();
  const candidates: string[] = [];
  if (explicitPath?.trim()) candidates.push(explicitPath.trim());
  const envPath = process.env.OPENCODE_CLI_PATH?.trim();
  if (envPath) candidates.push(envPath);
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of pathDirs) candidates.push(join(dir, 'opencode'));
  // `process.env.HOME` (not os.homedir(), which can ignore it) so containers
  // and tests can relocate the default install dir.
  const home = process.env.HOME;
  if (home) candidates.push(join(home, '.opencode', 'bin', 'opencode'));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* Unreadable candidate — keep scanning. */
    }
  }
  return undefined;
}

/** Whether an `opencode` binary is available to this process. */
export function isOpencodeCliAvailable(explicitPath?: string): boolean {
  return resolveOpencodeCliPath(explicitPath) !== undefined;
}

/** `opencode/<modelId>` reference as expected by `opencode run -m`. */
export function toOpencodeModelRef(modelId: string): string {
  const bare = modelId.includes('/') ? (modelId.split('/').pop() ?? modelId) : modelId;
  return `${OPENCODE_MODEL_PREFIX}${bare}`;
}

/** Wall-clock budget for the one-shot `opencode models` listing. */
export const OPENCODE_MODELS_TIMEOUT_MS = 30_000;

/**
 * Parse `opencode models` stdout: one `provider/model` reference per line, in
 * the CLI's own order, deduped. Blank lines, log noise and anything without a
 * `/` separator are ignored. Exported for unit tests.
 */
export function parseOpencodeModelsOutput(stdout: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split('\n')) {
    // Some builds colourise even when piped; strip ANSI escapes defensively.
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!line || !line.includes('/') || /\s/.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    refs.push(line);
  }
  return refs;
}

export interface ListOpencodeModelsOptions {
  /** Explicit binary path (precedence over `OPENCODE_CLI_PATH` and `PATH`). */
  cliPath?: string;
  /** Wall-clock budget. Defaults to {@link OPENCODE_MODELS_TIMEOUT_MS}. */
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

/**
 * List the model references the local CLI exposes (`opencode models`). Used by
 * the settings "Fetch Models" button for the keyless opencode provider, which
 * has no HTTP endpoint to probe.
 */
export function listOpencodeModels(opts: ListOpencodeModelsOptions = {}): Promise<string[]> {
  const cliPath = opts.cliPath?.trim() || resolveOpencodeCliPath();
  if (!cliPath) {
    return Promise.reject(
      new Error(
        'No `opencode` binary was found. Install it (see https://opencode.ai) or set OPENCODE_CLI_PATH to its location.',
      ),
    );
  }
  const timeoutMs = opts.timeoutMs ?? OPENCODE_MODELS_TIMEOUT_MS;
  return new Promise<string[]>((resolve, reject) => {
    if (opts.abortSignal?.aborted) {
      reject(abortError(opts.abortSignal));
      return;
    }
    let child: ChildProcess;
    try {
      child = nodeBuiltins().spawn(cliPath, ['models'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let settled = false;
    let stdout = '';
    let stderrTail = '';
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.abortSignal?.removeEventListener('abort', onAbort);
      killChild(child);
      fn();
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error(`opencode models timed out after ${timeoutMs} ms`))),
      timeoutMs,
    );
    if (typeof timer.unref === 'function') timer.unref();
    const onAbort = () => settle(() => reject(abortError(opts.abortSignal)));

    opts.abortSignal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.on('error', (err) => settle(() => reject(err)));
    child.on('close', (code) => {
      if (code === 0) {
        settle(() => resolve(parseOpencodeModelsOutput(stdout)));
      } else {
        settle(() =>
          reject(
            new Error(
              `opencode models exited with code ${code ?? 'unknown'}${
                stderrTail ? `: ${stderrTail}` : ''
              }`,
            ),
          ),
        );
      }
    });
  });
}

export function buildOpencodeRunArgs(
  modelId: string,
  prompt: string,
  options: {
    /**
     * Run with a private server instead of the shared background service.
     *
     * Required for per-run MCP config: MCP servers are loaded by the *server*,
     * so a private `OPENCODE_CONFIG_DIR` is only read when the CLI starts its
     * own server. Without this, a run would silently use the background
     * service's config and see none of the injected tools.
     */
    standalone?: boolean;
  } = {},
): string[] {
  return [
    'run',
    ...(options.standalone ? ['--standalone'] : []),
    '--format',
    'json',
    // The CLI reports the real cause of a failed run (rate limit, provider
    // error, interrupted session) on its own log stream, not in the JSON
    // stdout events. Without this flag a failed run surfaces as a bare
    // "exited with code 1" with an empty stderr.
    '--print-logs',
    '--model',
    toOpencodeModelRef(modelId),
    '--title',
    OPENCODE_SESSION_TITLE,
    prompt,
  ];
}

/**
 * Fold one parsed `--format json` event line into the accumulator. Exported
 * for unit tests; the streaming runner calls it incrementally and
 * `parseOpencodeJsonOutput` calls it over a complete buffer.
 *
 * Observed event shapes (`opencode run --format json`):
 * - `{type:'text', part:{type:'text', text}}` — answer delta
 * - `{type:'reasoning'|'thinking', part:{text}}` — thinking delta (with --thinking)
 * - `{type:'tool_use', part:{id, tool, state:{status, input, output}}}` — a tool
 *   call the CLI's own agent loop made (built-in or MCP)
 * - `{type:'step_finish', part:{reason, tokens:{input,output,reasoning,cache:{read,write}}}}`
 * - `{type:'error', ...}` / `{type:'step_error'|'message_error', ...}` — failure
 */
export interface OpencodeAccumulator {
  text: string;
  reasoning: string;
  usage: OpencodeUsage;
  finishReason: OpencodeFinishReason;
  errorMessage?: string;
  toolCalls: OpencodeToolCall[];
}

export function createOpencodeAccumulator(): OpencodeAccumulator {
  return {
    text: '',
    reasoning: '',
    usage: { ...EMPTY_USAGE },
    finishReason: 'stop',
    toolCalls: [],
  };
}

/** A CLI `tool_use` part folded into a {@link OpencodeToolCall}, or undefined. */
function toolCallOf(part: Record<string, unknown> | undefined): OpencodeToolCall | undefined {
  const name = typeof part?.tool === 'string' ? part.tool : '';
  if (!name) return undefined;
  const state =
    part?.state && typeof part.state === 'object'
      ? (part.state as Record<string, unknown>)
      : undefined;
  const status =
    state?.status === 'completed' || state?.status === 'error' || state?.status === 'running'
      ? state.status
      : 'completed';
  return {
    ...(typeof part?.id === 'string' ? { id: part.id } : {}),
    name,
    ...(state && 'input' in state ? { input: state.input } : {}),
    ...(typeof state?.output === 'string' ? { output: state.output } : {}),
    status,
  };
}

/** Upsert a tool call by id (the CLI emits one event per call, later states win). */
function recordToolCall(acc: OpencodeAccumulator, call: OpencodeToolCall): void {
  if (call.id) {
    const existing = acc.toolCalls.findIndex((entry) => entry.id === call.id);
    if (existing >= 0) {
      acc.toolCalls[existing] = call;
      return;
    }
  }
  acc.toolCalls.push(call);
}

export function foldOpencodeJsonEvent(
  acc: OpencodeAccumulator,
  event: unknown,
): { textDelta: string; reasoningDelta: string; tool?: OpencodeToolCall } {
  if (!event || typeof event !== 'object') return { textDelta: '', reasoningDelta: '' };
  const record = event as Record<string, unknown>;
  const type = record.type;
  const part =
    record.part && typeof record.part === 'object'
      ? (record.part as Record<string, unknown>)
      : undefined;

  if (type === 'text') {
    const delta = typeof part?.text === 'string' ? part.text : '';
    if (delta) acc.text += delta;
    return { textDelta: delta, reasoningDelta: '' };
  }
  if (type === 'tool_use') {
    const call = toolCallOf(part);
    if (!call) return { textDelta: '', reasoningDelta: '' };
    recordToolCall(acc, call);
    return { textDelta: '', reasoningDelta: '', tool: call };
  }
  if (type === 'reasoning' || type === 'thinking') {
    const delta =
      typeof part?.text === 'string'
        ? part.text
        : typeof record.text === 'string'
          ? record.text
          : typeof record.delta === 'string'
            ? record.delta
            : '';
    if (delta) acc.reasoning += delta;
    return { textDelta: '', reasoningDelta: delta };
  }
  if (type === 'step_finish') {
    const reason = part?.reason;
    const tokens =
      part?.tokens && typeof part.tokens === 'object'
        ? (part.tokens as Record<string, unknown>)
        : undefined;
    const cache =
      tokens?.cache && typeof tokens.cache === 'object'
        ? (tokens.cache as Record<string, unknown>)
        : undefined;
    const input = num(tokens?.input);
    const output = num(tokens?.output);
    const reasoning = num(tokens?.reasoning);
    acc.usage = {
      inputTokens: input,
      outputTokens: output,
      reasoningTokens: reasoning,
      cacheReadTokens: num(cache?.read),
      cacheWriteTokens: num(cache?.write),
    };
    if (reason === 'stop') acc.finishReason = 'stop';
    else if (reason === 'length') acc.finishReason = 'length';
    else if (reason === 'error') acc.finishReason = 'error';
    else if (reason === 'tool-calls') {
      // The CLI ran its own internal tool loop (file reads, shell, ...) and
      // stopped with answer text. Those calls are invisible to OpenMAIC's pi
      // loop (this transport drops caller tools and never emits tool calls),
      // so accumulated text IS the turn's completed answer. With no text the
      // run produced nothing usable — keep 'other' so the caller fails loud
      // instead of settling an empty turn as a success.
      acc.finishReason = acc.text ? 'stop' : 'other';
    } else if (typeof reason === 'string' && reason) {
      // Forward-compatible: a step_finish ends the CLI's run, so text produced
      // before it is a completed answer whatever the new reason string says.
      // Warn so the new reason gets a deliberate mapping instead of hiding here.
      if (acc.text) {
        console.warn(
          `[opencode-cli] Unknown step_finish reason ${JSON.stringify(reason)} with answer text; treating the turn as completed.`,
        );
        acc.finishReason = 'stop';
      } else {
        acc.finishReason = 'other';
      }
    }
    return { textDelta: '', reasoningDelta: '' };
  }
  if (type === 'error' || type === 'step_error' || type === 'message_error') {
    acc.finishReason = 'error';
    acc.errorMessage = errorEventMessage(record) ?? 'opencode CLI reported an error';
    return { textDelta: '', reasoningDelta: '' };
  }
  return { textDelta: '', reasoningDelta: '' };
}

/**
 * A human-readable message from a CLI error event, tolerating the shapes the
 * `--format json` protocol actually emits. Some failures carry no `message`
 * string at all (e.g. `{type:'error', error: {...}}`), in which case the
 * nested object is stringified rather than falling back to a generic line
 * that hides the cause.
 */
function errorEventMessage(record: Record<string, unknown>): string | undefined {
  const part =
    record.part && typeof record.part === 'object'
      ? (record.part as Record<string, unknown>)
      : undefined;
  const candidates: unknown[] = [
    part?.message,
    record.message,
    record.error,
    part?.error,
    record.data,
    part?.data,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = (candidate as Record<string, unknown>).message;
      if (typeof nested === 'string' && nested.trim()) return nested;
      try {
        const raw = JSON.stringify(candidate);
        if (raw && raw !== '{}' && raw !== '[]') return raw;
      } catch {
        /* unstringifiable — try the next candidate */
      }
    }
  }
  return undefined;
}
/**
 * The CLI-reported failure inside a `--format json` stdout buffer, if any.
 *
 * A failing `opencode run` often reports the real cause (rate limit, model
 * error, interrupted session) as a JSON `error`/`step_error` event on stdout
 * while leaving stderr empty — so an exit-code-only error ("exited with code
 * 1") hides the one line that explains it. Exported for unit tests.
 */
export function extractOpencodeStdoutError(stdout: string, maxLength = 500): string | undefined {
  let found: string | undefined;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const type = (event as Record<string, unknown>).type;
    if (type !== 'error' && type !== 'step_error' && type !== 'message_error') continue;
    const message = errorEventMessage(event as Record<string, unknown>);
    if (message) found = message;
  }
  if (!found) return undefined;
  return found.length > maxLength ? `${found.slice(0, maxLength)}…` : found;
}

/** Parse a complete `--format json` stdout buffer into a completion. */
export function parseOpencodeJsonOutput(stdout: string): OpencodeCompletion {
  const acc = createOpencodeAccumulator();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      foldOpencodeJsonEvent(acc, JSON.parse(trimmed) as unknown);
    } catch {
      /* Non-JSON line (log noise) — ignore. */
    }
  }
  return {
    text: acc.text,
    reasoning: acc.reasoning,
    usage: acc.usage,
    finishReason: acc.finishReason,
    ...(acc.toolCalls.length ? { toolCalls: acc.toolCalls } : {}),
    ...(acc.errorMessage ? { errorMessage: acc.errorMessage } : {}),
  };
}

export interface RunOpencodeOptions {
  cliPath: string;
  modelId: string;
  prompt: string;
  /** Working directory for the child (defaults to the server cwd). */
  cwd?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  /**
   * Total attempts for a transient CLI failure (default 3). The free tier
   * rate-limits and occasionally exits non-zero for no durable reason; a
   * single attempt would surface that as a failed agent run.
   */
  maxAttempts?: number;
  /** Base backoff between attempts, doubling each retry (default 3000 ms). */
  retryBaseDelayMs?: number;
  /**
   * MCP servers to load for this run (see {@link OpencodeMcpServer}). When
   * present, the child gets a private `OPENCODE_CONFIG_DIR`; the operator's own
   * CLI config is never touched.
   */
  mcpServers?: readonly OpencodeMcpServer[];
  /**
   * Disable the CLI's own filesystem/network tools for this run (see
   * {@link lockedToolConfig}). Defaults to true when `mcpServers` are
   * injected: the run's tools are OpenMAIC's MCP tools, and the CLI built-ins
   * would act on the run's working directory or ask via the native `question`
   * tool instead of OpenMAIC's `ask_user`. `read` and `shell` are always left
   * enabled — the gateway rejects free-tier models when either is disabled.
   */
  lockBuiltinTools?: boolean;
}

/**
 * An MCP server the CLI should load for one run, injected through a private
 * config directory (see {@link prepareOpencodeConfigDir}).
 *
 * This is the seam that lets the opencode CLI reach OpenMAIC's own tools: the
 * CLI's agent loop calls them through MCP instead of the caller handing tool
 * definitions to a model (which this transport cannot do — `opencode run`
 * never returns tool calls to its caller).
 */
export interface OpencodeMcpServer {
  /** Namespace the CLI exposes the server's tools under (`tools.<name>.<tool>`). */
  name: string;
  /** Command + arguments for a local (stdio) MCP server. */
  command: string[];
  /** Extra environment for the MCP child process. */
  environment?: Record<string, string>;
  /**
   * Expose the server's tools through Code Mode (the CLI default) or as
   * first-class tools. Only newer CLI builds honour `codemode: false`; on
   * older ones the tools stay reachable through `execute`.
   */
  codemode?: boolean;
}

/**
 * The `opencode.json` body for a private config directory. Exported for tests:
 * the shape is the CLI's contract (`mcp.<name>` = local stdio server), and a
 * wrong key silently produces a run with no tools at all.
 */
export function buildOpencodeConfigJson(
  servers: readonly OpencodeMcpServer[],
  options: { lockBuiltinTools?: boolean } = {},
): Record<string, unknown> {
  const mcp: Record<string, unknown> = {};
  for (const server of servers) {
    mcp[server.name] = {
      type: 'local',
      command: [...server.command],
      ...(server.environment ? { environment: { ...server.environment } } : {}),
      ...(server.codemode === undefined ? {} : { codemode: server.codemode }),
      // `enabled` is the released field name; newer builds read `disabled`.
      // Both are emitted so one config works on either schema revision.
      enabled: true,
      disabled: false,
    };
  }
  return {
    mcp,
    ...(options.lockBuiltinTools ? { tools: lockedToolConfig() } : {}),
  };
}

/**
 * Write a private `opencode.json` and return the directory to point
 * `OPENCODE_CONFIG_DIR` at, plus its cleanup.
 *
 * A private directory is what keeps one run's MCP wiring from leaking into the
 * operator's own `~/.config/opencode/opencode.json` — the CLI reads the global
 * config too, and the app must never mutate it.
 */
export function prepareOpencodeConfigDir(
  servers: readonly OpencodeMcpServer[],
  options: { lockBuiltinTools?: boolean } = {},
): {
  dir: string;
  cleanup: () => void;
} {
  const { mkdirSync, writeFileSync, rmSync, randomUUID, tmpdir, join } = nodeBuiltins();
  const dir = join(tmpdir(), `openmaic-opencode-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'opencode.json'),
    JSON.stringify(buildOpencodeConfigJson(servers, options)),
  );
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort — a leftover temp dir must never fail a run */
      }
    },
  };
}

/**
 * A scratch working directory for one CLI run, so the CLI's git
 * snapshot/watcher machinery never touches the app checkout.
 *
 * The CLI derives its snapshot `--work-tree` and file watchers from the child
 * cwd: runs inheriting the server cwd (`/content/KelasKA` in the field) snapshot
 * the whole repo on every turn and die with `Session interrupted: shutdown`
 * when that watcher state is torn down. A fresh temp dir has no git repo, so
 * the private server starts with no snapshot work at all (verified: watchers
 * point at the scratch dir, exit 0). Best-effort cleanup: a leftover temp dir
 * must never fail a run. Exported so the harness reuses the same dir shape.
 */
export function prepareOpencodeScratchDir(): { dir: string; cleanup: () => void } {
  const { mkdirSync, rmSync, randomUUID, tmpdir, join } = nodeBuiltins();
  const dir = join(tmpdir(), `openmaic-opencode-run-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort — a leftover temp dir must never fail a run */
      }
    },
  };
}

/**
 * The meaningful failure inside a `--print-logs` stderr tail, if any.
 *
 * A `--standalone` run logs its private server to stderr, and inside a git
 * checkout most of that is INFO noise (`spawning process command=git ...`,
 * `watcher subscribe/started ...`). Surfacing the raw tail turns a failure
 * into `exited with code 1: ... "diff-files","--name-only" ...`, which hides
 * the cause. This keeps lines that look like errors and drops snapshot/watcher
 * INFO spam; when nothing meaningful remains it returns undefined so the
 * caller falls back to the stdout-reported error instead of git noise.
 * Exported for unit tests.
 */
export function extractOpencodeStderrError(stderrTail: string, maxLength = 500): string | undefined {
  const lines = stderrTail
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful = lines.filter((line) => {
    if (/spawning process.*command=git/i.test(line)) return false;
    if (/watcher (subscribe|started|stopped)/i.test(line)) return false;
    if (/location services booted/i.test(line)) return false;
    if (/cli starting/i.test(line)) return false;
    return true;
  });
  // Prefer an actual error line; otherwise the last surviving line (e.g. a
  // fatal log) still beats git snapshot spam. Pure-INFO server chatter with no
  // error keyword is treated as noise.
  const errorLine = [...meaningful]
    .reverse()
    .find((line) => /error|fail|interrupt|shut ?down|rate limit|timed out|timeout|ENOENT|EPIPE|ECONNRESET|socket hang up|fetch failed|denied|panic/i.test(line));
  const chosen = errorLine ?? (() => {
    const last = meaningful[meaningful.length - 1];
    if (!last) return undefined;
    if (/\blevel=(INFO|DEBUG|TRACE)\b/i.test(last) && !/level=(WARN|WARNING|ERROR|FATAL)\b/i.test(last)) {
      return undefined;
    }
    return last;
  })();
  if (!chosen) return undefined;
  return chosen.length > maxLength ? `${chosen.slice(0, maxLength)}…` : chosen;
}

/**
 * The child environment for one run, rooted at the run cwd with its private
 * config dir when set.
 *
 * `PWD` must track the run cwd: `opencode run` resolves its session directory
 * from `process.env.PWD ?? process.cwd()` (see `run.ts` in the v2 reference)
 * and chdirs there, so an inherited server `PWD` would drag a scratch-cwd run
 * back into the app checkout — snapshot `--work-tree` and watchers included.
 * `OLDPWD` is dropped for the same reason.
 */
function childEnv(cwd: string, configDir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PWD: cwd };
  delete env.OLDPWD;
  if (configDir) env.OPENCODE_CONFIG_DIR = configDir;
  return env;
}

/**
 * CLI built-ins a CLI-native agent run must not use.
 *
 * The agent's tools are this app's (`tools.openmaic[...]` over MCP); the CLI's
 * own filesystem tools would act on the *run's scratch* working directory — an
 * early agent run wrote a stray file into the repo before scratch isolation —
 * and the native `question` tool would bypass OpenMAIC's `ask_user`.
 * `execute` stays enabled: on this CLI build it is the only way to reach an
 * MCP tool.
 *
 * `read` and `shell` stay enabled even though the prompt steers the model away
 * from them: disabling either makes the Console gateway reject free-tier
 * models with 403 "OpenCode's free tier can only be used from within OpenCode"
 * (bisected per-flag against v2.0.15: `read:false` or `shell:false` alone
 * fails, everything else locked passes). They see only the empty scratch dir.
 */
const DISABLED_CLI_TOOLS = [
  'write',
  'edit',
  'grep',
  'glob',
  'webfetch',
  'websearch',
  'subagent',
  'skill',
  'question',
  'task',
] as const;

/** Tool lockdown for a private config dir; exported for tests. */
export function lockedToolConfig(): Record<string, boolean> {
  return Object.fromEntries(DISABLED_CLI_TOOLS.map((name) => [name, false]));
}

/** Attempts/backoff defaults, exported so tests and callers agree. */
export const OPENCODE_DEFAULT_MAX_ATTEMPTS = 3;
export const OPENCODE_DEFAULT_RETRY_BASE_DELAY_MS = 3_000;

function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | undefined)?.name === 'AbortError';
}

/**
 * Whether a failed CLI attempt is worth retrying.
 *
 * Retryable: a non-zero exit, a CLI-reported error event, and generic
 * transport noise. Not retryable: an abort (the user asked to stop), a
 * timeout (the budget is already spent), or a configuration error (a missing
 * binary cannot fix itself).
 */
export function isRetryableOpencodeError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message) return false;
  if (/no `opencode` binary was found|not found|ENOENT/i.test(message)) return false;
  if (/timed out after/i.test(message)) return false;
  return (
    /exited with code/i.test(message) ||
    /CLI reported/i.test(message) ||
    /rate limit/i.test(message) ||
    /ECONNRESET|EPIPE|socket hang up|fetch failed|network/i.test(message)
  );
}

/**
 * The message a failed CLI run deserves, with the real cause and — when the
 * free tier's rate limit is what happened — the one hint that explains what
 * the operator can do about it.
 */
export function describeOpencodeFailure(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'opencode CLI run failed with no output';
  const rateLimited = /rate limit/i.test(trimmed);
  if (rateLimited) {
    return `${trimmed} — the OpenCode free tier rate-limits per model; wait a moment and retry, or configure a keyed provider (e.g. MODEL_ROUTES openai:... with OPENAI_API_KEY).`;
  }
  if (/interrupt|shut ?down/i.test(trimmed)) {
    return `${trimmed} — the CLI server stopped mid-run (its snapshot/watcher state is tied to the child working directory). Retry; runs use a private --standalone server with a scratch cwd so a shared-service shutdown cannot take the run down.`;
  }
  if (/mcp connect failed|tool list failed/i.test(trimmed)) {
    return `${trimmed} — the CLI could not reach this run's MCP toolset. Check OPENMAIC_MCP_BASE_URL (or PORT) points at the serving app, the deployment includes /api/agent/mcp/[token], and the app did not restart mid-run (the registry is in-process; the route logs the token prefix and live-toolset count).`;
  }
  return trimmed;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(abortError(signal));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  const message =
    typeof reason === 'string' && reason
      ? reason
      : reason instanceof Error && reason.message
        ? reason.message
        : 'Operation aborted';
  return new DOMException(message, 'AbortError') as unknown as Error;
}

function killChild(child: ChildProcess): void {
  try {
    if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
  } catch {
    /* Already exited — nothing to kill. */
  }
}

/**
 * Run one non-interactive `opencode run --format json` completion and return
 * the parsed result. Rejects on non-zero exit, timeout, or abort (killing the
 * child in all three cases). Transient failures (rate limits, non-zero exits)
 * are retried up to `maxAttempts` with exponential backoff.
 */
export async function runOpencodePrompt(opts: RunOpencodeOptions): Promise<OpencodeCompletion> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? OPENCODE_DEFAULT_MAX_ATTEMPTS);
  const baseDelay = opts.retryBaseDelayMs ?? OPENCODE_DEFAULT_RETRY_BASE_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runOpencodePromptOnce(opts);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableOpencodeError(error)) throw error;
      await sleep(baseDelay * 2 ** (attempt - 1), opts.abortSignal);
    }
  }
  throw lastError;
}

function runOpencodePromptOnce(opts: RunOpencodeOptions): Promise<OpencodeCompletion> {
  const timeoutMs = opts.timeoutMs ?? OPENCODE_CLI_TIMEOUT_MS;
  return new Promise<OpencodeCompletion>((resolve, reject) => {
    if (opts.abortSignal?.aborted) {
      reject(abortError(opts.abortSignal));
      return;
    }
    let child: ChildProcess;
    const config = opts.mcpServers?.length
      ? prepareOpencodeConfigDir(opts.mcpServers, {
          lockBuiltinTools: opts.lockBuiltinTools ?? true,
        })
      : undefined;
    // Never run inside the server checkout: the CLI derives its snapshot
    // --work-tree and watchers from the child cwd, and a repo cwd produces
    // exit-1 "Session interrupted: shutdown" runs carrying the checkout path.
    // Callers with an explicit cwd (the harness scratch dir) keep it; every
    // other run gets a private scratch dir cleaned up on settle.
    const scratch = opts.cwd ? undefined : prepareOpencodeScratchDir();
    const cwd = opts.cwd ?? scratch?.dir ?? process.cwd();
    try {
      child = nodeBuiltins().spawn(
        opts.cliPath,
        // Always a private server: the shared background service's shutdown
        // takes down whatever run it hosts, while a per-run server dies with
        // its own child. Verified with and without an MCP config dir.
        buildOpencodeRunArgs(opts.modelId, opts.prompt, { standalone: true }),
        {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          // Never inherit the server's env-derived auth into the child beyond
          // what opencode itself needs; opencode reads its own auth store.
          env: childEnv(cwd, config?.dir),
        },
      );
    } catch (err) {
      config?.cleanup();
      scratch?.cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let settled = false;
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrTail = '';
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.abortSignal?.removeEventListener('abort', onAbort);
      killChild(child);
      config?.cleanup();
      scratch?.cleanup();
      fn();
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error(`opencode CLI timed out after ${timeoutMs} ms`))),
      timeoutMs,
    );
    // An unref'd timer must not keep the server alive on its own.
    if (typeof timer.unref === 'function') timer.unref();
    const onAbort = () => settle(() => reject(abortError(opts.abortSignal)));

    opts.abortSignal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_STDOUT_BYTES) chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.on('error', (err) => settle(() => reject(err)));
    child.on('close', (code) => {
      if (code === 0) {
        settle(() => {
          try {
            resolve(parseOpencodeJsonOutput(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      } else {
        settle(() => {
          const stdout = Buffer.concat(chunks).toString('utf8');
          const reported = extractOpencodeStdoutError(stdout);
          const stderrError = extractOpencodeStderrError(stderrTail);
          reject(
            new Error(
              describeOpencodeFailure(
                `opencode CLI exited with code ${code ?? 'unknown'}${
                  stderrError ? `: ${stderrError}` : ''
                }${reported ? ` (CLI reported: ${reported})` : ''}`,
              ),
            ),
          );
        });
      }
    });
  });
}

export type OpencodeStreamEvent =
  | { kind: 'text-delta'; delta: string }
  | { kind: 'tool'; tool: OpencodeToolCall }
  | { kind: 'done'; completion: OpencodeCompletion };

/**
 * Streaming variant: yields `text-delta` events as JSONL `text` lines arrive
 * on the child's stdout, then a terminal `done` carrying the full completion
 * (text + usage + finish reason). Used by `doStream` so long workbench
 * generations stream into the UI instead of arriving all at once.
 *
 * Transient failures are retried with backoff, but ONLY while no text has
 * been yielded yet: once the caller has seen a delta, a retry would duplicate
 * that prefix in the UI, so the failure is surfaced instead.
 */
export async function* streamOpencodePrompt(
  opts: RunOpencodeOptions,
): AsyncGenerator<OpencodeStreamEvent, void, void> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? OPENCODE_DEFAULT_MAX_ATTEMPTS);
  const baseDelay = opts.retryBaseDelayMs ?? OPENCODE_DEFAULT_RETRY_BASE_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let emittedText = false;
    try {
      for await (const event of streamOpencodePromptOnce(opts)) {
        if (event.kind === 'text-delta') emittedText = true;
        yield event;
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || emittedText || !isRetryableOpencodeError(error)) throw error;
      await sleep(baseDelay * 2 ** (attempt - 1), opts.abortSignal);
    }
  }
  throw lastError;
}

async function* streamOpencodePromptOnce(
  opts: RunOpencodeOptions,
): AsyncGenerator<OpencodeStreamEvent, void, void> {
  if (opts.abortSignal?.aborted) throw abortError(opts.abortSignal);
  const timeoutMs = opts.timeoutMs ?? OPENCODE_CLI_TIMEOUT_MS;
  const config = opts.mcpServers?.length
    ? prepareOpencodeConfigDir(opts.mcpServers, {
        lockBuiltinTools: opts.lockBuiltinTools ?? true,
      })
    : undefined;
  // Same isolation as the one-shot path: an explicit cwd (the harness scratch
  // dir) is kept, otherwise the run gets a private scratch dir so the CLI's
  // snapshot --work-tree and watchers never point at the server checkout.
  const scratch = opts.cwd ? undefined : prepareOpencodeScratchDir();
  const cwd = opts.cwd ?? scratch?.dir ?? process.cwd();
  let child: ChildProcess;
  try {
    child = nodeBuiltins().spawn(
      opts.cliPath,
      // Always a private server (see runOpencodePromptOnce): a shared-service
      // shutdown must not take the run down.
      buildOpencodeRunArgs(opts.modelId, opts.prompt, { standalone: true }),
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv(cwd, config?.dir),
      },
    );
  } catch (err) {
    config?.cleanup();
    scratch?.cleanup();
    throw err;
  }

  const acc = createOpencodeAccumulator();
  let buffer = '';
  let stderrTail = '';
  let stdoutBytes = 0;
  const pendingDeltas: string[] = [];
  const pendingTools: OpencodeToolCall[] = [];
  let streamError: Error | undefined;
  let exitCode: number | null = null;
  let closed = false;

  const feedLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: unknown;
    try {
      event = JSON.parse(trimmed) as unknown;
    } catch {
      return;
    }
    const { textDelta, tool } = foldOpencodeJsonEvent(acc, event);
    if (textDelta) pendingDeltas.push(textDelta);
    if (tool) pendingTools.push(tool);
  };

  const timer = setTimeout(() => {
    streamError = new Error(`opencode CLI timed out after ${timeoutMs} ms`);
    killChild(child);
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  const onAbort = () => {
    streamError = abortError(opts.abortSignal);
    killChild(child);
  };
  opts.abortSignal?.addEventListener('abort', onAbort, { once: true });

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      streamError = new Error('opencode CLI output exceeded 32 MiB');
      killChild(child);
      return;
    }
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) feedLine(line);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-4000);
  });
  child.on('error', (err) => {
    streamError = err;
  });
  child.on('close', (code) => {
    exitCode = code;
    closed = true;
  });

  try {
    for (;;) {
      while (pendingDeltas.length > 0) {
        yield { kind: 'text-delta', delta: pendingDeltas.shift() as string };
      }
      while (pendingTools.length > 0) {
        yield { kind: 'tool', tool: pendingTools.shift() as OpencodeToolCall };
      }
      if (streamError) throw streamError;
      if (closed) break;
      // Wait for more output or process exit.
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      if (opts.abortSignal?.aborted && !streamError) {
        throw abortError(opts.abortSignal);
      }
    }
    while (pendingDeltas.length > 0) {
      yield { kind: 'text-delta', delta: pendingDeltas.shift() as string };
    }
    while (pendingTools.length > 0) {
      yield { kind: 'tool', tool: pendingTools.shift() as OpencodeToolCall };
    }
    if (buffer.trim()) feedLine(buffer);
    if (exitCode !== 0) {
      // `feedLine` folds stdout error events into `acc.errorMessage`, which is
      // usually the only record of the cause when stderr is empty.
      const reported = acc.errorMessage?.trim();
      const stderrError = extractOpencodeStderrError(stderrTail);
      throw new Error(
        describeOpencodeFailure(
          `opencode CLI exited with code ${exitCode ?? 'unknown'}${
            stderrError ? `: ${stderrError}` : ''
          }${
            reported
              ? ` (CLI reported: ${reported.length > 500 ? `${reported.slice(0, 500)}…` : reported})`
              : ''
          }`,
        ),
      );
    }
    yield {
      kind: 'done',
      completion: {
        text: acc.text,
        reasoning: acc.reasoning,
        usage: acc.usage,
        finishReason: acc.finishReason,
        ...(acc.toolCalls.length ? { toolCalls: acc.toolCalls } : {}),
        ...(acc.errorMessage ? { errorMessage: acc.errorMessage } : {}),
      },
    };
  } finally {
    clearTimeout(timer);
    opts.abortSignal?.removeEventListener('abort', onAbort);
    killChild(child);
    config?.cleanup();
    scratch?.cleanup();
  }
}
