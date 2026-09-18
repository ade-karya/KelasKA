/**
 * Optional Upstash Redis (REST) accelerator for serverless deployments.
 *
 * Redis here is strictly an accelerator, never a source of truth:
 * - wakeup signals (lossy; the PostgreSQL log stays authoritative),
 * - a global access-code attempt counter (the in-process limiter stays),
 * - a short-TTL model-list cache (a miss refetches upstream).
 *
 * Every helper degrades to "unavailable" (`undefined`/`false`) on any
 * failure — missing env, timeout, network error, unsupported command — so a
 * Redis outage or a missing configuration never breaks request traffic.
 * Callers always keep their existing non-Redis path as the fallback.
 *
 * The REST client (HTTPS, no persistent connection) is chosen deliberately:
 * a TCP client would open a connection per serverless invocation and freeze
 * with the function, while REST works frozen, thawed, and from the Edge.
 * Credentials come from the Upstash dashboard's REST section, NOT from the
 * TCP `REDIS_URL` (which this app never reads).
 */
import { Redis } from '@upstash/redis';

import { createLogger } from '@/lib/logger';

const log = createLogger('Redis');

/** Key namespace so this app's keys never collide with other tenants. */
export const REDIS_KEY_PREFIX = 'openmaic:';

/** Per-command budget: Redis must never make a request slower when degraded. */
const REDIS_COMMAND_TIMEOUT_MS = 1_500;

function redisUrl(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_URL?.trim() || undefined;
}

function redisToken(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || undefined;
}

/** Whether the REST credentials are present (no connection is opened). */
export function isRedisConfigured(): boolean {
  return Boolean(redisUrl() && redisToken());
}

let cachedClient: Redis | null = null;
let cachedKey = '';

/**
 * Process-wide client, recreated when the credentials change (rotation).
 * Returns `null` when unconfigured. Never throws.
 */
export function getRedisClient(): Redis | null {
  const url = redisUrl();
  const token = redisToken();
  if (!url || !token) {
    cachedClient = null;
    cachedKey = '';
    return null;
  }
  const key = `${url.length}:${url}\n${token.length}`;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Redis({ url, token, automaticDeserialization: false });
    cachedKey = key;
  }
  return cachedClient;
}

/** Test seam: drop the cached client so credential changes take effect. */
export function resetRedisClientForTests(): void {
  cachedClient = null;
  cachedKey = '';
}

async function withTimeout<T>(promise: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), REDIS_COMMAND_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    log.warn('Redis command failed (ignored):', error);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GET a string key. `null` = key absent; `undefined` = Redis unavailable.
 * With `automaticDeserialization: false` values come back as raw strings.
 */
export async function redisGet(key: string): Promise<string | null | undefined> {
  const client = getRedisClient();
  if (!client) return undefined;
  const value = await withTimeout(client.get<string>(key));
  if (value === undefined) return undefined;
  return value;
}

/**
 * Atomically get and delete a key (edge-triggered wakeup consumption).
 * `null` = key absent; `undefined` = Redis unavailable.
 */
export async function redisGetdel(key: string): Promise<string | null | undefined> {
  const client = getRedisClient();
  if (!client) return undefined;
  const value = await withTimeout(client.getdel<string>(key));
  if (value === undefined) return undefined;
  return value;
}

/** SETEX a string key. `false` = Redis unavailable or the write failed. */
export async function redisSetex(key: string, ttlSeconds: number, value: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  return (await withTimeout(client.setex(key, ttlSeconds, value))) === 'OK';
}

/**
 * Increment a counter, stamping the TTL on first creation. Returns the new
 * count and the key's remaining TTL, or `undefined` when unavailable.
 * The first-increment EXPIRE races benignly under concurrency (both writers
 * stamp the same TTL), which is acceptable for rate-limit accounting.
 */
export async function redisIncrWithTtl(
  key: string,
  ttlSeconds: number,
): Promise<{ count: number; ttlSeconds: number } | undefined> {
  const client = getRedisClient();
  if (!client) return undefined;
  const count = await withTimeout(client.incr(key));
  if (typeof count !== 'number') return undefined;
  if (count === 1) await withTimeout(client.expire(key, ttlSeconds));
  const ttl = await withTimeout(client.ttl(key));
  return { count, ttlSeconds: typeof ttl === 'number' && ttl >= 0 ? ttl : ttlSeconds };
}

/** Best-effort delete; never throws. */
export async function redisDel(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  await withTimeout(client.del(key));
}
