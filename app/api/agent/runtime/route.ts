/**
 * Server-side agent runtime status probe.
 *
 *   GET /api/agent/runtime -> { enabled, runtimeEnabled, opencode }
 *
 * `enabled` reports usability, not intent: the workbench client gates its
 * entry on this field, so it is true only when the runtime can actually serve
 * a request — the flag AND a `DATABASE_URL` (the runner and every
 * persistence-touching route need the store). `runtimeEnabled` carries the
 * raw intent flag so a client can tell "off by choice" (`runtimeEnabled:
 * false`) from "on but unusable" (`runtimeEnabled: true`, missing
 * DATABASE_URL). `opencode` is a best-effort same-machine probe (binary
 * presence + version) so the Pro picker can explain a failing
 * `opencode:default` driver route.
 */
import { execFile } from 'node:child_process';
import { isAgentRuntimeConfigured, isAgentRuntimeEnabled } from '@/lib/config/feature-flags';

export const runtime = 'nodejs';

// In-memory cache: the probe spawns a process, so concurrent status polls
// (20-50 workbench users) must not fork-bomb the host. Freshness of one
// minute is plenty for binary presence/version.
const OPENCODE_PROBE_TTL_MS = 60_000;
let cachedOpencodeProbe: { at: number; value: Awaited<ReturnType<typeof probeOpencode>> } | null =
  null;

function probeOpencode(): Promise<{ available: boolean; version: string | null; bin: string | null }> {
  const candidates =
    process.env.OPENCODE_BIN?.trim()
      ? [process.env.OPENCODE_BIN.trim(), 'opencode-cli', 'opencode']
      : ['opencode-cli', 'opencode'];
  const tryBin = (index: number): Promise<{ available: boolean; version: string | null; bin: string | null }> => {
    if (index >= candidates.length) return Promise.resolve({ available: false, version: null, bin: null });
    const bin = candidates[index] as string;
    return new Promise((resolve) => {
      // Generous timeout: a cold opencode binary (first spawn, update check)
      // can take several seconds; this probe is best-effort status only.
      const child = execFile(bin, ['--version'], { timeout: 10000 }, (error, stdout) => {
        if (!error) {
          resolve({ available: true, version: String(stdout).trim().slice(0, 64) || null, bin });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') resolve(tryBin(index + 1));
        else resolve({ available: false, version: null, bin });
      });
      // Defensive: execFile timeout kills the child, but ensure the handle
      // cannot keep the route alive on its own.
      if (typeof (child as unknown as { unref?: () => void }).unref === 'function') {
        (child as unknown as { unref: () => void }).unref();
      }
    });
  };
  return tryBin(0);
}

export async function GET() {
  // Intentionally no materials flag: isAgentMaterialsEnabled does not exist in
  // this repo (the materials routes gate on the runtime, like the stages).
  const now = Date.now();
  if (!cachedOpencodeProbe || now - cachedOpencodeProbe.at > OPENCODE_PROBE_TTL_MS) {
    cachedOpencodeProbe = { at: now, value: await probeOpencode() };
  }
  return Response.json({
    enabled: isAgentRuntimeConfigured(),
    runtimeEnabled: isAgentRuntimeEnabled(),
    opencode: cachedOpencodeProbe.value,
  });
}
