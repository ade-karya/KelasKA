/**
 * Auth helpers for the local Codex CLI, used by the Pro Workbench auth UI.
 */
import { spawn } from 'node:child_process';

import { resolveCodexBinary } from './codex-sdk';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCodex(args: string[], stdin?: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const binary = resolveCodexBinary();
    const child = binary
      ? spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
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
  const binary = resolveCodexBinary();
  if (!binary) {
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
