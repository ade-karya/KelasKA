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
 * Paritas dengan LLM ber-API-key (dijaga di sini, bukan di runner):
 * - Spec AI SDK v3 (sama seperti provider HTTP): finishReason {unified,raw},
 *   usage estimasi karakter/4 (bukan nol) agar usage-storage/cost/compaction
 *   bekerja, dan tanpa warning compat-mode.
 * - Sampling (maxOutputTokens/temperature/topP/topK/penalties) dipetakan ke
 *   instruksi prompt; stopSequences didukung NYATA via pemotongan teks
 *   (live + buffered). Hanya seed yang tetap diwarning (tak terwakili via CLI).
 * - Riwayat tool-call/tool-result dipertahankan PENUH (nama+argumen+output,
 *   tanpa potong 2000 char) agar badan skill + konteks multi-turn utuh —
 *   sama seperti pesan terstruktur jalur HTTP.
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

/** Default eksekusi CLI: 15 menit (selaras LLM_FETCH_TIMEOUT_MS jalur HTTP ber-key). */
export const OPENCODE_CLI_DEFAULT_TIMEOUT_MS = 900_000;

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

/** `opencode:big-pickle` -> `opencode/big-pickle`; `opencode-go:gpt-6-luna` -> `opencode-go/gpt-6-luna` (bentuk `-m` CLI). */
export function toCliModelId(modelId: string, cliProvider = 'opencode'): string {
  const trimmed = modelId.trim();
  return trimmed.includes('/') ? trimmed : `${cliProvider}/${trimmed}`;
}

/**
 * Varian thinking NATIF CLI (`-m <provider>/<id>#<variant>`, /variants TUI)
 * yang TERVERIFIKASI LIVE per model — variant tak dikenal ditolak CLI
 * ("Variant unavailable"), jadi tabel ini harus persis hasil probe:
 * - opencode/muse-spark-1.3-contributor-free: minimal,low,medium,high,xhigh
 * - opencode/space-bunny-free: low,medium,high,max,xhigh
 * - opencode/fledge-alpha-free: low,high,max
 * Model lain (big-pickle, longcat, mimo, ling, nemotron, dan semua yang
 * terprobe tanpa varian — kimi, deepseek, glm-5.2, qwen, minimax, hy4)
 * TIDAK punya varian natif: effort disalurkan sebagai instruksi prompt
 * (buildThinkingHints). Model `opencode-go/*` yang tak terprobe (401 di
 * kredensial ini) sengaja tak didaftarkan — prompt-hint tak pernah error.
 */
export const OPENCODE_NATIVE_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  'opencode:muse-spark-1.3-contributor-free': ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'opencode:space-bunny-free': ['low', 'medium', 'high', 'max', 'xhigh'],
  'opencode:fledge-alpha-free': ['low', 'high', 'max'],
  // Inferensi keluarga (belum terverifikasi live — kredensial ini 401 untuk
  // semua `opencode-go/*`, sehingga probe varian tak bisa jalan; cermin
  // varian keluarga seinduk di `opencode/*` + bukti parsial `gpt-6-luna#low`
  // lolos validasi saat backend melayani). Bila inferensi meleset,
  // runOpencodeCli otomatis ulangi SEKALI tanpa variant + hint prompt
  // (lihat bawah), jadi tak pernah menjadi error fatal bagi user.
  'opencode-go:muse-spark-1.2-contributor': ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'opencode-go:muse-spark-1.3-contributor': ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'opencode-go:space-bunny-free': ['low', 'medium', 'high', 'max', 'xhigh'],
  'opencode-go:gpt-5.6-luna': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'opencode-go:gpt-6-luna': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
};

/**
 * Varian natif untuk model+effort, atau undefined (pakai prompt-hint).
 * Kunci `${cliProvider}:${modelId}` dengan modelId bare (tanpa `#variant`).
 */
export function cliNativeVariant(
  modelId: string,
  cliProvider: string,
  effort: string | undefined,
): string | undefined {
  if (!effort) return undefined;
  const bare = modelId.trim().split('#')[0];
  const list = OPENCODE_NATIVE_VARIANTS[`${cliProvider}:${bare}`];
  return list?.includes(effort) ? effort : undefined;
}

export function buildOpencodeArgs(
  modelId: string,
  cliProvider = 'opencode',
  variant?: string,
): string[] {
  // v2 `opencode run` tidak punya --dir / --dangerously-skip-permissions
  // (flag v1): sandboxing dicapai via cwd proses = direktori temp kosong.
  // `--auto` = setujui permission yang tidak eksplisit ditolak (non-interaktif).
  // Varian natif ditempel sebagai `#variant` (`-m provider/id#variant`,
  // /variants TUI); tanpa varian = model dasar.
  const base = ['run', '--format', 'json', '--auto', '-m', toCliModelId(modelId, cliProvider)];
  if (variant) base[base.length - 1] += `#${variant}`;
  return base;
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
    // Paritas jalur ber-key: pertahankan NAMA + ARGUMEN penuh (bukan nama saja)
    // agar turn lanjutan + riwayat skill tidak kehilangan konteks panggilan.
    const p = part as unknown as Record<string, unknown>;
    const name = String(p.toolName ?? p.name ?? 'unknown');
    let argsText = '';
    try {
      const raw = (p.input ?? p.args ?? p.arguments) as unknown;
      argsText = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
    } catch {
      argsText = '{}';
    }
    return `[tool-call ${name} ${argsText}]`;
  }
  if (part.type === 'tool-result') {
    // Paritas jalur ber-key: JANGAN potong 2000 karakter. Badan skill
    // (SKILL.md) + hasil read_stage/material bisa >2000 dan model butuh utuh.
    const p = part as unknown as Record<string, unknown>;
    const out =
      typeof p.output === 'string'
        ? p.output
        : JSON.stringify((p.output ?? (p as { result?: unknown }).result ?? '') as unknown);
    return `[tool-result ${String((p.toolName ?? p.name ?? '') as string)}: ${out}]`;
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

/**
 * Event error CLI -> pesan + kode, atau null bila bukan event error.
 *
 * opencode v2 melaporkan error sebagai event NDJSON di STDOUT
 * (`{"type":"error","error":{"type":"provider.no-route","message":"..."}}`),
 * bukan ke stderr. Kode error (`provider.no-route`, `auth.*`, ...) ikut
 * diambil karena dipakai runner untuk classifies kegagalan yang tidak bisa
 * diperbaiki dengan retry.
 */
function eventErrorInfo(obj: Record<string, unknown>): { message: string; code: string } | null {
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (type === 'error' || type.endsWith('.error') || type.endsWith('_error')) {
    const payload = obj;
    const nested = isRecord(payload.error) ? payload.error : null;
    return {
      message:
        extractErrorMessage(payload, '').trim() || 'OpenCode CLI melaporkan error tanpa pesan.',
      code: nested && typeof nested.type === 'string' ? nested.type : type,
    };
  }
  // Bentuk tanpa `type`: { error: { type, message } }.
  if (!type && isRecord(obj.error)) {
    const payload = obj.error;
    const message = extractErrorMessage(payload, '').trim();
    if (!message) return null;
    return { message, code: typeof payload.type === 'string' ? payload.type : 'error' };
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
    /** Kode error CLI (mis. `provider.no-route`); null bila tidak ada. */
    errorCode: string | null;
  };
} {
  let buffer = '';
  let text = '';
  let sessionId: string | null = null;
  let error: string | null = null;
  let errorCode: string | null = null;
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

    const failure = eventErrorInfo(obj);
    if (failure && !error) {
      error = failure.message;
      errorCode = failure.code;
    }

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
      // Idempoten: `close` handler bisa memanggil finish() lebih dari sekali
      // (lalu `done()` memanggilnya lagi). Buffer dikosongkan agar sisa baris
      // tidak di-parse dua kali — tanpa itu teks terakhir terduplikasi.
      const tail = buffer.trim();
      buffer = '';
      if (tail) {
        try {
          handleObject(JSON.parse(tail) as unknown);
        } catch {
          /* abaikan */
        }
      }
      return { text, sessionId, toolUses, error, errorCode };
    },
  };
}

// ---------------------------------------------------------------------------
// Runner: spawn CLI, tulis prompt ke stdin, kumpulkan hasil
// ---------------------------------------------------------------------------

export interface RunOpencodeCliOptions {
  modelId: string;
  /**
   * Slug provider CLI (`opencode` atau `opencode-go`). Default `opencode`
   * agar pemanggil lama tidak berubah; diisi dari providerId registry oleh
   * `OpencodeCliLanguageModel` / `getModel`.
   */
  cliProvider?: string;
  promptText: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  onTextDelta?: (delta: string) => void;
  /**
   * Varian thinking natif (`#variant` /variants TUI). Ditempel ke `-m` sebagai
   * `provider/id#variant`; tanpa ini = model dasar.
   */
  variant?: string;
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
 * Totokan kegagalan auth pada teks MENTAH CLI (stderr / event error) — dicek
 * SEBELUM authHint ditempel, karena hint itu sendiri mengandung frasa
 * "opencode auth login" dan akan membuat semua error lolos deteksi.
 * Tanpa ini, kegagalan auth (mis. belum `opencode auth login`) keluar
 * sebagai error generik 500 dan di-retry 5x oleh client — setiap percobaan
 * men-spawn proses CLI baru yang gagal dengan cara yang sama.
 */
const AUTH_FAILURE_PATTERN =
  /auth login|not logged in|logged in|unauthorized|unauthenticated|\b401\b|forbidden|\b403\b|api key|invalid key|login required|permission denied|access denied|authentication/i;

/**
 * Kegagalan "model tidak tersedia" (`provider.no-route`, `Model unavailable`,
 * `unknown model`, ...). Ini salah KONFIGURASI, bukan kondisi sementara: retry
 * dengan model yang sama akan gagal terus, dan CLI selalu keluar non-nol. Tanpa
 * klasifikasi ini, config salah tampak seperti gangguan sementara: muncul
 * sebagai 500 generik yang di-retry `maxAttempts` kali sambil menyalin pesan
 * yang sama.
 */
const MODEL_UNAVAILABLE_PATTERN =
  /model unavailable|no[- ]route|unknown model|model not found|unsupported model|invalid model|model_not_found/i;

function isAuthFailureMessage(message: string): boolean {
  return AUTH_FAILURE_PATTERN.test(message);
}

function isModelUnavailable(message: string, errorCode: string | null): boolean {
  return (
    (errorCode != null &&
      /no[- ]?route|model[-_.]?not[-_.]?found|unknown[-_.]?model/i.test(errorCode)) ||
    MODEL_UNAVAILABLE_PATTERN.test(message)
  );
}

/**
 * Error CLI yang otomatis membawa statusCode: 401 untuk kegagalan auth dan 400
 * untuk model tidak tersedia — agar `llmApiError` memetakannya ke HTTP yang
 * fail-fast (non-retryable di client) alih-alih 500 generik yang memicu retry
 * membabi-buta. `rawText` WAJIB teks mentah CLI (stderr/event), bukan pesan
 * jadi: pesan jadi selalu ditempeli authHint yang mengandung frasa "API key".
 */
function cliError(
  rawText: string,
  fullMessage: string,
  errorCode: string | null = null,
): Error & { statusCode?: number } {
  const err = new Error(fullMessage) as Error & { statusCode?: number };
  if (!rawText) return err;
  if (isAuthFailureMessage(rawText)) err.statusCode = 401;
  else if (isModelUnavailable(rawText, errorCode)) err.statusCode = 400;
  return err;
}

/**
 * Petunjuk yang relevan untuk kegagalan tertentu. authHint hanya ditempel bila
 * kegagalan memang auth-seperti: menempelkannya tanpa syarat membuat error
 * konfigurasi (model typo) tampil seolah-olah penyebabnya kredensial, yang
 * mengarahkan operator ke `opencode auth login` padahal itu tidak akan
 * menolong sama sekali.
 */
function failureHint(rawText: string, errorCode: string | null): string {
  if (isAuthFailureMessage(rawText)) return authHint();
  if (isModelUnavailable(rawText, errorCode)) {
    return (
      'Daftar model yang tersedia bisa dicek dengan: opencode models. ' +
      'Perbaiki juga model id di DEFAULT_MODEL / MODEL_ROUTES bila perlu.'
    );
  }
  return 'opencode CLI tidak mengeluarkan pesan error yang bisa dibaca.';
}

/**
 * Eksekusi satu prompt one-shot via `opencode run`. Melempar Error yang
 * deskriptif bila binary tidak ada, timeout, dibatalkan, atau CLI gagal.
 */
export async function runOpencodeCli(
  options: RunOpencodeCliOptions,
): Promise<RunOpencodeCliResult> {
  const { modelId, promptText, abortSignal, onTextDelta } = options;
  const cliProvider = options.cliProvider ?? 'opencode';
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
  let args = buildOpencodeArgs(modelId, cliProvider, options.variant);
  let activePromptText = promptText;
  let retriedWithoutFlags = false;
  let retriedWithoutVariant = false;

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
        const parsed = parser.finish();
        if (code === 0) {
          if (parsed.error) {
            // Deteksi auth dari teks mentah CLI (sebelum hint ditempel).
            fail(
              cliError(
                parsed.error,
                `opencode run melaporkan error: ${parsed.error} ` +
                  failureHint(parsed.error, parsed.errorCode),
                parsed.errorCode,
              ),
            );
            return;
          }
          done();
          return;
        }
        // opencode v2 menulis error sebagai event NDJSON di STDOUT, bukan ke
        // stderr. Mengambil detail HANYA dari stderr di sini membuang penyebab
        // sebenarnya: mis. `provider.no-route` / "Model unavailable" untuk
        // model id yang tidak terdaftar, yang Exit 1 dengan stderr KOSONG.
        // Sumber detail digabung: event stdout dulu (penyebab sebenarnya),
        // stderr sebagai pelengkap bila ada.
        const errTail = tailText(stderr.trim(), STDERR_TAIL_CHARS);
        const detailText =
          parsed.error && errTail && parsed.error !== errTail
            ? `${parsed.error} | ${errTail}`
            : (parsed.error ?? errTail);
        fail(
          cliError(
            detailText,
            `opencode run gagal (exit ${code ?? 'unknown'}, model ${toCliModelId(modelId)})` +
              (detailText ? `: ${detailText}` : '') +
              ` ${failureHint(detailText, parsed.errorCode)}`,
            parsed.errorCode,
          ),
        );
      });

      // Prompt via stdin (open-design: hindari ENAMETOOLONG + parsing `-`).
      try {
        child.stdin?.on('error', () => {});
        child.stdin?.write(activePromptText);
        child.stdin?.end();
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });

  try {
    return await attempt();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Varian ditolak backend ("Variant unavailable"): katalog varian berubah
    // atau inferensi keluarga di OPENCODE_NATIVE_VARIANTS meleset. Ulangi
    // SEKALI tanpa `#variant` + hint prompt sebagai gantinya — validasi
    // varian bersifat lokal (tanpa kuota), jadi retry ini murah dan tak
    // pernah mengubah error auth/model menjadi sukses palsu.
    if (options.variant && !retriedWithoutVariant && /variant unavailable/i.test(message)) {
      retriedWithoutVariant = true;
      args = buildOpencodeArgs(modelId, cliProvider);
      const hint = buildThinkingHints(options.variant);
      if (hint) activePromptText += `\n\n${hint}`;
      return await attempt().catch((retryErr) => {
        // Gagal lagi tanpa varian = masalah model/auth yang sesungguhnya.
        throw retryErr;
      });
    }
    // Fallback: CLI lama tanpa --auto -> ulangi tanpa flag tersebut
    // (sekali saja).
    if (!retriedWithoutFlags && /unrecognized flag|unknown (flag|option)/i.test(message)) {
      retriedWithoutFlags = true;
      args = ['run', '--format', 'json', '-m', toCliModelId(modelId)];
      if (options.variant && !retriedWithoutVariant) args[args.length - 1] += `#${options.variant}`;
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
  /**
   * Opsi provider dari AI SDK (diteruskan generateText/streamText). Jalur CLI
   * hanya membaca `opencode.thinkingEffort` (diisi lib/ai/llm.ts dari
   * ThinkingConfig per model) menjadi instruksi prompt — bukan wire-param.
   */
  providerOptions?: {
    opencode?: { thinkingEffort?: string };
    [key: string]: unknown;
  };
};

type CliWarning =
  | { type: 'unsupported-setting'; setting: string; details?: string }
  | { type: 'unsupported-tool'; tool: { type: string; name?: string }; details?: string };

/** Peringatan jujur untuk opsi yang tidak didukung eksekusi CLI. */
export function buildCliWarnings(options: CliCallOptions): CliWarning[] {
  const warnings: CliWarning[] = [];
  // Paritas jalur ber-key: maxOutputTokens/temperature/topP/topK/
  // presencePenalty/frequencyPenalty/stopSequences DIPETAKAN ke instruksi
  // prompt (buildSamplingHints) + pemotongan stop-sequence nyata — bukan
  // diwarning. Hanya seed yang benar-benar tak bisa diwakili via CLI.
  if (options.seed !== undefined) {
    warnings.push({
      type: 'unsupported-setting',
      setting: 'seed',
      details: 'opencode run tidak menerima seed deterministik per panggilan.',
    });
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

/**
 * Paritas sampling dengan jalur HTTP ber-key.
 *
 * `opencode run` tidak punya flag sampling per panggilan, jadi batasan
 * disalurkan sebagai instruksi prompt (pendekatan yang sama dipakai
 * responseFormat JSON di bawah). Ini menghilangkan warning
 * `unsupported-setting` yang membanjiri log agent-runtime sekaligus membuat
 * perilaku CLI mendekati model ber-key dari sisi pemanggil.
 */
export function buildSamplingHints(options: CliCallOptions): string {
  const hints: string[] = [];
  if (options.maxOutputTokens !== undefined && Number.isFinite(options.maxOutputTokens)) {
    const max = Math.max(1, Math.floor(options.maxOutputTokens));
    // Model FREE (opencode-cli, outputWindow 32000) sering dipakai untuk
    // generate HTML simulasi yang WAJIB lengkap sampai </html>. Instruksi
    // "jawab ringkas" membuat model memotong HTML -> extractHtml gagal ->
    // "invalid-model-output". Untuk budget besar, tekankan kelengkapan.
    if (max >= 8000) {
      hints.push(
        `Batasi jawaban maksimal ~${max} token; jawab LENGKAP sampai selesai (untuk HTML: sampai </html>) dan jangan memotong output. Jangan bertele-tele di luar kebutuhan.`,
      );
    } else {
      hints.push(`Batasi jawaban maksimal ~${max} token; jawab ringkas dan jangan bertele-tele.`);
    }
  }
  if (options.temperature !== undefined) {
    const t = Number(options.temperature);
    if (Number.isFinite(t)) {
      hints.push(
        t <= 0.2
          ? 'Jawab deterministik dan faktual; hindari variasi kreatif.'
          : t >= 1
            ? 'Jawab ekspresif dan variatif bila relevan.'
            : 'Seimbangkan ketepatan dan keluwesan dalam jawaban.',
      );
    }
  }
  if (options.topP !== undefined || options.topK !== undefined) {
    hints.push('Pilih kata yang paling tepat dan umum; hindari pilihan kata yang aneh.');
  }
  if (options.presencePenalty !== undefined || options.frequencyPenalty !== undefined) {
    hints.push('Hindari pengulangan frasa yang sama; variasikan kalimat.');
  }
  if (options.stopSequences && options.stopSequences.length > 0) {
    const seqs = options.stopSequences.filter((s) => typeof s === 'string' && s.length > 0);
    if (seqs.length > 0) {
      hints.push(
        `Akhiri jawaban SEBELUM memancarkan salah satu dari: ${seqs.map((s) => JSON.stringify(s)).join(', ')}. Jangan sertakan penanda itu.`,
      );
    }
  }
  if (hints.length === 0) return '';
  return `[sampling]\n${hints.join('\n')}`;
}

/** Paritas stopSequences: potong teks pada kemunculan pertama sekuens setop. */
export function applyStopSequences(text: string, stopSequences?: string[]): string {
  if (!stopSequences || stopSequences.length === 0) return text;
  let cut = -1;
  for (const seq of stopSequences) {
    if (!seq) continue;
    const idx = text.indexOf(seq);
    if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
  }
  return cut >= 0 ? text.slice(0, cut) : text;
}

/** Estimasi token kasar (karakter/4) agar usage/cost/compaction CLI ~ jalur ber-key. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(0, Math.ceil(text.length / 4));
}

/**
 * Ambil varian thinking untuk transport CLI dari providerOptions
 * (`opencode.thinkingEffort`, diisi lib/ai/llm.ts dari ThinkingConfig
 * per-model pilihan workbench). Tanpa config eksplisit -> undefined (tanpa
 * hint, perilaku lama dipertahankan).
 */
export function cliThinkingEffort(options: CliCallOptions): string | undefined {
  const raw = options.providerOptions?.opencode?.thinkingEffort;
  if (typeof raw !== 'string') return undefined;
  const effort = raw.trim().toLowerCase();
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)
    ? effort
    : undefined;
}

/**
 * Paritas thinking varian dengan jalur HTTP ber-key — untuk transport CLI
 * yang tidak punya wire-param reasoning, varian disalurkan sebagai instruksi
 * prompt (pendekatan yang sama dipakai buildSamplingHints di atas).
 * Tanpa effort eksplisit -> '' (tanpa hint).
 */
export function buildThinkingHints(effort: string | undefined): string {
  switch (effort) {
    case 'none':
    case 'minimal':
      return '[thinking]\nJawab LANGSUNG ke intinya tanpa penalaran panjang: hasil akhir saja, ringkas.';
    case 'low':
      return '[thinking]\nBernalarlah ringkas sebelum menjawab; utamakan kecepatan dan jawaban pendek yang tepat.';
    case 'high':
      return '[thinking]\nBernalarlah MENDALAM sebelum menjawab: pertimbangkan alternatif, edge case, dan konsekuensi; jawaban boleh panjang bila perlu.';
    case 'xhigh':
    case 'max':
      return '[thinking]\nBernalarlah SEMAKSIMAL mungkin sebelum menjawab: eksplorasi menyeluruh, verifikasi silang setiap langkah, dan jelaskan alasan kuncinya; kedalaman lebih penting dari kecepatan.';
    case 'medium':
      return '[thinking]\nSeimbangkan penalaran dan ketepatan: bernalar secukupnya sebelum menjawab.';
    default:
      return '';
  }
}

function promptWithFormatHint(
  promptText: string,
  responseFormat: CliCallOptions['responseFormat'],
  /** true bila instruksi fence tools ikut ditempel (hindari perintah ganda). */
  hasTools = false,
): string {
  if (responseFormat?.type !== 'json') return promptText;
  const schema =
    'schema' in responseFormat && responseFormat.schema !== undefined
      ? `\nSkema (ringkas): ${JSON.stringify(responseFormat.schema).slice(0, 4000)}`
      : '';
  if (hasTools) {
    // Tanpa ini dua perintah bertabrakan ("HANYA JSON" vs "pakai fence"):
    // fence menang untuk memanggil, JSON mentah untuk jawaban teks.
    return (
      `${promptText}\n\n[format] Bila memanggil tool, pakai pagar \`\`\`tool_calls ` +
      `di atas (fence lebih utama). Bila tidak memanggil, balas HANYA dengan JSON valid, tanpa teks lain di luar JSON.${schema}`
    );
  }
  return `${promptText}\n\n[format] Balas HANYA dengan JSON valid, tanpa teks lain di luar JSON.${schema}`;
}

// ---------------------------------------------------------------------------
// Tool calling via envelope JSON
//
// CLI tidak mengenal protokol function-call, jadi function tools dijelaskan
// ke model sebagai instruksi + skema, dan model memanggil dengan memancarkan
// blok pagar:
//
// ```tool_calls
// {"tool_calls":[{"name":"<nama-fungsi>","arguments":{...}}]}
// ```
//
// Paritas dengan native (jalur ber-key):
// - SEMUA blok valid dipakai berurutan (multi-fence), seperti beberapa
//   tool-call paralel dalam satu giliran native — bukan hanya blok terakhir.
// - Argumen divalidasi terhadap `inputSchema` masing-masing tool
//   (validateToolCallArgs: required/type/enum/const/additionalProperties;
//   komposit anyOf/oneOf/$ref dilewati konservatif agar tak ada false-reject).
// - Bila model tampak BERUSAHA memanggil (ada pagar/marker) tapi hasilnya
//   tak bisa dieksekusi, CLI dipanggil SEKALI lagi dengan instruksi perbaikan
//   berisi alasan konkret (unknown name, JSON rusak, schema error). Jawaban
//   teks biasa tanpa marker TIDAK di-retry (hemat panggilan).
// - Tanpa blok yang valid = teks biasa. Bila `toolChoice` = none, envelope
//   diabaikan.
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
    'You are a SINGLE-TURN function-calling language model, NOT an autonomous coding agent.',
    'Do NOT use your built-in file/shell/workspace tools for these functions and do NOT read the local workspace — the harness owns execution.',
    'Kamu adalah model function-calling SATU giliran; JANGAN pakai tools bawaan untuk fungsi di bawah — pakai pagar fence, bukan tools bawaan.',
    'To use a tool, print fenced block(s) holding your call(s) — one block may carry several calls, or emit one block per call:',
    '```tool_calls',
    '{"tool_calls":[{"name":"<function-name>","arguments":{...}}]}',
    '```',
    'Example: ```tool_calls',
    '{"tool_calls":[{"name":"my_tool","arguments":{"q":"hello"}}]}',
    '```',
    'The harness executes each call and returns the result(s) to you as a follow-up message; then continue.',
    'Harness mengeksekusi tiap panggilan dan mengembalikan hasilnya sebagai pesan lanjutan; lalu lanjutkan.',
    'Rules / Aturan:',
    '- These functions ARE available to you right now via the harness — use the fence, not your built-in tools, for them.',
    '- Fungsi-fungsi ini TERSEDIA sekarang via harness — pakai fence untuknya.',
    '- "arguments" MUST be a JSON object matching the function parameters.',
    '- Emit the fence ONLY when you actually need one or more calls.',
    required
      ? `- You MUST emit a call to "${required}" on this turn (plain text alone is not acceptable).`
      : '- When no call is needed, answer in plain text WITHOUT any fence.',
    'Available functions:',
    ...tools.map(
      (t) =>
        `- ${t.name}: ${(t.description ?? '(no description)').trim() || '(no description)'} Parameters: ${JSON.stringify(t.inputSchema ?? {})}`,
    ),
  ];
  return lines.join('\n');
}

function coerceArgs(value: unknown): Record<string, unknown> | null {
  let args: unknown = value ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return null;
    }
  }
  return isRecord(args) ? args : null;
}

// ---------------------------------------------------------------------------
// Validasi argumen terhadap inputSchema (paritas validasi server-side native)
// ---------------------------------------------------------------------------

/** Batas rekursi validasi agar skema patologis tak merambat dalam. */
const SCHEMA_VALIDATION_MAX_DEPTH = 6;

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualJson(item, (b as unknown[])[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqualJson(a[k], b[k]));
  }
  return false;
}

function jsonTypeMatches(type: unknown, value: unknown): boolean {
  const check = (t: string): boolean => {
    switch (t) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      case 'object':
        return isRecord(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  };
  if (typeof type === 'string') return check(type);
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && check(t));
  return true;
}

function isObjectLike(schema: Record<string, unknown>): boolean {
  const type = schema.type;
  if (type === 'object') return true;
  if (Array.isArray(type) && (type as unknown[]).includes('object')) return true;
  return (
    type === undefined &&
    (isRecord(schema.properties) ||
      Array.isArray(schema.required) ||
      schema.additionalProperties === false)
  );
}

function validateAgainstSchema(
  schema: unknown,
  value: unknown,
  path: string,
  depth: number,
): string[] {
  if (!isRecord(schema) || depth > SCHEMA_VALIDATION_MAX_DEPTH) return [];
  // Kata kunci komposit tak bisa dinilai konservatif (risiko false-reject) → lolos.
  if (
    'anyOf' in schema ||
    'oneOf' in schema ||
    'allOf' in schema ||
    '$ref' in schema ||
    'not' in schema ||
    'if' in schema
  ) {
    return [];
  }
  const errors: string[] = [];
  const rec = schema as Record<string, unknown>;
  if (rec.type !== undefined && !jsonTypeMatches(rec.type, value)) {
    const want = Array.isArray(rec.type) ? (rec.type as unknown[]).join('/') : String(rec.type);
    errors.push(`${path} harus bertipe ${want}`);
    return errors;
  }
  if (isObjectLike(rec) && isRecord(value)) {
    const required = rec.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in value)) {
          errors.push(`${path}.${key} wajib diisi`);
        }
      }
    }
    const props = rec.properties;
    if (isRecord(props)) {
      for (const [key, sub] of Object.entries(props)) {
        if (key in value) {
          errors.push(
            ...validateAgainstSchema(
              sub,
              (value as Record<string, unknown>)[key],
              `${path}.${key}`,
              depth + 1,
            ),
          );
        }
      }
      if (rec.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(props, key)) {
            errors.push(`${path}.${key} tidak dikenal oleh skema`);
          }
        }
      }
    }
  }
  if (Array.isArray(value) && isRecord(rec.items)) {
    value.forEach((item, i) => {
      errors.push(...validateAgainstSchema(rec.items, item, `${path}[${i}]`, depth + 1));
    });
  }
  if (Array.isArray(rec.enum) && !rec.enum.some((e) => deepEqualJson(e, value))) {
    errors.push(`${path} harus salah satu dari ${JSON.stringify(rec.enum).slice(0, 200)}`);
  }
  if ('const' in rec && !deepEqualJson(rec.const, value)) {
    errors.push(`${path} harus ${JSON.stringify(rec.const).slice(0, 200)}`);
  }
  return errors;
}

/**
 * Validasi argumen tool_call terhadap `inputSchema` tool (JSON Schema).
 * Konservatif seperti validasi server-side native: hanya menolak pelanggaran
 * yang jelas (required/type/enum/const/additionalProperties:false); kata
 * kunci yang tak bisa dinilai aman dilewati. Murni (aman untuk client bundle).
 */
export function validateToolCallArgs(schema: unknown, args: Record<string, unknown>): string[] {
  if (!isRecord(schema)) return [];
  return validateAgainstSchema(schema, args, 'arguments', 0);
}

export interface ValidatedToolCalls extends ParsedToolCalls {
  /**
   * true bila model tampak BERUSAHA memanggil (ada pagar/marker tool_calls,
   * atau toolChoice mewajibkan panggilan) — pembeda antara "jawaban teks
   * biasa" (jangan retry) dan "upaya call yang gagal parse" (layak repair).
   */
  attempted: boolean;
  /** Alasan konkret tiap kegagalan (nama asing, JSON rusak, schema error). */
  diagnostics: string[];
}

/**
 * Ekstrak envelope tool_calls dari teks output CLI. SEMUA blok valid dipakai
 * berurutan (paritas beberapa tool-call paralel native dalam satu giliran);
 * teks sebelum blok PERTAMA menjadi leadingText. Argumen divalidasi terhadap
 * inputSchema tiap tool; panggilan tak valid dicatat di diagnostics dan TIDAK
 * dieksekusi (native menolaknya server-side). Selalu mengembalikan objek
 * (calls kosong bila tak ada panggilan valid — diperlakukan sebagai teks).
 */
export function parseAndValidateToolCalls(
  text: string,
  tools: CliFunctionToolDef[],
  treatStrayMarkerAsAttempt = true,
): ValidatedToolCalls {
  const allowedNames = new Set(tools.map((t) => t.name));
  const schemas = new Map(tools.map((t) => [t.name, t.inputSchema]));
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
  const attempted =
    candidates.length > 0 || (treatStrayMarkerAsAttempt && text.includes('"tool_calls"'));
  const calls: CliToolCallRequest[] = [];
  const diagnostics: string[] = [];
  let firstStart: number | null = null;
  if (candidates.length === 0) return { leadingText: '', calls, attempted, diagnostics };
  let blockNo = 0;
  for (const { raw, start } of candidates) {
    blockNo += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      diagnostics.push(`blok pagar ke-${blockNo} bukan JSON valid`);
      continue;
    }
    const list =
      isRecord(parsed) && Array.isArray((parsed as { tool_calls?: unknown }).tool_calls)
        ? ((parsed as { tool_calls?: unknown }).tool_calls as unknown[])
        : null;
    if (!list) {
      diagnostics.push('blok pagar tidak berisi array "tool_calls"');
      continue;
    }
    let blockValid = false;
    for (const item of list) {
      if (!isRecord(item) || typeof item.name !== 'string') continue;
      const name = item.name.trim();
      if (!name || !allowedNames.has(name)) {
        if (name) diagnostics.push(`tool "${name}" tidak terdaftar`);
        continue;
      }
      const args = coerceArgs((item as { arguments?: unknown }).arguments);
      if (!args) {
        diagnostics.push(`arguments untuk "${name}" bukan objek JSON`);
        continue;
      }
      const schemaErrors = validateToolCallArgs(schemas.get(name), args);
      if (schemaErrors.length > 0) {
        diagnostics.push(`arguments "${name}" tak sesuai skema: ${schemaErrors.join('; ')}`);
        continue;
      }
      if (firstStart === null) firstStart = start;
      blockValid = true;
      calls.push({ name, args });
    }
    if (!blockValid && list.length > 0) {
      diagnostics.push('satu blok pagar tidak menghasilkan panggilan valid');
    }
  }
  return {
    leadingText: firstStart !== null && firstStart > 0 ? text.slice(0, firstStart).trim() : '',
    calls,
    attempted,
    diagnostics,
  };
}

/**
 * Ekstrak envelope tool_calls (kompatibel lama): seperti
 * parseAndValidateToolCalls tanpa validasi skema dan tanpa diagnostik.
 */
export function parseToolCallsFromText(
  text: string,
  allowedNames: Set<string>,
): ParsedToolCalls | null {
  const tools = [...allowedNames].map((name) => ({ name }));
  const parsed = parseAndValidateToolCalls(
    text,
    tools.map((t) => ({ ...t, inputSchema: undefined })),
    false,
  );
  if (parsed.calls.length === 0) return null;
  return { leadingText: parsed.leadingText, calls: parsed.calls };
}

/** Instruksi perbaikan satu-shot: alasan konkret + format yang dituntut. */
export function buildToolCallRepairInstructions(reasons: string[]): string {
  const capped = reasons.slice(0, 5).map((r) => (r.length > 200 ? `${r.slice(0, 197)}…` : r));
  return [
    '[tool-repair] Your previous response attempted tool call(s) but NONE could be executed:',
    ...capped.map((r) => `- ${r}`),
    'Print EXACTLY ONE ```tool_calls fenced block with the corrected call(s):',
    '```tool_calls',
    '{"tool_calls":[{"name":"<registered-function-name>","arguments":{...}}]}',
    '```',
    '"arguments" MUST be a JSON object matching the function Parameters above. Emit only the fence (a short leading sentence is allowed).',
  ].join('\n');
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

/** Prompt stdin: flatten + hint sampling + hint thinking + instruksi tools (bila ada) + hint format. */
function buildCliPrompt(
  options: CliCallOptions,
  cli?: { modelId: string; cliProvider: string },
): {
  promptText: string;
  funcTools: CliFunctionToolDef[];
} {
  const funcTools = functionToolDefs(options);
  const allowCalls = toolCallsAllowed(options.toolChoice);
  const withTools = funcTools.length > 0 && allowCalls;
  let promptText = flattenPromptToText(options.prompt);
  const sampling = buildSamplingHints(options);
  if (sampling) promptText += `\n\n${sampling}`;
  // Varian natif (`#variant`) sudah mengatur reasoning di sisi CLI — hint
  // prompt hanya untuk model tanpa varian natif (agar tak ganda).
  const effort = cliThinkingEffort(options);
  const native = cli ? cliNativeVariant(cli.modelId, cli.cliProvider, effort) : undefined;
  const thinking = buildThinkingHints(native ? undefined : effort);
  if (thinking) promptText += `\n\n${thinking}`;
  if (withTools) {
    promptText += `\n\n${buildToolCallingInstructions(funcTools, options.toolChoice)}`;
  }
  return {
    promptText: promptWithFormatHint(promptText, options.responseFormat, withTools),
    funcTools: withTools ? funcTools : [],
  };
}

/**
 * Jalankan CLI + parse envelope, dengan SEKALI repair bila model tampak
 * berusaha memanggil tapi hasilnya tak bisa dieksekusi (nama asing, JSON
 * rusak, argumen tak sesuai skema) — paritas kegagalan validasi server-side
 * native yang dikembalikan ke model. Jawaban teks biasa tanpa marker TIDAK
 * di-retry. Hasil repair dipakai apa adanya (gagal lagi = fallback teks,
 * sama seperti sebelumnya).
 */
async function runCliWithToolRepair(input: {
  modelId: string;
  cliProvider: string;
  basePromptText: string;
  funcTools: CliFunctionToolDef[];
  requiredTool: string | null;
  treatStrayMarkerAsAttempt: boolean;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  variant?: string;
}): Promise<{
  promptText: string;
  stoppedText: string;
  leadingText: string;
  calls: CliToolCallRequest[];
  repaired: boolean;
}> {
  const runOnce = (promptText: string) =>
    runOpencodeCli({
      modelId: input.modelId,
      cliProvider: input.cliProvider,
      promptText,
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs,
      variant: input.variant,
    });
  const parseOnce = (rawText: string) => {
    const stoppedText = applyStopSequences(rawText, input.stopSequences);
    const parsed = parseAndValidateToolCalls(
      stoppedText,
      input.funcTools,
      input.treatStrayMarkerAsAttempt,
    );
    return { stoppedText, parsed };
  };
  const first = await runOnce(input.basePromptText);
  const firstParsed = parseOnce(first.text);
  if (firstParsed.parsed.calls.length > 0) {
    return {
      promptText: input.basePromptText,
      stoppedText: firstParsed.stoppedText,
      leadingText: firstParsed.parsed.leadingText,
      calls: firstParsed.parsed.calls,
      repaired: false,
    };
  }
  const needsCall = input.requiredTool !== null;
  if (!firstParsed.parsed.attempted && !needsCall) {
    return {
      promptText: input.basePromptText,
      stoppedText: firstParsed.stoppedText,
      leadingText: '',
      calls: [],
      repaired: false,
    };
  }
  const reasons =
    firstParsed.parsed.diagnostics.length > 0
      ? firstParsed.parsed.diagnostics
      : needsCall
        ? [`tool "${input.requiredTool}" wajib dipanggil pada giliran ini`]
        : ['respons tidak mengandung blok ```tool_calls yang valid'];
  const repairPrompt = `${input.basePromptText}\n\n${buildToolCallRepairInstructions(reasons)}`;
  const second = await runOnce(repairPrompt);
  const secondParsed = parseOnce(second.text);
  return {
    promptText: repairPrompt,
    stoppedText: secondParsed.stoppedText,
    leadingText: secondParsed.parsed.leadingText,
    calls: secondParsed.parsed.calls,
    repaired: true,
  };
}

type V3Usage = {
  inputTokens: {
    total: number | undefined;
    noCache: number | undefined;
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
  };
  outputTokens: {
    total: number | undefined;
    text: number | undefined;
    reasoning: number | undefined;
  };
};

type V3FinishReason = {
  unified: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';
  raw: string | undefined;
};

function v3UsageFor(inputText: string, outputText: string): V3Usage {
  const input = estimateTokens(inputText);
  const output = estimateTokens(outputText);
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

function v3Finish(unified: V3FinishReason['unified']): V3FinishReason {
  return { unified, raw: unified };
}

/**
 * Model `opencode:*` / `opencode-go:*` untuk AI SDK. `provider`/`modelId`
 * mengikuti konvensi registry agar logging + usage-meta OpenMAIC tetap benar.
 * Di-cast ke `LanguageModel` di batas modul (providers.ts) agar tidak menambah
 * dependensi `@ai-sdk/provider`.
 */
export class OpencodeCliLanguageModel {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};
  private readonly cliProvider: string;

  constructor(modelId: string, cliProvider = 'opencode') {
    this.modelId = modelId;
    this.cliProvider = cliProvider;
    this.provider = cliProvider;
  }

  async doGenerate(options: CliCallOptions): Promise<{
    content: Array<CliContentPart>;
    finishReason: V3FinishReason;
    usage: V3Usage;
    warnings: CliWarning[];
  }> {
    const cliRef = { modelId: this.modelId, cliProvider: this.cliProvider };
    const variant = cliNativeVariant(this.modelId, this.cliProvider, cliThinkingEffort(options));
    const { promptText, funcTools } = buildCliPrompt(options, cliRef);
    if (funcTools.length > 0) {
      const resolved = await runCliWithToolRepair({
        modelId: this.modelId,
        cliProvider: this.cliProvider,
        basePromptText: promptText,
        funcTools,
        requiredTool: requiredToolName(options.toolChoice),
        treatStrayMarkerAsAttempt: options.responseFormat?.type !== 'json',
        stopSequences: options.stopSequences,
        abortSignal: options.abortSignal,
        variant,
      });
      if (resolved.calls.length > 0) {
        const content: CliContentPart[] = [];
        if (resolved.leadingText) content.push({ type: 'text', text: resolved.leadingText });
        for (const call of resolved.calls) {
          content.push({
            type: 'tool-call',
            toolCallId: nextToolCallId(),
            toolName: call.name,
            input: JSON.stringify(call.args),
          });
        }
        return {
          content,
          finishReason: v3Finish('tool-calls'),
          usage: v3UsageFor(resolved.promptText, resolved.stoppedText),
          warnings: buildCliWarnings(options),
        };
      }
      return {
        content: [{ type: 'text', text: resolved.stoppedText }],
        finishReason: v3Finish('stop'),
        usage: v3UsageFor(resolved.promptText, resolved.stoppedText),
        warnings: buildCliWarnings(options),
      };
    }
    const result = await runOpencodeCli({
      modelId: this.modelId,
      cliProvider: this.cliProvider,
      promptText,
      abortSignal: options.abortSignal,
      variant,
    });
    const stoppedText = applyStopSequences(result.text, options.stopSequences);
    return {
      content: [{ type: 'text', text: stoppedText }],
      finishReason: v3Finish('stop'),
      usage: v3UsageFor(promptText, stoppedText),
      warnings: buildCliWarnings(options),
    };
  }

  async doStream(options: CliCallOptions): Promise<{
    stream: ReadableStream<Record<string, unknown>>;
  }> {
    const warnings = buildCliWarnings(options);
    const variant = cliNativeVariant(this.modelId, this.cliProvider, cliThinkingEffort(options));
    const { promptText, funcTools } = buildCliPrompt(options, {
      modelId: this.modelId,
      cliProvider: this.cliProvider,
    });
    const stopSequences = options.stopSequences;
    const modelId = this.modelId;
    const cliProvider = this.cliProvider;
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
            let collected = '';
            let emitted = 0;
            let stopped = false;
            await runOpencodeCli({
              modelId,
              cliProvider,
              promptText,
              abortSignal: options.abortSignal,
              variant,
              onTextDelta: (delta) => {
                if (stopped) return;
                collected += delta;
                // Paritas stopSequences live: pancarkan hanya sampai sekuens setop.
                if (stopSequences && stopSequences.length > 0) {
                  const cut = applyStopSequences(collected, stopSequences);
                  if (cut.length < collected.length) {
                    const fresh = cut.slice(emitted);
                    if (fresh) controller.enqueue({ type: 'text-delta', id: textId, delta: fresh });
                    emitted = cut.length;
                    collected = cut;
                    stopped = true;
                    return;
                  }
                }
                controller.enqueue({ type: 'text-delta', id: textId, delta });
                emitted += delta.length;
              },
            });
            controller.enqueue({ type: 'text-end', id: textId });
            const finalText = applyStopSequences(collected, stopSequences);
            controller.enqueue({
              type: 'finish',
              finishReason: v3Finish('stop'),
              usage: v3UsageFor(promptText, finalText),
            });
          } else {
            const resolved = await runCliWithToolRepair({
              modelId,
              cliProvider,
              basePromptText: promptText,
              funcTools,
              requiredTool: requiredToolName(options.toolChoice),
              treatStrayMarkerAsAttempt: options.responseFormat?.type !== 'json',
              stopSequences,
              abortSignal: options.abortSignal,
              variant,
            });
            const stoppedText = resolved.stoppedText;
            if (resolved.calls.length > 0) {
              if (resolved.leadingText) {
                controller.enqueue({ type: 'text-start', id: textId });
                controller.enqueue({ type: 'text-delta', id: textId, delta: resolved.leadingText });
                controller.enqueue({ type: 'text-end', id: textId });
              }
              for (const call of resolved.calls) {
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
              controller.enqueue({
                type: 'finish',
                finishReason: v3Finish('tool-calls'),
                usage: v3UsageFor(resolved.promptText, stoppedText),
              });
            } else {
              controller.enqueue({ type: 'text-start', id: textId });
              controller.enqueue({ type: 'text-delta', id: textId, delta: stoppedText });
              controller.enqueue({ type: 'text-end', id: textId });
              controller.enqueue({
                type: 'finish',
                finishReason: v3Finish('stop'),
                usage: v3UsageFor(resolved.promptText, stoppedText),
              });
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
export function createOpencodeCliModel(modelId: string, providerId = 'opencode'): LanguageModel {
  return new OpencodeCliLanguageModel(modelId, providerId) as unknown as LanguageModel;
}
