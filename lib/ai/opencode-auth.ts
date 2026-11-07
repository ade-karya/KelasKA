/**
 * Status and session helpers for the OpenCode Console sign-in.
 *
 * The Pro Workbench used to expose this as a terminal-only step
 * (`opencode auth login`). The auth dialog can now drive it: the CLI owns the
 * credential store, so the app never sees a token — it only asks the CLI
 * whether an account is saved, and starts a device-code login whose URL and
 * one-time code we hand to the browser.
 *
 * Server-side only.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { findOpencodeBin } from './opencode-cli';

const execFileAsync = promisify(execFile);

const STATUS_TIMEOUT_MS = 15_000;
const STATUS_CACHE_TTL_MS = 10_000;

export interface OpencodeAuthStatus {
  installed: boolean;
  authenticated: boolean;
  message: string;
}

interface OpencodeListIntegration {
  id?: string;
  name?: string;
  connections?: Array<{ id?: string; label?: string; type?: string }>;
}

let cache: { at: number; status: OpencodeAuthStatus } | null = null;

export function invalidateOpencodeAuthCache(): void {
  cache = null;
}

export async function opencodeAuthStatus(): Promise<OpencodeAuthStatus> {
  if (cache && Date.now() - cache.at < STATUS_CACHE_TTL_MS) return cache.status;

  const bin = await findOpencodeBin();
  if (!bin) {
    return {
      installed: false,
      authenticated: false,
      message: 'OpenCode CLI belum terpasang di server.',
    };
  }

  try {
    const { stdout } = await execFileAsync(
      bin,
      ['auth', 'list', '--standalone', '--format', 'json'],
      { timeout: STATUS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as unknown;
    const list = Array.isArray(parsed) ? (parsed as OpencodeListIntegration[]) : [];
    const entry = list.find((item) => item?.id === 'opencode');
    const connections = Array.isArray(entry?.connections) ? entry.connections : [];
    const status: OpencodeAuthStatus =
      connections.length > 0
        ? {
            installed: true,
            authenticated: true,
            message: `OpenCode Console terhubung${
              connections.length > 1 ? ` (${connections.length} akun)` : ''
            }.`,
          }
        : {
            installed: true,
            authenticated: false,
            message: 'Belum ada akun OpenCode Console yang tersimpan.',
          };
    cache = { at: Date.now(), status };
    return status;
  } catch (error) {
    return {
      installed: true,
      authenticated: false,
      message: error instanceof Error ? error.message : 'Status OpenCode Console gagal dibaca.',
    };
  }
}
