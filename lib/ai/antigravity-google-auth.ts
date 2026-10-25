/**
 * Google-account (Vertex AI / Application Default Credentials) login for the
 * Antigravity SDK transport. Uses `gcloud auth application-default login
 * --no-launch-browser`, which prints a URL and waits for a verification code.
 *
 * Server-side only. State is process-global, which is fine for the single
 * PM2/Bun process OpenMAIC runs in.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { persistAntigravityEnvValue } from '@/lib/ai/antigravity-sdk';

export type GoogleLoginState =
  | { status: 'idle'; url: null; message: string }
  | { status: 'pending'; url: string | null; message: string }
  | { status: 'success'; url: null; message: string }
  | { status: 'failed'; url: null; message: string };

let proc: ChildProcessWithoutNullStreams | null = null;
let url: string | null = null;
let output = '';
let status: GoogleLoginState['status'] = 'idle';
let message = '';
let project: string | null = null;
let location: string | null = null;

const URL_RE = /https:\/\/accounts\.google\.com\/[^\s]+/;

function reset() {
  url = null;
  output = '';
  message = '';
}

export interface GoogleLoginStatus {
  status: 'idle' | 'pending' | 'success' | 'failed';
  url: string | null;
  message: string;
  project: string | null;
  location: string | null;
  loggedIn: boolean;
}

export function googleLoginStatus(): GoogleLoginStatus {
  const loggedIn =
    status === 'success' ||
    (!!process.env.GOOGLE_GENAI_USE_VERTEXAI &&
      !!process.env.GOOGLE_CLOUD_PROJECT &&
      !!process.env.GOOGLE_CLOUD_LOCATION);
  // If a gcloud ADC token already exists, treat as logged in even without a run.
  return {
    status,
    url,
    message: message || (loggedIn ? 'Logged in with Google.' : 'Not logged in.'),
    project: project ?? process.env.GOOGLE_CLOUD_PROJECT ?? null,
    location: location ?? process.env.GOOGLE_CLOUD_LOCATION ?? null,
    loggedIn,
  };
}

export function startGoogleLogin(): GoogleLoginState {
  if (proc && status === 'pending') {
    return { status: 'pending', url, message: message || 'Login in progress…' };
  }
  reset();
  status = 'pending';
  message = 'Starting Google login…';
  try {
    proc = spawn('gcloud', ['auth', 'application-default', 'login', '--no-launch-browser'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    status = 'failed';
    message = error instanceof Error ? error.message : 'Failed to start gcloud.';
    proc = null;
    return { status: 'failed', url: null, message };
  }

  const onData = (chunk: Buffer) => {
    output += chunk.toString('utf8');
    const m = URL_RE.exec(output);
    if (m) url = m[0];
    if (/enter verification code/i.test(output)) {
      message = 'Open the link below and paste the verification code.';
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('error', (error) => {
    status = 'failed';
    message = error instanceof Error ? error.message : 'gcloud failed.';
    proc = null;
  });

  proc.on('close', (code) => {
    const wasSuccess = code === 0;
    if (wasSuccess) {
      status = 'success';
      message = 'Google login successful.';
      // Persist env so the running process and future restarts use Vertex.
      if (project) process.env.GOOGLE_CLOUD_PROJECT = project;
      if (location) process.env.GOOGLE_CLOUD_LOCATION = location;
      process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
      void (async () => {
        try {
          await persistAntigravityEnvValue('GOOGLE_GENAI_USE_VERTEXAI', 'true');
          if (project) await persistAntigravityEnvValue('GOOGLE_CLOUD_PROJECT', project);
          if (location) await persistAntigravityEnvValue('GOOGLE_CLOUD_LOCATION', location);
        } catch {
          // best-effort
        }
      })();
    } else if (status !== 'failed') {
      status = 'failed';
      message = `gcloud exited with code ${code}. ${output.slice(-500)}`.trim();
    }
    proc = null;
  });

  return { status: 'pending', url, message };
}

export function submitGoogleCode(code: string): GoogleLoginState {
  if (!proc || status !== 'pending') {
    return { status: 'failed', url: null, message: 'No login in progress.' };
  }
  const trimmed = code.trim();
  if (!trimmed) return { status: 'pending', url, message: 'Verification code is required.' };
  try {
    proc.stdin.write(trimmed + '\n');
  } catch (error) {
    status = 'failed';
    message = error instanceof Error ? error.message : 'Failed to submit code.';
    return { status: 'failed', url: null, message };
  }
  return { status: 'pending', url, message: 'Verifying…' };
}

export function cancelGoogleLogin(): void {
  if (proc) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
    proc = null;
  }
  status = 'idle';
  reset();
  message = '';
}

export function setGoogleProjectLocation(p: string | null, l: string | null): void {
  project = p?.trim() || null;
  location = l?.trim() || null;
  if (project) process.env.GOOGLE_CLOUD_PROJECT = project;
  if (location) process.env.GOOGLE_CLOUD_LOCATION = location;
}

export async function googleLogout(): Promise<{ ok: boolean; message: string }> {
  cancelGoogleLogin();
  try {
    await new Promise<void>((resolve) => {
      const child = spawn('gcloud', ['auth', 'application-default', 'revoke', '--quiet'], {
        stdio: 'ignore',
      });
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    });
  } catch {
    // ignore
  }
  delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;
  try {
    await persistAntigravityEnvValue('GOOGLE_GENAI_USE_VERTEXAI', null);
    await persistAntigravityEnvValue('GOOGLE_CLOUD_PROJECT', null);
    await persistAntigravityEnvValue('GOOGLE_CLOUD_LOCATION', null);
  } catch {
    // best-effort
  }
  status = 'idle';
  reset();
  return { ok: true, message: 'Google credentials removed.' };
}
