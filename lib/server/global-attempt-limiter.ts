/**
 * Global (cross-instance) access-code attempt counter backed by Redis.
 *
 * The in-process limiter (`attempt-limiter.ts`) gives every replica its own
 * budget, so a multi-instance deployment effectively multiplies the brute-
 * force allowance by its instance count. This counter serializes trusted
 * identities on a single Redis key instead.
 *
 * Semantics mirror the local limiter deliberately:
 * - trusted identities only — untrusted (shared) callers are always allowed
 *   and store nothing, here or there. A shared Redis counter would be the
 *   same denial-of-service lever the local limiter documents.
 * - same budget (10 attempts per 60s window).
 * - Redis unavailable (unconfigured, timeout, error) degrades to the local
 *   limiter alone rather than failing open or closed.
 *
 * The window is fixed (INCR + EXPIRE) rather than sliding: close enough for
 * brute-force accounting at one-tenth the keyspace cost, and the local
 * sliding window still runs in front of it.
 */
import { createHash } from 'node:crypto';

import { boundIdentityKey } from './attempt-limiter';
import { REDIS_KEY_PREFIX, isRedisConfigured, redisDel, redisIncrWithTtl } from './redis';

/** Global attempts allowed inside one window (mirrors the local limiter). */
export const GLOBAL_ATTEMPT_LIMIT_MAX_FAILURES = 10;

/** Global window length in seconds (mirrors the local limiter). */
export const GLOBAL_ATTEMPT_LIMIT_WINDOW_SECONDS = 60;

export interface GlobalLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

function keyForIdentity(identity: string): string {
  // Hash, don't embed: forwarding headers are attacker-controlled and
  // unbounded, and the keyspace must stay fixed-width. Bound first so the
  // key identity matches the local limiter's.
  const digest = createHash('sha256').update(boundIdentityKey(identity), 'utf8').digest('hex');
  return `${REDIS_KEY_PREFIX}ratelimit:access-code:${digest}`;
}

/** Reserve one global attempt; always allow when Redis is unavailable. */
export async function consumeGlobalAccessCodeAttempt(identity: string): Promise<GlobalLimitStatus> {
  if (!isRedisConfigured()) return { limited: false, retryAfterSeconds: 0 };
  const result = await redisIncrWithTtl(
    keyForIdentity(identity),
    GLOBAL_ATTEMPT_LIMIT_WINDOW_SECONDS,
  );
  if (!result) return { limited: false, retryAfterSeconds: 0 };
  if (result.count > GLOBAL_ATTEMPT_LIMIT_MAX_FAILURES) {
    return { limited: true, retryAfterSeconds: Math.max(1, result.ttlSeconds) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/** Forget an identity's global attempts, e.g. after a correct code. */
export async function clearGlobalAccessCodeAttempt(identity: string): Promise<void> {
  if (!isRedisConfigured()) return;
  await redisDel(keyForIdentity(identity));
}
