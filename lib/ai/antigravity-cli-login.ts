/**
 * Drive `agy`'s interactive login from a Next.js Route Handler.
 *
 * `agy` (no prompt) prints a Google authorization URL and waits for the
 * verification code on stdin. We spawn it once, capture the URL, hand it to
 * the browser, and forward the pasted code back to the same process. Only one
 * login is active at a time.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

interface LoginSession {
  child: ChildProcessWithoutNullStreams;
  output: string;
  url: string | null;
  done: boolean;
  error: string | null;
  codeSubmitted: boolean;
}

let active: LoginSession | null = null;

function extractUrl(text: string): string | null {
  const m = text.match(/https:\/\/accounts\.google\.com\/[^\s]+/);
  return m ? m[0] : null;
}

export function startAntigravityCliLogin(): { sessionId: string; url: string | null; error: string | null } {
  if (active && !active.done) {
    return { sessionId: 'active', url: active.url, error: null };
  }
  const child = spawn('script', ['-q', '-c', 'agy --print "ping" --output-format json', '/dev/null'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session: LoginSession = { child, output: '', url: null, done: false, error: null, codeSubmitted: false };
  active = session;
  const collect = (d: Buffer) => {
    const text = d.toString('utf8');
    session.output += text;
    if (!session.url) session.url = extractUrl(session.output);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('close', (code) => {
    session.done = true;
    if (code !== 0 && !session.codeSubmitted) {
      session.error = session.output.slice(-500) || `agy exited ${code}`;
    }
  });
  child.on('error', (err) => {
    session.done = true;
    session.error = err.message;
  });
  return { sessionId: 'active', url: null, error: null };
}

export function getAntigravityCliLoginStatus(): {
  active: boolean;
  url: string | null;
  done: boolean;
  error: string | null;
  output: string;
} {
  if (!active) return { active: false, url: null, done: true, error: null, output: '' };
  if (!active.url) active.url = extractUrl(active.output);
  return {
    active: !active.done,
    url: active.url,
    done: active.done,
    error: active.error,
    output: active.output.slice(-1000),
  };
}

export function submitAntigravityCliLoginCode(code: string): { ok: boolean; message: string } {
  if (!active || active.done) return { ok: false, message: 'No active login.' };
  try {
    active.child.stdin.write(code.trim() + '\n');
    active.codeSubmitted = true;
    return { ok: true, message: 'Code sent.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function cancelAntigravityCliLogin(): void {
  if (active && !active.done) {
    try { active.child.kill(); } catch {}
  }
  active = null;
}

export async function waitForAntigravityCliLoginUrl(timeoutMs = 8000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!active) return null;
    if (active.url) return active.url;
    if (active.done) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
  return active?.url ?? null;
}
