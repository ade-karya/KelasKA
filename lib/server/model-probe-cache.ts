/**
 * Short-TTL Redis cache for provider `/models` probe results.
 *
 * Probing walks up to four candidate URLs with a 30s discovery budget
 * (`model-fetch.ts`), and the Settings UI re-probes on every panel visit —
 * pure repeated upstream cost for a list that barely changes. This caches
 * successful probes for ten minutes.
 *
 * Cache discipline, stated explicitly:
 * - only successes are cached; 401/404/timeouts fall through every time so
 *   a bad key or a provider outage is never served stale;
 * - the key binds the base URL, the models-URL override, AND a fingerprint
 *   of the API key: different keys can expose different model lists, and one
 *   tenant's list must never leak to another;
 * - values are small (id + owner per model); a miss refetches upstream, so
 *   eviction or Redis downtime only costs latency.
 */
import { createHash } from 'node:crypto';

import type { FetchedModel } from './model-fetch';
import { REDIS_KEY_PREFIX, isRedisConfigured, redisGet, redisSetex } from './redis';

/** Probe results stay fresh enough for Settings UX without hammering upstream. */
const PROBE_CACHE_TTL_SECONDS = 600;

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function probeCacheKey(
  baseUrl: string,
  modelsUrl: string | undefined,
  apiKey: string,
): string {
  const target = `${baseUrl.trim()}|${modelsUrl?.trim() ?? ''}`;
  const keyFingerprint = apiKey ? fingerprint(apiKey).slice(0, 16) : 'nokey';
  return `${REDIS_KEY_PREFIX}models:${fingerprint(target)}:${keyFingerprint}`;
}

function isFetchedModelList(value: unknown): value is FetchedModel[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === 'string',
    )
  );
}

/** Cached probe result, or `undefined` on miss / Redis unavailable / corrupt. */
export async function getCachedProbeModels(
  baseUrl: string,
  modelsUrl: string | undefined,
  apiKey: string,
): Promise<FetchedModel[] | undefined> {
  if (!isRedisConfigured()) return undefined;
  const raw = await redisGet(probeCacheKey(baseUrl, modelsUrl, apiKey));
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isFetchedModelList(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Cache a successful probe; best-effort, never throws. */
export async function setCachedProbeModels(
  baseUrl: string,
  modelsUrl: string | undefined,
  apiKey: string,
  models: FetchedModel[],
): Promise<void> {
  if (!isRedisConfigured()) return;
  await redisSetex(
    probeCacheKey(baseUrl, modelsUrl, apiKey),
    PROBE_CACHE_TTL_SECONDS,
    JSON.stringify(models),
  );
}
