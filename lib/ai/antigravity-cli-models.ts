import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AntigravityDiscoveredModel {
  id: string;
  displayName: string;
}

let cache: { at: number; models: AntigravityDiscoveredModel[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function invalidateAntigravityModelCache(): void {
  cache = null;
}

export async function listAntigravityModels(force = false): Promise<AntigravityDiscoveredModel[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;

  try {
    const { stdout } = await execFileAsync('agy', ['models'], { timeout: 30_000 });
    const models: AntigravityDiscoveredModel[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // format: "<id>\t<name>" or "<id>  <name>"
      const parts = trimmed.split(/\t|\s{2,}/);
      if (parts.length < 1) continue;
      const id = parts[0].trim();
      if (!id || /fetching|available models/i.test(id)) continue;
      const name = parts.slice(1).join(' ').trim() || id;
      models.push({ id, displayName: name });
    }
    cache = { at: Date.now(), models };
    return models;
  } catch {
    return cache?.models ?? [];
  }
}
