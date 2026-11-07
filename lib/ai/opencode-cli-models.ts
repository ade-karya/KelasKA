/**
 * Live model discovery for the OpenCode CLI (`opencode models`).
 *
 * The output is `<provider>/<id>` per line, where provider is `opencode`
 * (Zen) or `opencode-go`. It is login-aware, which is what lets the Pro
 * Workbench hide models the account cannot actually use. Cached briefly: the
 * command spins up a private server and can take tens of seconds on a cold
 * start.
 *
 * Server-side only.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { findOpencodeBin } from './opencode-cli';

const execFileAsync = promisify(execFile);

const DISCOVER_TIMEOUT_MS = 60_000;
const TTL_MS = 5 * 60 * 1000;

export interface OpencodeDiscoveredModel {
  provider: 'opencode' | 'opencode-go';
  id: string;
}

let cache: { at: number; models: OpencodeDiscoveredModel[] } | null = null;

export function invalidateOpencodeModelCache(): void {
  cache = null;
}

/**
 * Live model list, or the stale cache when the CLI fails, or [] when
 * discovery has never succeeded. Callers treat [] as "nothing usable".
 */
export async function listOpencodeModels(force = false): Promise<OpencodeDiscoveredModel[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;

  const bin = await findOpencodeBin();
  if (!bin) return cache?.models ?? [];

  try {
    const { stdout } = await execFileAsync(bin, ['models', '--standalone'], {
      timeout: DISCOVER_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const models: OpencodeDiscoveredModel[] = [];
    const seen = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.trim().match(/^(opencode|opencode-go)\/(.+)$/);
      if (!match) continue;
      const id = match[2].trim();
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) continue;
      const key = `${match[1]}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      models.push({ provider: match[1] as 'opencode' | 'opencode-go', id });
    }
    cache = { at: Date.now(), models };
    return models;
  } catch {
    return cache?.models ?? [];
  }
}
