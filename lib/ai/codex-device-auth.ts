/**
 * Device-code login flow for the local Codex CLI (`codex login --device-auth`).
 *
 * The CLI prints a URL + one-time code, then blocks until the user completes
 * the flow in their browser. We spawn it once, capture the printed URL/code,
 * and let the caller poll for completion.
 *
 * Server-side only.
 */
import { spawn, type ChildProcess } from 'node:child_process';

import { resolveCodexShim } from './codex-auth';

const URL_RE = /https:\/\/\S+/;
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{5,})\b/;

interface ActiveSession {
  child: ChildProcess;
  output: string;
  url: string | null;
  code: string | null;
  done: boolean;
  exitCode: number | null;
  error: string | null;
  promise: Promise<void>;
}

let active: ActiveSession | null = null;

function parseOutput(output: string): { url: string | null; code: string | null } {
  const urlMatch = output.match(URL_RE);
  const codeMatch = output.match(CODE_RE);
  return {
    url: urlMatch ? urlMatch[0].replace(/[)\].,]+$/, '') : null,
    code: codeMatch ? codeMatch[1] : null,
  };
}

export interface DeviceAuthStartResult {
  ok: boolean;
  url: string | null;
  code: string | null;
  message: string;
  alreadyRunning: boolean;
}

export async function codexDeviceAuthStart(): Promise<DeviceAuthStartResult> {
  if (active && !active.done) {
    const parsed = parseOutput(active.output);
    return {
      ok: true,
      url: parsed.url ?? active.url,
      code: parsed.code ?? active.code,
      message: 'Device login already in progress.',
      alreadyRunning: true,
    };
  }

  const shim = resolveCodexShim();
  if (!shim) {
    return {
      ok: false,
      url: null,
      code: null,
      message: 'Codex CLI is not installed.',
      alreadyRunning: false,
    };
  }

  const child = spawn(process.execPath, [shim, 'login', '--device-auth'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const session: ActiveSession = {
    child,
    output: '',
    url: null,
    code: null,
    done: false,
    exitCode: null,
    error: null,
    promise: Promise.resolve(),
  };

  session.promise = new Promise<void>((resolve) => {
    const collect = (chunk: Buffer) => {
      session.output += chunk.toString();
      const parsed = parseOutput(session.output);
      if (parsed.url) session.url = parsed.url;
      if (parsed.code) session.code = parsed.code;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
      session.error = err.message;
      session.done = true;
      session.exitCode = 1;
      resolve();
    });
    child.on('close', (code) => {
      session.done = true;
      session.exitCode = code ?? 1;
      resolve();
    });
  });

  active = session;

  // Wait briefly for the URL + code to be printed.
  await new Promise<void>((resolve) => {
    const start = Date.now();
    const check = () => {
      const parsed = parseOutput(session.output);
      if (parsed.url && parsed.code) return resolve();
      if (session.done) return resolve();
      if (Date.now() - start > 10_000) return resolve();
      setTimeout(check, 100);
    };
    check();
  });

  const parsed = parseOutput(session.output);
  session.url = parsed.url;
  session.code = parsed.code;

  return {
    ok: Boolean(parsed.url && parsed.code),
    url: parsed.url,
    code: parsed.code,
    message:
      parsed.url && parsed.code
        ? 'Open the link and enter the code.'
        : session.output.trim() || 'Starting device login…',
    alreadyRunning: false,
  };
}

export interface DeviceAuthPollResult {
  status: 'pending' | 'success' | 'failed' | 'none';
  message: string;
  url: string | null;
  code: string | null;
}

export function codexDeviceAuthPoll(): DeviceAuthPollResult {
  if (!active) {
    return { status: 'none', message: 'No device login in progress.', url: null, code: null };
  }
  const parsed = parseOutput(active.output);
  const url = parsed.url ?? active.url;
  const code = parsed.code ?? active.code;
  if (!active.done) {
    return {
      status: 'pending',
      message: 'Waiting for you to complete sign-in in the browser.',
      url,
      code,
    };
  }
  if (active.exitCode === 0) {
    active = null;
    return { status: 'success', message: 'Logged in.', url: null, code: null };
  }
  const msg = active.error || active.output.trim() || 'Login failed.';
  active = null;
  return { status: 'failed', message: msg, url: null, code: null };
}

export function codexDeviceAuthCancel(): void {
  if (active && !active.done) {
    try {
      active.child.kill();
    } catch {
      // ignore
    }
  }
  active = null;
}
