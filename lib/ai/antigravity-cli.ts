/**
 * Antigravity CLI execution bridge (replaces the Python SDK).
 *
 * Transport: `agy --print --output-format json --json-schema <schema> --model <m>
 * --effort <e> --dangerously-skip-permissions -p <prompt>`. The CLI prints a
 * single JSON envelope on stdout:
 *
 *   { "conversation_id", "status", "response", "num_turns",
 *     "duration_seconds", "usage": {input_tokens, output_tokens, ...},
 *     "structured_output": { "text", "toolCalls": [...] } }
 *
 * `structured_output` is populated when `--json-schema` is given. We parse it
 * into the same `{text, toolCalls}` contract the OpenMAIC harness expects.
 *
 * Auth is handled by `agy` itself (system keyring / Google Sign-In); OpenMAIC
 * only checks availability via `agy --version` and triggers login.
 */

import type { ChildProcess } from 'node:child_process';

export const ANTIGRAVITY_CLI_DEFAULT_TIMEOUT_MS = 900_000;

const STDERR_TAIL_CHARS = 4_000;

function cliTimeoutMs(): number {
  const raw = Number.parseInt(process.env.ANTIGRAVITY_CLI_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return ANTIGRAVITY_CLI_DEFAULT_TIMEOUT_MS;
}

let cachedBin: string | null | undefined;

async function loadNodeBuiltins(): Promise<{
  spawn: typeof import('node:child_process').spawn;
  fs: typeof import('node:fs');
  os: typeof import('node:os');
  path: typeof import('node:path');
}> {
  const [childProcess, fs, os, path] = await Promise.all([
    import(/* webpackIgnore: true */ 'node:child_process'),
    import(/* webpackIgnore: true */ 'node:fs'),
    import(/* webpackIgnore: true */ 'node:os'),
    import(/* webpackIgnore: true */ 'node:path'),
  ]);
  return { spawn: childProcess.spawn, fs, os, path };
}

async function binCandidates(): Promise<string[]> {
  const fromEnv = (process.env.ANTIGRAVITY_CLI_BIN ?? process.env.AGY_BIN ?? '').trim();
  const { path } = await loadNodeBuiltins();
  const home = (await (async () => {
    const { os } = await loadNodeBuiltins();
    return os.homedir();
  })());
  return [
    ...(fromEnv ? [fromEnv] : []),
    'agy',
    'antigravity',
    path.join(home, '.local', 'bin', 'agy'),
    path.join(home, 'bin', 'agy'),
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
      try { child.kill(); } catch {}
      resolve(false);
    }, 10_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function findAntigravityCliBin(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin;
  const { fs } = await loadNodeBuiltins();
  for (const cand of await binCandidates()) {
    if (cand.includes('/') && !fs.existsSync(cand)) continue;
    if (await probeBin(cand)) { cachedBin = cand; return cachedBin; }
  }
  cachedBin = null;
  return null;
}

export interface AntigravityCliTurnRequest {
  prompt: string;
  systemInstructions: string;
  responseSchema: Record<string, unknown>;
  model: string;
  thinkingLevel?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AntigravityCliTurnResult {
  text: string;
  toolCalls: { name: string; arguments: Record<string, unknown> }[];
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number } | null;
}

function effortToAgy(effort?: string): string | undefined {
  if (!effort || effort === 'none' || effort === 'minimal') return undefined;
  if (effort === 'max') return 'max';
  if (effort === 'xhigh') return 'xhigh';
  if (['low', 'medium', 'high'].includes(effort)) return effort;
  return undefined;
}

export async function runAntigravityCliTurn(req: AntigravityCliTurnRequest): Promise<AntigravityCliTurnResult> {
  const bin = await findAntigravityCliBin();
  if (!bin) throw new Error('Antigravity CLI (agy) is not installed or not on PATH.');

  const { spawn } = await loadNodeBuiltins();
  const { fs, os, path } = await loadNodeBuiltins();
  const timeoutMs = req.timeoutMs ?? cliTimeoutMs();

  // Write the JSON schema to a temp file to avoid arg length limits.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  const schemaFile = path.join(tmpDir, 'schema.json');
  fs.writeFileSync(schemaFile, JSON.stringify(req.responseSchema));

  const prompt = `${req.systemInstructions}\n\n${req.prompt}`;
  const effort = effortToAgy(req.thinkingLevel);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, [
      '--print', prompt,
      '--output-format', 'json',
      '--json-schema', schemaFile,
      '--model', req.model,
      '--dangerously-skip-permissions',
      ...(effort ? ['--effort', effort] : []),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Antigravity CLI timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < STDERR_TAIL_CHARS) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Antigravity CLI exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      let envelope: any;
      try {
        envelope = JSON.parse(stdout.trim());
      } catch (e) {
        reject(new Error(`Antigravity CLI returned non-JSON output: ${stdout.slice(0, 300)}`));
        return;
      }
      const structured = envelope.structured_output ?? envelope.structured ?? null;
      const text = (structured && typeof structured.text === 'string')
        ? structured.text
        : (typeof envelope.response === 'string' ? envelope.response : '');
      const rawCalls = (structured && Array.isArray(structured.toolCalls)) ? structured.toolCalls : [];
      const toolCalls = rawCalls.map((c: any) => ({
        name: String(c?.name ?? ''),
        arguments: (c?.arguments && typeof c.arguments === 'object') ? c.arguments : {},
      }));
      const usage = envelope.usage
        ? {
            promptTokenCount: envelope.usage.input_tokens ?? envelope.usage.inputTokens,
            candidatesTokenCount: envelope.usage.output_tokens ?? envelope.usage.outputTokens,
            thoughtsTokenCount: envelope.usage.thinking_tokens,
            cachedContentTokenCount: envelope.usage.cache_read_tokens,
          }
        : null;
      resolve({ text, toolCalls, usage });
    });
  });
}

export async function antigravityCliAvailable(): Promise<boolean> {
  return (await findAntigravityCliBin()) !== null;
}
