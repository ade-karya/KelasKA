/**
 * OpenCode CLI transport — same-machine `opencode run` as an LLM turn provider.
 *
 * Locked spec:
 * - Model follows whatever is active in opencode (`opencode:default` → omit -m).
 * - Tools stay owned by the pi loop (KelasKA). OpenCode only *emits* one tool
 *   call per turn via a fenced JSON block; it never executes course tools.
 * - Session durability stays in Postgres; opencode `-s <id>` is only an LLM
 *   prefix-cache hint, never the source of truth.
 *
 * Wire shape (mirrors nexu-io/open-design `opencode.ts` def):
 *   bin: opencode-cli → opencode fallback
 *   run: opencode run --format json (prompt via stdin, no -m for default)
 *   resume: -s <sessionID> (capture-style)
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const OPENCODE_DEFAULT_MODEL_ID = 'default';
export const OPENCODE_TRANSPORT_API = 'opencode-cli' as const;

const OPENCODE_CANDIDATE_BINS = process.env.OPENCODE_BIN?.trim()
  ? [process.env.OPENCODE_BIN.trim(), 'opencode-cli', 'opencode']
  : ['opencode-cli', 'opencode'];

export interface OpencodeTurnInput {
  systemPrompt: string;
  /** Already-flattened transcript lines, e.g. "user: ...", "assistant: ...". */
  transcriptLines: string[];
  tools: Array<{ name: string; description?: string; parameters: unknown }>;
  /** 'default' (omit -m) or an explicit 'provider/model'. */
  modelId?: string;
  resumeSessionId?: string;
  /**
   * Optional owner key for spawn fairness. When set, the turn additionally
   * counts against OPENCODE_MAX_SPAWNS_PER_OWNER so one greedy owner cannot
   * monopolize the global spawn pool. Omitted callers share the global pool
   * only (current runner path passes nothing — wiring an owner is optional).
   */
  ownerId?: string;
  cwd?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface OpencodeTurnResult {
  text: string;
  toolCall: { id: string; name: string; args: Record<string, unknown> } | null;
  sessionId: string | null;
  rawModel: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export function isDefaultOpencodeModel(modelId?: string): boolean {
  return !modelId || modelId === OPENCODE_DEFAULT_MODEL_ID;
}

export function buildOpencodeArgs(modelId?: string, resumeSessionId?: string): string[] {
  const args = ['run', '--format', 'json'];
  if (resumeSessionId) args.push('-s', resumeSessionId);
  if (!isDefaultOpencodeModel(modelId)) args.push('-m', modelId as string);
  return args;
}

export function resolveOpencodeBins(): string[] {
  return [...OPENCODE_CANDIDATE_BINS];
}

let cachedScratchDir: string | null = null;

/**
 * Working directory for spawned `opencode run` children. Deliberately NOT the
 * repo: the model is instructed to use no tools of its own, but a scratch dir
 * guarantees a stray file/shell action can never touch application code.
 * Overridable via OPENCODE_WORKDIR; explicit per-call `cwd` still wins.
 *
 * NOTE: do NOT drop an opencode.json project config here. Empirically
 * (2026-09-22), any project config in the scratch dir makes `opencode run`
 * answer 403 "OpenCode's free tier can only be used from within OpenCode",
 * while the bare dir works. Native-tool discipline is enforced by prompt
 * only (see composeOpencodePrompt).
 */
export function resolveOpencodeWorkdir(): string {
  if (cachedScratchDir) return cachedScratchDir;
  const configured = process.env.OPENCODE_WORKDIR?.trim();
  const dir = configured || join(tmpdir(), 'kelaska-opencode');
  mkdirSync(dir, { recursive: true });
  cachedScratchDir = dir;
  return dir;
}

// --- Spawn gate (20–50 concurrent chats) -------------------------------------
// One `opencode run` child per turn is expensive; without a gate N concurrent
// chats spawn N children at once (the only brake today is the runner's
// maxConcurrent=2). This module-level semaphore caps concurrent spawns
// globally with a FIFO queue, plus a per-owner cap so one greedy owner cannot
// monopolize the pool. Limits are read lazily from env so operators can tune
// without a rebuild; they mirror agentRuntimeConfig.opencodeSpawns in
// lib/server/agent-runtime/config.ts (documented in .env.example).
export const OPENCODE_MAX_CONCURRENT_SPAWNS_DEFAULT = 8;
export const OPENCODE_MAX_SPAWNS_PER_OWNER_DEFAULT = 2;
export const OPENCODE_SPAWN_QUEUE_TIMEOUT_MS_DEFAULT = 120_000;

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function resolveOpencodeSpawnLimits(): {
  maxConcurrentSpawns: number;
  maxSpawnsPerOwner: number;
  spawnQueueTimeoutMs: number;
} {
  return {
    maxConcurrentSpawns: positiveIntFromEnv(
      process.env.OPENCODE_MAX_CONCURRENT_SPAWNS,
      OPENCODE_MAX_CONCURRENT_SPAWNS_DEFAULT,
    ),
    maxSpawnsPerOwner: positiveIntFromEnv(
      process.env.OPENCODE_MAX_SPAWNS_PER_OWNER,
      OPENCODE_MAX_SPAWNS_PER_OWNER_DEFAULT,
    ),
    spawnQueueTimeoutMs: positiveIntFromEnv(
      process.env.OPENCODE_SPAWN_QUEUE_TIMEOUT_MS,
      OPENCODE_SPAWN_QUEUE_TIMEOUT_MS_DEFAULT,
    ),
  };
}

interface OpencodeSpawnWaiter {
  ownerKey: string | null;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  abortSignal?: AbortSignal;
  onAbort?: () => void;
}

let opencodeActiveSpawns = 0;
const opencodeActiveSpawnsPerOwner = new Map<string, number>();
const opencodeSpawnQueue: OpencodeSpawnWaiter[] = [];

function normalizeOpencodeOwnerId(ownerId?: string): string | null {
  const trimmed = ownerId?.trim();
  return trimmed ? trimmed : null;
}

export function getOpencodeSpawnStats(): {
  active: number;
  queued: number;
  perOwner: Record<string, number>;
} {
  return {
    active: opencodeActiveSpawns,
    queued: opencodeSpawnQueue.length,
    perOwner: Object.fromEntries(opencodeActiveSpawnsPerOwner),
  };
}

/** Test-only reset for the module-level spawn gate (no production callers). */
export function __resetOpencodeSpawnStateForTests(): void {
  for (const waiter of opencodeSpawnQueue.splice(0)) {
    if (!waiter.settled) {
      waiter.settled = true;
      clearTimeout(waiter.timer);
      if (waiter.abortSignal && waiter.onAbort) {
        waiter.abortSignal.removeEventListener('abort', waiter.onAbort);
      }
      waiter.reject(new Error('opencode spawn gate direset (test-only).'));
    }
  }
  opencodeActiveSpawns = 0;
  opencodeActiveSpawnsPerOwner.clear();
}

function buildSpawnQueueTimeoutError(timeoutMs: number, ownerKey: string | null): Error {
  const stats = getOpencodeSpawnStats();
  return new Error(
    `opencode spawn antre timeout setelah ${timeoutMs}ms ` +
      `(aktif ${stats.active}, antre ${stats.queued}, owner "${ownerKey ?? 'anon'}"). ` +
      `Turn gagal cepat agar tidak gantung. Naikkan OPENCODE_MAX_CONCURRENT_SPAWNS ` +
      `(batas global) / OPENCODE_MAX_SPAWNS_PER_OWNER (batas per owner) atau ` +
      `OPENCODE_SPAWN_QUEUE_TIMEOUT_MS bila antre wajar pada beban 20-50 chat konkuren.`,
  );
}

/**
 * Grant queued waiters while a global slot is free. FIFO order is preserved
 * among eligible waiters; a waiter blocked only by its per-owner cap is
 * skipped (not dequeued) so one greedy owner at the head cannot stall owners
 * behind it.
 */
function pumpOpencodeSpawnQueue(): void {
  const { maxConcurrentSpawns, maxSpawnsPerOwner } = resolveOpencodeSpawnLimits();
  while (opencodeActiveSpawns < maxConcurrentSpawns && opencodeSpawnQueue.length > 0) {
    const idx = opencodeSpawnQueue.findIndex((waiter) => {
      if (waiter.settled) return false;
      if (waiter.ownerKey === null) return true;
      return (opencodeActiveSpawnsPerOwner.get(waiter.ownerKey) ?? 0) < maxSpawnsPerOwner;
    });
    if (idx === -1) return;
    const waiter = opencodeSpawnQueue.splice(idx, 1)[0];
    if (!waiter || waiter.settled) continue;
    waiter.settled = true;
    clearTimeout(waiter.timer);
    if (waiter.abortSignal && waiter.onAbort) {
      waiter.abortSignal.removeEventListener('abort', waiter.onAbort);
    }
    opencodeActiveSpawns += 1;
    if (waiter.ownerKey !== null) {
      opencodeActiveSpawnsPerOwner.set(
        waiter.ownerKey,
        (opencodeActiveSpawnsPerOwner.get(waiter.ownerKey) ?? 0) + 1,
      );
    }
    waiter.resolve();
  }
}

export function acquireOpencodeSpawnSlot(
  ownerId?: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const ownerKey = normalizeOpencodeOwnerId(ownerId);
  const { maxConcurrentSpawns, maxSpawnsPerOwner, spawnQueueTimeoutMs } =
    resolveOpencodeSpawnLimits();
  if (abortSignal?.aborted) return Promise.reject(new Error('Operation aborted'));
  const perOwnerActive = ownerKey === null ? 0 : (opencodeActiveSpawnsPerOwner.get(ownerKey) ?? 0);
  const perOwnerOk = ownerKey === null || perOwnerActive < maxSpawnsPerOwner;
  // Fast path: grant immediately only when nobody is waiting (strict FIFO).
  if (opencodeSpawnQueue.length === 0 && opencodeActiveSpawns < maxConcurrentSpawns && perOwnerOk) {
    opencodeActiveSpawns += 1;
    if (ownerKey !== null) opencodeActiveSpawnsPerOwner.set(ownerKey, perOwnerActive + 1);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter = {} as OpencodeSpawnWaiter;
    waiter.ownerKey = ownerKey;
    waiter.resolve = resolve;
    waiter.reject = reject;
    waiter.settled = false;
    waiter.timer = setTimeout(() => {
      if (waiter.settled) return;
      waiter.settled = true;
      const at = opencodeSpawnQueue.indexOf(waiter);
      if (at !== -1) opencodeSpawnQueue.splice(at, 1);
      if (waiter.abortSignal && waiter.onAbort) {
        waiter.abortSignal.removeEventListener('abort', waiter.onAbort);
      }
      reject(buildSpawnQueueTimeoutError(spawnQueueTimeoutMs, ownerKey));
    }, spawnQueueTimeoutMs);
    // A queued turn must never keep the runner alive on its own.
    if (typeof waiter.timer.unref === 'function') waiter.timer.unref();
    if (abortSignal) {
      waiter.abortSignal = abortSignal;
      waiter.onAbort = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        clearTimeout(waiter.timer);
        const at = opencodeSpawnQueue.indexOf(waiter);
        if (at !== -1) opencodeSpawnQueue.splice(at, 1);
        reject(new Error('Operation aborted'));
      };
      abortSignal.addEventListener('abort', waiter.onAbort, { once: true });
    }
    opencodeSpawnQueue.push(waiter);
    // A slot may have freed between the fast-path check and the enqueue.
    pumpOpencodeSpawnQueue();
  });
}

export function releaseOpencodeSpawnSlot(ownerId?: string): void {
  const ownerKey = normalizeOpencodeOwnerId(ownerId);
  if (opencodeActiveSpawns > 0) opencodeActiveSpawns -= 1;
  if (ownerKey !== null) {
    const remaining = (opencodeActiveSpawnsPerOwner.get(ownerKey) ?? 1) - 1;
    if (remaining <= 0) opencodeActiveSpawnsPerOwner.delete(ownerKey);
    else opencodeActiveSpawnsPerOwner.set(ownerKey, remaining);
  }
  pumpOpencodeSpawnQueue();
}

/** Compose the single-turn prompt. Tools are described, never executed by opencode. */
export function composeOpencodePrompt(input: OpencodeTurnInput): string {
  const lines: string[] = [];
  lines.push('SYSTEM:');
  lines.push(input.systemPrompt);
  lines.push('');
  lines.push('WORKBENCH IDENTITY (always true, overrides any other role):');
  lines.push('- You are the KelasKA Pro workbench agent, NOT a shell/file assistant.');
  lines.push('- The AVAILABLE TOOLS list below is complete and REAL: every tool named there EXISTS and RUNS server-side.');
  lines.push('- Lines starting with "TRUSTED tool-result" are PROOF a tool succeeded. If one names a stageId/url, that stage EXISTS — REUSE it, never re-create it, never claim it was not saved.');
  lines.push('- NEVER claim course tools are unavailable, missing, or "tidak tersedia". NEVER say you only have read/shell access. If you already called a tool successfully in CONVERSATION, continue the build sequence (create_stage → set_roster → generate_scene → list_scenes → generate_tts).');
  lines.push('');
  if (input.transcriptLines.length > 0) {
    lines.push('CONVERSATION:');
    for (const line of input.transcriptLines) lines.push(line);
    lines.push('');
  }
  if (input.tools.length > 0) {
    lines.push('AVAILABLE TOOLS (you may call at most ONE per turn):');
    for (const tool of input.tools) {
      lines.push(`- name: ${tool.name}`);
      if (tool.description) lines.push(`  description: ${tool.description}`);
      lines.push(`  parameters: ${JSON.stringify(tool.parameters ?? {})}`);
    }
    lines.push('');
    lines.push('INSTRUCTIONS:');
    lines.push('- If plain answer suffices, reply with plain text only.');
    lines.push('- If you need a tool, output ONLY one fenced block and nothing else:');
    lines.push('```json');
    lines.push('{"tool_call": {"id": "<unique-id>", "name": "<tool-name>", "arguments": {}}}');
    lines.push('```');
    lines.push('- One tool per turn. Arguments must match the parameters schema.');
    lines.push(
      '- Do NOT use any file, shell, browser, or computer tools of your own ' +
        'for this task: you have no filesystem access and must not attempt ' +
        'any action outside the single fenced JSON block (or plain text). ' +
        'The only "read" tool is the workbench skill reader in AVAILABLE TOOLS — call it via the fenced block, never natively.',
    );
    lines.push('- Keep text concise. Respond in Indonesian unless the content requires otherwise.');
    // Recency anchor for small long-context models: the driver system prompt
    // is ~14k tokens, so restate the immediate contract last — what was just
    // read above is what weak models obey. Tool names come from the live
    // toolset so the anchor never drifts from AVAILABLE TOOLS.
    lines.push('');
    lines.push('NOW — THIS TURN:');
    lines.push(`- Your ONLY tools are: ${input.tools.map((tool) => tool.name).join(', ')}.`);
    lines.push('- That list IS complete. Do NOT check capabilities, do NOT describe tools, do NOT say any tool is missing or unavailable.');
    lines.push('- If CONVERSATION already shows a TRUSTED tool-result with a stageId, that stage EXISTS: continue with the NEXT build step for that stageId (never re-create it).');
    lines.push('- Output plain text OR exactly one fenced {"tool_call": ...} block. Nothing else.');
  } else {
    lines.push('INSTRUCTIONS:');
    lines.push('- Reply with plain text only. Keep it concise.');
  }
  return lines.join('\n');
}

function tryParseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function firstObject(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Tolerant JSONL accumulator. OpenCode's `--format json` event schema varies
 * across versions, so we probe common fields instead of a strict schema.
 */
export function accumulateOpencodeStdout(stdout: string): {
  text: string;
  sessionId: string | null;
  rawModel: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  structuredToolCall: { id: string; name: string; args: Record<string, unknown> } | null;
} {
  let text = '';
  let sessionId: string | null = null;
  let rawModel: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  let structuredToolCall: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  } | null = null;

  for (const line of stdout.split('\n')) {
    const event = tryParseJsonLine(line);
    if (!event) {
      // Non-JSON stdout (plain text fallback builds) is answer text.
      if (line.trim()) text += (text ? '\n' : '') + line;
      continue;
    }
    // Real `opencode run --format json` shape (verified live): top-level
    // `{type, sessionID}` with the payload nested under `part`, e.g.
    // `{"type":"text","sessionID":"ses_…","part":{"type":"text","text":"ok"}}`
    // and usage at `part.tokens.{input,output,total}` on step-finish.
    const part =
      event.part && typeof event.part === 'object' ? (event.part as Record<string, unknown>) : null;
    sessionId ??= pickString(
      event.sessionID,
      event.session_id,
      event.sessionId,
      (event.session as Record<string, unknown> | undefined)?.id,
      part?.sessionID,
      part?.session_id,
      part?.sessionId,
    );
    rawModel ??= pickString(
      event.model,
      event.modelId,
      part?.model,
      part?.modelId,
      (event.message as Record<string, unknown> | undefined)?.model,
    );
    const tokenSource =
      (event.usage && typeof event.usage === 'object'
        ? (event.usage as Record<string, unknown>)
        : null) ??
      (part?.tokens && typeof part.tokens === 'object'
        ? (part.tokens as Record<string, unknown>)
        : null);
    if (!usage && tokenSource) {
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      const input = num(tokenSource.inputTokens ?? tokenSource.input);
      const output = num(tokenSource.outputTokens ?? tokenSource.output);
      if (input || output) usage = { inputTokens: input, outputTokens: output };
    }
    // Structured tool-call probes (native opencode tool events, if any).
    // Probe both levels: `{type:"tool_call",…}` and `{part:{…}}`.
    const toolName = pickString(
      event.toolName,
      event.name,
      event.tool,
      part?.toolName,
      part?.name,
      part?.tool,
    );
    const toolId = pickString(
      event.toolCallId,
      event.id,
      event.tool_call_id,
      part?.toolCallId,
      part?.id,
      part?.tool_call_id,
    );
    const toolArgs = firstObject(
      event.input,
      event.args,
      event.arguments,
      part?.input,
      part?.args,
      part?.parameters,
      part?.arguments,
    );
    const eventType =
      `${typeof event.type === 'string' ? event.type : ''} ${part && typeof part.type === 'string' ? part.type : ''}`.toLowerCase();
    if (!structuredToolCall && toolName && toolArgs && /tool/.test(eventType)) {
      structuredToolCall = {
        id: toolId ?? `opencode-${Date.now()}`,
        name: toolName,
        args: toolArgs,
      };
      continue;
    }
    // Text probes (top-level and nested part).
    const delta = pickString(
      event.delta,
      event.text,
      event.content,
      event.message,
      part?.delta,
      part?.text,
      part?.content,
      (event.data as Record<string, unknown> | undefined)?.delta,
      (event.data as Record<string, unknown> | undefined)?.text,
    );
    if (delta && !/tool/.test(eventType)) text += delta;
  }
  return { text: text.trim(), sessionId, rawModel, usage, structuredToolCall };
}

const TOOL_CALL_FENCE = /```json\s*(\{[\s\S]*?"tool_call"[\s\S]*?\})\s*```/;

export function extractFencedToolCall(text: string): {
  text: string;
  toolCall: { id: string; name: string; args: Record<string, unknown> } | null;
} {
  const match = TOOL_CALL_FENCE.exec(text);
  if (!match?.[1]) return { text, toolCall: null };
  try {
    const parsed = JSON.parse(match[1]) as {
      tool_call?: { id?: unknown; name?: unknown; arguments?: unknown; args?: unknown };
    };
    const call = parsed.tool_call;
    if (!call || typeof call.name !== 'string' || !call.name) return { text, toolCall: null };
    const args =
      call.arguments && typeof call.arguments === 'object'
        ? (call.arguments as Record<string, unknown>)
        : call.args && typeof call.args === 'object'
          ? (call.args as Record<string, unknown>)
          : {};
    return {
      text: text.replace(match[0], '').trim(),
      toolCall: {
        id: typeof call.id === 'string' && call.id ? call.id : `opencode-${Date.now()}`,
        name: call.name,
        args,
      },
    };
  } catch {
    return { text, toolCall: null };
  }
}

export function classifyOpencodeError(stderr: string, exitCode: number | null): Error {
  const output = stderr.trim();
  if (/not logged in|no credentials|auth/i.test(output)) {
    return new Error(
      'opencode tidak punya kredensial (auth kosong). Jalankan `opencode auth login` lalu pilih model default aktif.',
    );
  }
  if (/no model|model not found|unknown model/i.test(output)) {
    return new Error(
      'opencode tidak punya model aktif. Set model default di opencode config atau isi MODEL_ROUTES explicit.',
    );
  }
  if (/not found|ENOENT/i.test(output) || exitCode === 127) {
    return new Error('Binary opencode tidak ditemukan di PATH (coba opencode-cli lalu opencode).');
  }
  return new Error(`opencode run gagal (exit ${exitCode ?? '?'}): ${output.slice(0, 500)}`);
}

export async function runOpencodeTurn(input: OpencodeTurnInput): Promise<OpencodeTurnResult> {  // One global permit per turn: bounds concurrent `opencode run` children.
  // Queue timeouts/aborts reject here (turn fails fast); only release a
  // permit that was actually acquired, hence acquire-outside-try.
  await acquireOpencodeSpawnSlot(input.ownerId, input.abortSignal);
  try {
    const prompt = composeOpencodePrompt(input);
    const args = buildOpencodeArgs(input.modelId, input.resumeSessionId);
    const timeoutMs =
      input.timeoutMs ??
      (process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS
        ? Number(process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS)
        : 600_000);
    let lastError: Error | null = null;

  for (const bin of resolveOpencodeBins()) {
    const result = await runOnce(
      bin,
      args,
      prompt,
      input.cwd ?? resolveOpencodeWorkdir(),
      timeoutMs,
      input.abortSignal,
    );
      if (result.ok) {
        return result.value;
      }
      lastError = result.error;
      // ENOENT → try next binary; any other failure is authoritative.
      if (!/tidak ditemukan di PATH/.test(result.error.message)) throw result.error;
    }
    throw lastError ?? new Error('Binary opencode tidak ditemukan di PATH.');
  } finally {
    releaseOpencodeSpawnSlot(input.ownerId);
  }
}

async function runOnce(
  bin: string,
  args: string[],
  prompt: string,
  cwd: string | undefined,
  timeoutMs: number,
  abortSignal: AbortSignal | undefined,
): Promise<{ ok: true; value: OpencodeTurnResult } | { ok: false; error: Error }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (
      outcome: { ok: true; value: OpencodeTurnResult } | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle({ ok: false, error: new Error(`opencode run timeout setelah ${timeoutMs}ms.`) });
    }, timeoutMs);
    // Avoid dangling timers keeping the runner alive.
    if (typeof timer.unref === 'function') timer.unref();

    abortSignal?.addEventListener(
      'abort',
      () => {
        child.kill('SIGTERM');
        settle({ ok: false, error: new Error('Operation aborted') });
      },
      { once: true },
    );

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: Error) => {
      settle({
        ok: false,
        error: /ENOENT/.test(error.message)
          ? new Error('Binary opencode tidak ditemukan di PATH (coba opencode-cli lalu opencode).')
          : error,
      });
    });
    child.on('close', (code) => {
      if (code !== 0) {
        settle({ ok: false, error: classifyOpencodeError(stderr || stdout, code) });
        return;
      }
      const acc = accumulateOpencodeStdout(stdout);
      const fenced = extractFencedToolCall(acc.text);
      settle({
        ok: true,
        value: {
          text: fenced.text,
          toolCall: acc.structuredToolCall ?? fenced.toolCall,
          sessionId: acc.sessionId,
          rawModel: acc.rawModel,
          usage: acc.usage,
        },
      });
    });

    child.stdin.on('error', () => {
      // The child may exit before draining stdin; the close handler settles.
    });
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();
  });
}

/**
 * Single plain-text turn (no tools): for server-only one-shot calls that
 * resolve an opencode-backed model but cannot go through the pi StreamFn
 * (e.g. the conversation-title generator). Returns trimmed text or null.
 */
export async function runOpencodeText(input: {
  systemPrompt: string;
  prompt: string;
  modelId?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const outcome = await runOpencodeTurn({
    systemPrompt: input.systemPrompt,
    transcriptLines: [`user: ${input.prompt}`],
    tools: [],
    modelId: input.modelId,
    timeoutMs: input.timeoutMs,
    abortSignal: input.abortSignal,
  });
  const text = outcome.text.trim();
  return text ? text : null;
}
