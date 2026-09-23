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
  const path = getBuiltinModule('node:path') as typeof import('node:path');
  return {
    spawn: childProcess.spawn.bind(childProcess),
    existsSync: fs.existsSync,
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

export interface OpencodeCompletion {
  text: string;
  reasoning: string;
  usage: OpencodeUsage;
  finishReason: OpencodeFinishReason;
  errorMessage?: string;
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

export function buildOpencodeRunArgs(modelId: string, prompt: string): string[] {
  return [
    'run',
    '--format',
    'json',
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
 * - `{type:'step_finish', part:{reason, tokens:{input,output,reasoning,cache:{read,write}}}}`
 * - `{type:'error', ...}` / `{type:'step_error'|'message_error', ...}` — failure
 */
export interface OpencodeAccumulator {
  text: string;
  reasoning: string;
  usage: OpencodeUsage;
  finishReason: OpencodeFinishReason;
  errorMessage?: string;
}

export function createOpencodeAccumulator(): OpencodeAccumulator {
  return { text: '', reasoning: '', usage: { ...EMPTY_USAGE }, finishReason: 'stop' };
}

export function foldOpencodeJsonEvent(
  acc: OpencodeAccumulator,
  event: unknown,
): { textDelta: string; reasoningDelta: string } {
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
        console.warn(`[opencode-cli] Unknown step_finish reason ${JSON.stringify(reason)} with answer text; treating the turn as completed.`);
        acc.finishReason = 'stop';
      } else {
        acc.finishReason = 'other';
      }
    }
    return { textDelta: '', reasoningDelta: '' };
  }
  if (type === 'error' || type === 'step_error' || type === 'message_error') {
    const message =
      (part && typeof part.message === 'string' && part.message) ||
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      'opencode CLI reported an error';
    acc.finishReason = 'error';
    acc.errorMessage = message;
    return { textDelta: '', reasoningDelta: '' };
  }
  return { textDelta: '', reasoningDelta: '' };
}

/**
 * The CLI-reported failure inside a `--format json` stdout buffer, if any.
 *
 * A failing `opencode run` often reports the real cause (rate limit, model
 * error, interrupted session) as a JSON `error`/`step_error` event on stdout
 * while leaving stderr empty — so an exit-code-only error ("exited with code
 * 1") hides the one line that explains it. Exported for unit tests.
 */
export function extractOpencodeStdoutError(
  stdout: string,
  maxLength = 500,
): string | undefined {
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
    const record = event as Record<string, unknown>;
    const part =
      record.part && typeof record.part === 'object'
        ? (record.part as Record<string, unknown>)
        : undefined;
    const message =
      (part && typeof part.message === 'string' && part.message) ||
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      undefined;
    if (message) found = message;
  }
  if (!found) return undefined;
  return found.length > maxLength ? `${found.slice(0, maxLength)}…` : found;
}

/** Parse a complete `--format json` stdout buffer into a completion. */
export function parseOpencodeJsonOutput(stdout: string): OpencodeCompletion {  const acc = createOpencodeAccumulator();
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
 * child in all three cases).
 */
export function runOpencodePrompt(opts: RunOpencodeOptions): Promise<OpencodeCompletion> {
  const timeoutMs = opts.timeoutMs ?? OPENCODE_CLI_TIMEOUT_MS;
  return new Promise<OpencodeCompletion>((resolve, reject) => {
    if (opts.abortSignal?.aborted) {
      reject(abortError(opts.abortSignal));
      return;
    }
    let child: ChildProcess;
    try {
      child = nodeBuiltins().spawn(opts.cliPath, buildOpencodeRunArgs(opts.modelId, opts.prompt), {
        cwd: opts.cwd ?? process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Never inherit the server's env-derived auth into the child beyond
        // what opencode itself needs; opencode reads its own auth store.
        env: { ...process.env },
      });
    } catch (err) {
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
          reject(
            new Error(
              `opencode CLI exited with code ${code ?? 'unknown'}${
                stderrTail ? `: ${stderrTail}` : ''
              }${reported ? ` (CLI reported: ${reported})` : ''}`,
            ),
          );
        });
      }
    });
  });
}

export type OpencodeStreamEvent =
  | { kind: 'text-delta'; delta: string }
  | { kind: 'done'; completion: OpencodeCompletion };

/**
 * Streaming variant: yields `text-delta` events as JSONL `text` lines arrive
 * on the child's stdout, then a terminal `done` carrying the full completion
 * (text + usage + finish reason). Used by `doStream` so long workbench
 * generations stream into the UI instead of arriving all at once.
 */
export async function* streamOpencodePrompt(
  opts: RunOpencodeOptions,
): AsyncGenerator<OpencodeStreamEvent, void, void> {
  if (opts.abortSignal?.aborted) throw abortError(opts.abortSignal);
  const timeoutMs = opts.timeoutMs ?? OPENCODE_CLI_TIMEOUT_MS;
  const child = nodeBuiltins().spawn(
    opts.cliPath,
    buildOpencodeRunArgs(opts.modelId, opts.prompt),
    {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  );

  const acc = createOpencodeAccumulator();
  let buffer = '';
  let stderrTail = '';
  let stdoutBytes = 0;
  const pendingDeltas: string[] = [];
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
    const { textDelta } = foldOpencodeJsonEvent(acc, event);
    if (textDelta) pendingDeltas.push(textDelta);
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
    if (buffer.trim()) feedLine(buffer);
    if (exitCode !== 0) {
      // `feedLine` folds stdout error events into `acc.errorMessage`, which is
      // usually the only record of the cause when stderr is empty.
      const reported = acc.errorMessage?.trim();
      throw new Error(
        `opencode CLI exited with code ${exitCode ?? 'unknown'}${stderrTail ? `: ${stderrTail}` : ''}${
          reported ? ` (CLI reported: ${reported.length > 500 ? `${reported.slice(0, 500)}…` : reported})` : ''
        }`,
      );
    }
    yield {
      kind: 'done',
      completion: {
        text: acc.text,
        reasoning: acc.reasoning,
        usage: acc.usage,
        finishReason: acc.finishReason,
        ...(acc.errorMessage ? { errorMessage: acc.errorMessage } : {}),
      },
    };
  } finally {
    clearTimeout(timer);
    opts.abortSignal?.removeEventListener('abort', onAbort);
    killChild(child);
  }
}
