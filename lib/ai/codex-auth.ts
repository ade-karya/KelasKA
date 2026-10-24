/**
 * Auth helpers for the local Codex CLI, used by the Pro Workbench auth UI.
 *
 * The Codex SDK itself never carries a login flow; authentication lives in the
 * `codex` binary (`codex login --with-api-key` reads the key from stdin and
 * stores it in `~/.codex/auth.json`). These helpers shell out to that binary so
 * the workbench can log in / out / check status without a terminal.
 *
 * Server-side only.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolve the `codex` shim (a Node script) so we don't depend on PATH. */
export function resolveCodexShim(): string | null {
  if (process.env.CODEX_PATH?.trim()) return process.env.CODEX_PATH.trim();
  try {
    const pkgJson = require.resolve('@openai/codex/package.json');
    return pkgJson.replace(/package\.json$/, 'bin/codex.js');
  } catch {
    return null;
  }
}

/** Run a codex subcommand and resolve with its exit code + output. */
export function runCodex(args: string[], stdin?: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const shim = resolveCodexShim();
    const child = shim
      ? spawn(process.execPath, [shim, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

export interface CodexAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  message: string;
}

export async function codexAuthStatus(): Promise<CodexAuthStatus> {
  const shim = resolveCodexShim();
  if (!shim) {
    return { installed: false, loggedIn: false, message: 'Codex CLI is not installed.' };
  }
  const result = await runCodex(['login', 'status']);
  const text = (result.stdout + result.stderr).trim();
  return {
    installed: true,
    loggedIn: result.code === 0,
    message: text || (result.code === 0 ? 'Logged in.' : 'Not logged in.'),
  };
}

export async function codexAuthLogin(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, message: 'API key is required.' };
  const result = await runCodex(['login', '--with-api-key'], `${trimmed}\n`);
  const text = (result.stdout + result.stderr).trim();
  return {
    ok: result.code === 0,
    message: text || (result.code === 0 ? 'Logged in.' : 'Login failed.'),
  };
}

export async function codexAuthLogout(): Promise<{ ok: boolean; message: string }> {
  const result = await runCodex(['logout']);
  const text = (result.stdout + result.stderr).trim();
  return {
    ok: result.code === 0,
    message: text || (result.code === 0 ? 'Logged out.' : 'Logout failed.'),
  };
}
