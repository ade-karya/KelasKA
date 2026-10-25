/**
 * Antigravity CLI auth status.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AntigravityCliAuthStatus {
  bridge: boolean;
  installed: boolean;
  authenticated: boolean;
  message: string;
}

export async function antigravityCliAuthStatus(): Promise<AntigravityCliAuthStatus> {
  const bin = 'agy';
  try {
    await execFileAsync(bin, ['--version'], { timeout: 10_000 });
  } catch {
    return { bridge: true, installed: false, authenticated: false, message: 'Antigravity CLI (agy) is not installed.' };
  }
  try {
    const { stdout } = await execFileAsync(bin, ['models'], { timeout: 30_000 });
    if (/please sign in/i.test(stdout)) {
      return { bridge: true, installed: true, authenticated: false, message: 'Please sign in: run `agy` in your terminal.' };
    }
    return { bridge: true, installed: true, authenticated: true, message: 'Signed in.' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/sign in|authenticat/i.test(msg)) {
      return { bridge: true, installed: true, authenticated: false, message: 'Please sign in: run `agy` in your terminal.' };
    }
    return { bridge: true, installed: true, authenticated: false, message: msg };
  }
}
