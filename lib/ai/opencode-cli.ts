/**
 * OpenCode CLI execution bridge.
 *
 * Pola ini mengikuti `apps/daemon/src/runtimes/` milik nexu-io/open-design:
 * model `opencode:*` dieksekusi sebagai child process
 * `opencode run --format json -m opencode/<model>` dengan prompt via stdin
 * (menghindari `ENAMETOOLONG` di Windows) dan output NDJSON di stdout yang
 * diparse toleran (baris non-JSON diabaikan).
 *
 * Kenapa CLI, bukan HTTP: model FREE Zen (big-pickle, *-free) hanya bisa
 * dipakai dari DALAM klien opencode — panggilan HTTP server-side langsung
 * gagal dengan `FreeTierError`. Lewat CLI, eksekusi terjadi di dalam klien
 * sehingga model gratis bisa dipakai server-side tanpa API key.
 *
 * Batasan yang disengaja:
 * - Function tools OpenMAIC DIDUKUNG via envelope JSON (bukan protokol
 *   function-call asli — CLI tidak memilikinya). Bila caller menyertakan
 *   `tools`, prompt ditambah instruksi + skema, dan output teks CLI diparse:
 *   blok pagar ```tool_calls {"tool_calls":[{name, arguments}]} diubah menjadi
 *   tool-call parts SDK sehingga loop `generateText`/`streamText` + `stopWhen`
 *   caller berjalan normal (eksekusi tool tetap oleh SDK/pemanggil, hasil
 *   tool-result kembali sebagai teks di prompt berikutnya). Tanpa envelope =
 *   teks biasa, finish `stop`.
 * - Setiap panggilan = sesi CLI baru (one-shot, tanpa `-s` resume) karena
 *   panggilan OpenMAIC stateless (prompt penuh dikirim tiap request).
 * - CLI dijalankan di direktori temp kosong agar baca/tulis file oleh agen
 *   tidak menyentuh repo server.
 */

import type { ChildProcess } from 'node:child_process';
import type { LanguageModel } from 'ai';

// Server-only Node builtins are loaded lazily (see below) so this module stays
// importable from client bundles. `lib/ai/providers.ts` is imported by client
// stores for the `PROVIDERS` catalog data, and a static `node:*` import here
// would pull `node:child_process` into every client chunk that touches the
// workspace (`WorkspaceShell` -> `useSettingsStore` -> `providers.ts`), which
// Turbopack cannot chunk for the browser and panics with
// "the chunking context (unknown) does not support external modules
// (request: node:child_process)". The pure helpers in this file
// (`toCliModelId`, `buildOpencodeArgs`, `flattenPromptToText`, parser,
// `buildCliWarnings`) never touch Node APIs; `findOpencodeBin` /
// `runOpencodeCli` throw when called where Node builtins are unavailable
// (i.e. in the browser — the opencode path in `getModel` is server-only).

// ---------------------------------------------------------------------------
// Konfigurasi
// ---------------------------------------------------------------------------

/** Default eksekusi CLI: 10 menit (selaras OPENMAIC_AGENT_TOOL_TIMEOUT_MS). */
export const OPENCODE_CLI_DEFAULT_TIMEOUT_MS = 600_000;

/** Timeout probe ketersediaan binary (metadata, bukan run). */
const BIN_PROBE_TIMEOUT_MS = 10_000;

/** Batas stderr yang disimpan untuk pesan error. */
const STDERR_TAIL_CHARS = 4_000;

function cliTimeoutMs(): number {
  const raw = Number.parseInt(process.env.OPENCODE_CLI_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return OPENCODE_CLI_DEFAULT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Penemuan binary (mirip open-design `runtimes/executables.ts` + `detection.ts`)
// ---------------------------------------------------------------------------

let cachedBin: string | null | undefined;

async function loadNodeBuiltins(): Promise<{
  spawn: typeof import('node:child_process').spawn;
  fs: typeof import('node:fs');
  os: typeof import('node:os');
  path: typeof import('node:path');
}> {
  // `webpackIgnore` keeps Turbopack/webpack from trying to bundle these
  // Node-only modules into client chunks; they resolve as real Node imports
  // at runtime on the server. Never called from pure helpers, only from
  // `findOpencodeBin` / `runOpencodeCli` (server-only paths).
  const [childProcess, fs, os, path] = await Promise.all([
    import(/* webpackIgnore: true */ 'node:child_process'),
    import(/* webpackIgnore: true */ 'node:fs'),
    import(/* webpackIgnore: true */ 'node:os'),
    import(/* webpackIgnore: true */ 'node:path'),
  ]);
  return { spawn: childProcess.spawn, fs, os, path };
}

async function homeDir(): Promise<string> {
  const { os } = await loadNodeBuiltins();
  return os.homedir();
}

/** Kandidat lokasi binary, sesuai urutan prioritas. */
async function binCandidates(): Promise<string[]> {
  const fromEnv = (process.env.OPENCODE_BIN ?? '').trim();
  const { path } = await loadNodeBuiltins();
  const home = await homeDir();
  return [
    ...(fromEnv ? [fromEnv] : []),
    'opencode',
    'opencode-cli',
    path.join(home, '.opencode', 'bin', 'opencode'),
    path.join(home, 'bin', 'opencode'),
  ].filter(Boolean);
}

async function probeBin(bin: string): Promise<boolean> {
  const { spawn } = await loadNodeBuiltins();
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, ['--version'], { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* abaikan */
      }
      resolve(false);
    }, BIN_PROBE_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** Binary opencode pertama yang lolos probe `--version`. Hasil di-cache. */
export async function findOpencodeBin(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin;
  for (const bin of await binCandidates()) {
    if (await probeBin(bin)) {
      cachedBin = bin;
      return bin;
    }
  }
  cachedBin = null;
  return null;
}

/** Reset cache penemuan binary (untuk test). */
export function resetOpencodeBinCache(): void {
  cachedBin = undefined;
}

// ---------------------------------------------------------------------------
// Argumen (mirip open-design `defs/opencode.ts` buildArgs)
// ---------------------------------------------------------------------------

/** `opencode:big-pickle` -> `opencode/big-pickle` (bentuk `-m` CLI). */
export function toCliModelId(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.includes('/') ? trimmed : `opencode/${trimmed}`;
}

export function buildOpencodeArgs(modelId: string): string[] {
  // v2 `opencode run` tidak punya --dir / --dangerously-skip-permissions
  // (flag v1): sandboxing dicapai via cwd proses = direktori temp kosong.
  // `--auto` = setujui permission yang tidak eksplisit ditolak (non-interaktif).
  return ['run', '--format', 'json', '--auto', '-m', toCliModelId(modelId)];
}

// ---------------------------------------------------------------------------
// Flatten prompt LanguageModelV2 -> teks
// ---------------------------------------------------------------------------

type PromptPart = {
  type: string;
  text?: unknown;
  mediaType?: unknown;
};

type PromptMessage = {
  role: string;
  content: unknown;
};

function partText(part: PromptPart): string {
  if (part.type === 'text' && typeof part.text === 'string') return part.text;
  if (part.type === 'file') {
    const media = typeof part.mediaType === 'string' ? part.mediaType : 'file';
    return `[lampiran ${media} tidak diteruskan ke CLI; jelaskan secara tekstual bila relevan]`;
  }
  if (part.type === 'reasoning' && typeof (part as { text?: unknown }).text === 'string') {
    return (part as { text: string }).text;
  }
  if (part.type === 'tool-call') {
    const p = part as unknown as Record<string, unknown>;
    return `[tool-call ${String(p.toolName ?? 'unknown')}]`;
  }
  if (part.type === 'tool-result') {
    const p = part as unknown as Record<string, unknown>;
    const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
    return `[tool-result ${String(p.toolName ?? '')}: ${out.slice(0, 2000)}]`;
  }
  return '';
}

/** Ubah prompt SDK menjadi satu teks untuk stdin CLI. */
export function flattenPromptToText(prompt: PromptMessage[]): string {
  const blocks: string[] = [];
  for (const message of prompt) {
    const parts = Array.isArray(message.content) ? (message.content as PromptPart[]) : [];
    const text = parts.map(partText).filter(Boolean).join('');
    if (!text.trim()) continue;
    if (message.role === 'system') blocks.push(`[system]\n${text}`);
    else if (message.role === 'assistant') blocks.push(`[assistant]\n${text}`);
    else if (message.role === 'tool') blocks.push(`[tool]\n${text}`);
    else blocks.push(`[user]\n${text}`);
  }
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Parser NDJSON toleran (bentuk event open-design `handleOpenCodeEvent`)
// ---------------------------------------------------------------------------

export interface OpencodeToolUse {
  id: string;
  name: string;
}

export interface OpencodeParseEvents {
  onText?: (delta: string) => void;
  onSessionId?: (sessionId: string) => void;
  onToolUse?: (tool: OpencodeToolUse) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function extractErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object') return extractErrorMessage(parsed, value);
    } catch {
      /* bukan JSON */
    }
    return value;
  }
  if (isRecord(value)) {
    if (typeof value.detail === 'string' && value.detail) return value.detail;
    if (typeof value.message === 'string' && value.message) {
      return extractErrorMessage(value.message, value.message);
    }
    if (typeof value.error === 'string' && value.error) return value.error;
    if (value.error && typeof value.error === 'object') {
      return extractErrorMessage(value.error, fallback);
    }
    if (typeof value.name === 'string' && value.name) return value.name;
  }
  return fallback;
}

/** Event error CLI -> pesan, atau null bila bukan event error. */
function eventErrorMessage(obj: Record<string, unknown>): string | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (type === 'error' || type.endsWith('.error') || type.endsWith('_error')) {
    const message = extractErrorMessage(obj, '').trim();
    return message || 'OpenCode CLI melaporkan error tanpa pesan.';
  }
  // Bentuk tanpa `type`: { error: { message } }.
  if (!type && isRecord(obj.error)) {
    const message = extractErrorMessage(obj.error, '').trim();
    if (message) return message;
  }
  return null;
}

/** Parser inkremental: feed() per chunk stdout, finish() di akhir. */
export function createOpencodeStreamParser(events: OpencodeParseEvents = {}): {
  feed: (chunk: string) => void;
  finish: () => {
    text: string;
    sessionId: string | null;
    toolUses: OpencodeToolUse[];
    error: string | null;
  };
} {
  let buffer = '';
  let text = '';
  let sessionId: string | null = null;
  let error: string | null = null;
  const toolUses: OpencodeToolUse[] = [];
  const seenToolIds = new Set<string>();

  const captureSession = (value: unknown) => {
    if (!sessionId && typeof value === 'string' && value.length > 0) {
      sessionId = value;
      events.onSessionId?.(value);
    }
  };

  const handleObject = (obj: unknown) => {
    if (!isRecord(obj)) return;
    if (typeof obj.sessionID === 'string') captureSession(obj.sessionID);
    if (typeof obj.sessionId === 'string') captureSession(obj.sessionId);

    const err = eventErrorMessage(obj);
    if (err && !error) error = err;

    const part = isRecord(obj.part) ? obj.part : null;

    // open-design: { type:'text', part:{ text } } -> delta teks.
    if (obj.type === 'text' && part && typeof part.text === 'string' && part.text.length > 0) {
      text += part.text;
      events.onText?.(part.text);
      return;
    }
    // Varian: teks inline di event (mis. message/output).
    if ((obj.type === 'message' || obj.type === 'output') && typeof obj.text === 'string') {
      text += obj.text;
      events.onText?.(obj.text);
      return;
    }
    // open-design: { type:'tool_use', part:{ tool, callID } }.
    if (obj.type === 'tool_use' && part && typeof part.tool === 'string') {
      const id = typeof part.callID === 'string' ? part.callID : `${part.tool}:${toolUses.length}`;
      if (!seenToolIds.has(id)) {
        seenToolIds.add(id);
        const tool = { id, name: part.tool };
        toolUses.push(tool);
        events.onToolUse?.(tool);
      }
    }
  };

  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          handleObject(JSON.parse(trimmed) as unknown);
        } catch {
          // Baris log non-JSON (progress, banner) — abaikan seperti open-design.
        }
      }
    },
    finish() {
      const tail = buffer.trim();
      if (tail) {
        try {
          handleObject(JSON.parse(tail) as unknown);
        } catch {
          /* abaikan */
        }
      }
      return { text, sessionId, toolUses, error };
    },
  };
}

// ---------------------------------------------------------------------------
// Runner: spawn CLI, tulis prompt ke stdin, kumpulkan hasil
// ---------------------------------------------------------------------------

export interface RunOpencodeCliOptions {
  modelId: string;
  promptText: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  onTextDelta?: (delta: string) => void;
}

export interface RunOpencodeCliResult {
  text: string;
  sessionId: string | null;
  toolUses: OpencodeToolUse[];
}

function tailText(value: string, max: number): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function authHint(): string {
  return 'Bila ini soal auth (login/API key), jalankan: opencode auth login';
}

/**
 * Eksekusi satu prompt one-shot via `opencode run`. Melempar Error yang
 * deskriptif bila binary tidak ada, timeout, dibatalkan, atau CLI gagal.
 */
export async function runOpencodeCli(
  options: RunOpencodeCliOptions,
): Promise<RunOpencodeCliResult> {
  const { modelId, promptText, abortSignal, onTextDelta } = options;
  const timeoutMs = options.timeoutMs ?? cliTimeoutMs();

  const bin = await findOpencodeBin();
  if (!bin) {
    throw new Error(
      'Binary opencode tidak ditemukan di PATH maupun ~/.opencode/bin. ' +
        'Instal via: curl -fsSL https://opencode.ai/v2/install | bash ' +
        '(atau set OPENCODE_BIN ke path absolut binary).',
    );
  }
  if (!promptText.trim()) {
    throw new Error('Prompt kosong — opencode run membutuhkan prompt via stdin.');
  }

  // Sandbox: direktori temp kosong agar file-ops agen tidak menyentuh repo.
  const { spawn, fs, os, path } = await loadNodeBuiltins();
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-opencode-'));
  let args = buildOpencodeArgs(modelId);
  let retriedWithoutFlags = false;

  const attempt = (): Promise<RunOpencodeCliResult> =>
    new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(bin, args, { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const parser = createOpencodeStreamParser({
        onText: onTextDelta,
      });
      let stderr = '';
      let settled = false;
      const cleanupWorkdir = () => {
        fs.rm(workdir, { recursive: true, force: true }, () => {});
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanupWorkdir();
        reject(err);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanupWorkdir();
        const parsed = parser.finish();
        resolve({ text: parsed.text, sessionId: parsed.sessionId, toolUses: parsed.toolUses });
      };

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* abaikan */
        }
        fail(
          new Error(
            `opencode run timeout setelah ${timeoutMs}ms (model ${toCliModelId(modelId)}). ` +
              `Naikkan via OPENCODE_CLI_TIMEOUT_MS.`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();

      const onAbort = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* abaikan */
        }
        fail(new DOMException('opencode run dibatalkan.', 'AbortError'));
      };
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      child.on('error', (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      child.stdout?.on('data', (data: Buffer) => {
        parser.feed(data.toString('utf8'));
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
        if (stderr.length > STDERR_TAIL_CHARS * 2) stderr = tailText(stderr, STDERR_TAIL_CHARS * 2);
      });

      child.on('close', (code) => {
        abortSignal?.removeEventListener('abort', onAbort);
        if (code === 0) {
          const parsed = parser.finish();
          if (parsed.error) {
            fail(new Error(`opencode run melaporkan error: ${parsed.error} ${authHint()}`));
            return;
          }
          done();
          return;
        }
        const errTail = tailText(stderr.trim(), STDERR_TAIL_CHARS);
        fail(
          new Error(
            `opencode run gagal (exit ${code ?? 'unknown'}, model ${toCliModelId(modelId)})` +
              (errTail ? `: ${errTail}` : '') +
              ` ${authHint()}`,
          ),
        );
      });

      // Prompt via stdin (open-design: hindari ENAMETOOLONG + parsing `-`).
      try {
        child.stdin?.on('error', () => {});
        child.stdin?.write(promptText);
        child.stdin?.end();
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });

  try {
    return await attempt();
  } catch (err) {
    // Fallback: CLI lama tanpa --auto -> ulangi tanpa flag tersebut
    // (sekali saja).
    const message = err instanceof Error ? err.message : String(err);
    if (!retriedWithoutFlags && /unrecognized flag|unknown (flag|option)/i.test(message)) {
      retriedWithoutFlags = true;
      args = ['run', '--format', 'json', '-m', toCliModelId(modelId)];
      return attempt();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// LanguageModel (V2, struktural) agar plug ke generateText/streamText
// ---------------------------------------------------------------------------

type CliCallOptions = {
  prompt: PromptMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  responseFormat?: { type: 'text' } | { type: 'json'; schema?: unknown };
  tools?: Array<{ type: string; name?: string; description?: string; inputSchema?: unknown }>;
  toolChoice?: string | { type?: string; toolName?: string };
  abortSignal?: AbortSignal;
};

type CliWarning =
  | { type: 'unsupported-setting'; setting: string; details?: string }
  | { type: 'unsupported-tool'; tool: { type: string; name?: string }; details?: string };

/** Peringatan jujur untuk opsi yang tidak didukung eksekusi CLI. */
export function buildCliWarnings(options: CliCallOptions): CliWarning[] {
  const warnings: CliWarning[] = [];
  for (const setting of [
    'temperature',
    'topP',
    'topK',
    'seed',
    'presencePenalty',
    'frequencyPenalty',
    'stopSequences',
    'maxOutputTokens',
  ] as const) {
    if (options[setting] !== undefined) {
      warnings.push({
        type: 'unsupported-setting',
        setting,
        details: 'opencode run tidak menerima batasan sampling per panggilan.',
      });
    }
  }
  // Function tools DIDUKUNG via envelope JSON (lihat bawah); hanya
  // provider-defined tools yang benar-benar tidak bisa diteruskan.
  for (const tool of options.tools ?? []) {
    if (tool.type !== 'function') {
      warnings.push({
        type: 'unsupported-tool',
        tool: { type: tool.type, name: tool.name },
        details: 'Hanya function tools yang didukung eksekusi CLI (via envelope JSON).',
      });
    }
  }
  return warnings;
}

function promptWithFormatHint(
  promptText: string,
  responseFormat: CliCallOptions['responseFormat'],
): string {
  if (responseFormat?.type !== 'json') return promptText;
  const schema =
    'schema' in responseFormat && responseFormat.schema !== undefined
      ? `\nSkema (ringkas): ${JSON.stringify(responseFormat.schema).slice(0, 4000)}`
      : '';
  return `${promptText}\n\n[format] Balas HANYA dengan JSON valid, tanpa teks lain di luar JSON.${schema}`;
}

// ---------------------------------------------------------------------------
// Tool calling via envelope JSON
//
// CLI tidak mengenal protokol function-call, jadi function tools dijelaskan
// ke model sebagai instruksi + skema, dan model memanggil dengan memancarkan
// SATU blok pagar:
//
// ```tool_calls
// {"tool_calls":[{"name":"<nama-fungsi>","arguments":{...}}]}
// ```
//
// Parser mengekstrak blok itu menjadi tool-call parts SDK. Tanpa blok yang
// valid = teks biasa. Bila `toolChoice` = none, envelope diabaikan.
// ---------------------------------------------------------------------------

export interface CliFunctionToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface CliToolCallRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedToolCalls {
  /** Teks sebelum blok envelope (narasi model), bisa kosong. */
  leadingText: string;
  calls: CliToolCallRequest[];
}

/** false hanya untuk toolChoice none — selain itu model boleh memanggil. */
export function toolCallsAllowed(toolChoice: CliCallOptions['toolChoice']): boolean {
  if (toolChoice === undefined) return true;
  if (typeof toolChoice === 'string') return toolChoice !== 'none';
  return (toolChoice as { type?: string }).type !== 'none';
}

/** Nama tool yang DIWAJIBKAN (toolChoice tool/required), atau null. */
function requiredToolName(toolChoice: CliCallOptions['toolChoice']): string | null {
  if (typeof toolChoice === 'object' && toolChoice !== null) {
    const typed = toolChoice as { type?: string; toolName?: string };
    if (typed.type === 'tool' && typeof typed.toolName === 'string') return typed.toolName;
    if (typed.type === 'required') return '*';
  }
  return null;
}

function functionToolDefs(options: CliCallOptions): CliFunctionToolDef[] {
  return (options.tools ?? [])
    .filter((t) => t.type === 'function' && typeof t.name === 'string' && t.name.length > 0)
    .map((t) => ({
      name: t.name as string,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
}

/** Instruksi + skema tools yang ditempel ke prompt stdin. */
export function buildToolCallingInstructions(
  tools: CliFunctionToolDef[],
  toolChoice: CliCallOptions['toolChoice'],
): string {
  const required = requiredToolName(toolChoice);
  const lines = [
    '[tools] Tool-use protocol for THIS session (the harness intercepts it):',
    'To use a tool, print exactly ONE fenced block as your ENTIRE response:',
    '```tool_calls',
    '{"tool_calls":[{"name":"<function-name>","arguments":{...}}]}',
    '```',
    'The harness executes each call and returns the result(s) to you as a follow-up message; then continue.',
    'Rules:',
    '- These functions ARE available to you right now via the harness — use the fence, not your built-in tools, for them.',
    '- "arguments" MUST be a JSON object matching the function parameters.',
    '- Emit the fence ONLY when you actually need one or more calls.',
    required
      ? `- You MUST emit a call to "${required}" on this turn (plain text alone is not acceptable).`
      : '- When no call is needed, answer in plain text WITHOUT any fence.',
    'Available functions:',
    ...tools.map(
      (t) =>
        `- ${t.name}: ${(t.description ?? '(no description)').slice(0, 500)} ` +
        `Parameters: ${JSON.stringify(t.inputSchema ?? {})}`,
    ),
  ];
  return lines.join('\n');
}

function coerceArgs(value: unknown): Record<string, unknown> | null {
  let args = value ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return null;
    }
  }
  return isRecord(args) ? args : null;
}

/**
 * Ekstrak envelope tool_calls dari teks output CLI. Mengambil blok pagar
 * TERAKHIR yang menghasilkan >=1 panggilan valid (nama harus terdaftar).
 * Kembalikan null bila tidak ada panggilan valid (diperlakukan sebagai teks).
 */
export function parseToolCallsFromText(
  text: string,
  allowedNames: Set<string>,
): ParsedToolCalls | null {
  const candidates: Array<{ raw: string; start: number }> = [];
  for (const m of text.matchAll(/```tool_calls\s*([\s\S]*?)```/g)) {
    candidates.push({ raw: (m[1] ?? '').trim(), start: m.index ?? 0 });
  }
  if (candidates.length === 0) {
    for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
      if ((m[1] ?? '').includes('"tool_calls"')) {
        candidates.push({ raw: (m[1] ?? '').trim(), start: m.index ?? 0 });
      }
    }
  }
  if (candidates.length === 0) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"tool_calls"')) {
      candidates.push({ raw: trimmed, start: 0 });
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const { raw, start } = candidates[i]!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      continue;
    }
    const list =
      isRecord(parsed) && Array.isArray((parsed as { tool_calls?: unknown }).tool_calls)
        ? ((parsed as { tool_calls?: unknown }).tool_calls as unknown[])
        : null;
    if (!list) continue;
    const calls: CliToolCallRequest[] = [];
    for (const item of list) {
      if (!isRecord(item) || typeof item.name !== 'string') continue;
      const name = item.name.trim();
      if (!name || !allowedNames.has(name)) continue;
      const args = coerceArgs((item as { arguments?: unknown }).arguments);
      if (!args) continue;
      calls.push({ name, args });
    }
    if (calls.length === 0) continue;
    return { leadingText: start > 0 ? text.slice(0, start).trim() : '', calls };
  }
  return null;
}

let toolCallSeq = 0;

/** ID unik tool-call untuk satu respons (unik lintas langkah via counter). */
export function nextToolCallId(): string {
  toolCallSeq += 1;
  return `oc-${Date.now().toString(36)}-${toolCallSeq.toString(36)}`;
}

type CliContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string };

/** Prompt stdin: flatten + instruksi tools (bila ada) + hint format. */
function buildCliPrompt(options: CliCallOptions): {
  promptText: string;
  funcTools: CliFunctionToolDef[];
} {
  const funcTools = functionToolDefs(options);
  const allowCalls = toolCallsAllowed(options.toolChoice);
  let promptText = flattenPromptToText(options.prompt);
  if (funcTools.length > 0 && allowCalls) {
    promptText += `\n\n${buildToolCallingInstructions(funcTools, options.toolChoice)}`;
  }
  return {
    promptText: promptWithFormatHint(promptText, options.responseFormat),
    funcTools: funcTools.length > 0 && allowCalls ? funcTools : [],
  };
}

const ZERO_USAGE = { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined };

/**
 * Model `opencode:*` untuk AI SDK. `provider`/`modelId` mengikuti konvensi
 * registry agar logging + usage-meta OpenMAIC tetap benar. Di-cast ke
 * `LanguageModel` di batas modul (providers.ts) agar tidak menambah
 * dependensi `@ai-sdk/provider`.
 */
export class OpencodeCliLanguageModel {
  readonly specificationVersion = 'v2' as const;
  readonly provider = 'opencode';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async doGenerate(options: CliCallOptions): Promise<{
    content: Array<CliContentPart>;
    finishReason: 'stop' | 'tool-calls';
    usage: { inputTokens: undefined; outputTokens: undefined; totalTokens: undefined };
    warnings: CliWarning[];
  }> {
    const { promptText, funcTools } = buildCliPrompt(options);
    const result = await runOpencodeCli({
      modelId: this.modelId,
      promptText,
      abortSignal: options.abortSignal,
    });
    if (funcTools.length > 0) {
      const parsed = parseToolCallsFromText(result.text, new Set(funcTools.map((t) => t.name)));
      if (parsed && parsed.calls.length > 0) {
        const content: CliContentPart[] = [];
        if (parsed.leadingText) content.push({ type: 'text', text: parsed.leadingText });
        for (const call of parsed.calls) {
          content.push({
            type: 'tool-call',
            toolCallId: nextToolCallId(),
            toolName: call.name,
            input: JSON.stringify(call.args),
          });
        }
        return {
          content,
          finishReason: 'tool-calls',
          usage: ZERO_USAGE,
          warnings: buildCliWarnings(options),
        };
      }
    }
    return {
      content: [{ type: 'text', text: result.text }],
      finishReason: 'stop',
      usage: ZERO_USAGE,
      warnings: buildCliWarnings(options),
    };
  }

  async doStream(options: CliCallOptions): Promise<{
    stream: ReadableStream<Record<string, unknown>>;
  }> {
    const warnings = buildCliWarnings(options);
    const { promptText, funcTools } = buildCliPrompt(options);
    const modelId = this.modelId;
    const textId = 'opencode-text-0';

    // Tanpa tools: teruskan delta live. Dengan tools: buffer dulu agar blok
    // envelope tidak bocor sebagai teks, lalu pancarkan teks + tool-call.
    const live = funcTools.length === 0;

    const stream = new ReadableStream<Record<string, unknown>>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings });
        try {
          if (live) {
            controller.enqueue({ type: 'text-start', id: textId });
            await runOpencodeCli({
              modelId,
              promptText,
              abortSignal: options.abortSignal,
              onTextDelta: (delta) => {
                controller.enqueue({ type: 'text-delta', id: textId, delta });
              },
            });
            controller.enqueue({ type: 'text-end', id: textId });
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage: ZERO_USAGE });
          } else {
            const result = await runOpencodeCli({
              modelId,
              promptText,
              abortSignal: options.abortSignal,
            });
            const parsed = parseToolCallsFromText(
              result.text,
              new Set(funcTools.map((t) => t.name)),
            );
            if (parsed && parsed.calls.length > 0) {
              if (parsed.leadingText) {
                controller.enqueue({ type: 'text-start', id: textId });
                controller.enqueue({ type: 'text-delta', id: textId, delta: parsed.leadingText });
                controller.enqueue({ type: 'text-end', id: textId });
              }
              for (const call of parsed.calls) {
                const id = nextToolCallId();
                const input = JSON.stringify(call.args);
                controller.enqueue({ type: 'tool-input-start', id, toolName: call.name });
                controller.enqueue({ type: 'tool-input-delta', id, delta: input });
                controller.enqueue({ type: 'tool-input-end', id });
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: id,
                  toolName: call.name,
                  input,
                });
              }
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage: ZERO_USAGE });
            } else {
              controller.enqueue({ type: 'text-start', id: textId });
              controller.enqueue({ type: 'text-delta', id: textId, delta: result.text });
              controller.enqueue({ type: 'text-end', id: textId });
              controller.enqueue({ type: 'finish', finishReason: 'stop', usage: ZERO_USAGE });
            }
          }
        } catch (err) {
          controller.enqueue({ type: 'error', error: err });
        } finally {
          controller.close();
        }
      },
    });

    return { stream };
  }
}

/** Pabrik model CLI untuk dipakai `getModel` di providers.ts. */
export function createOpencodeCliModel(modelId: string): LanguageModel {
  return new OpencodeCliLanguageModel(modelId) as unknown as LanguageModel;
}
