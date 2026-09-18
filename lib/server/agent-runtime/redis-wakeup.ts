/**
 * Redis wake signals for the agent runtime's SSE tails.
 *
 * The PostgreSQL LISTEN/NOTIFY bus (`event-notify-bus.ts`) needs a dedicated,
 * session-level connection: it breaks behind transaction-pooling proxies such
 * as PgBouncer and costs one connection per serverless instance. These Redis
 * signals are the same *lossy wakeup* through a different transport — a
 * publisher `SETEX`es a per-route key, a consumer `GETDEL`s it on a 1s
 * cadence — and every consumer keeps its existing PG fallback poll, so a
 * missed or delayed signal only costs latency, never correctness.
 *
 * Volume is bounded on both sides: publishes coalesce to at most one per
 * route per second (an event burst during streaming token output must not
 * become an Upstash request burst), and keys expire after a minute whether
 * or not any consumer exists. With Redis unconfigured every function here is
 * a no-op and the deployment behaves exactly as before.
 */
import type { AgentEventWakeupRoute } from './event-notify-bus';
import { REDIS_KEY_PREFIX, isRedisConfigured, redisGetdel, redisSetex } from '@/lib/server/redis';

/** How long a published wake survives without a consumer. */
const WAKE_TTL_SECONDS = 60;
/** Consumer poll cadence: ~1s latency without hammering the request budget. */
const WAKE_POLL_INTERVAL_MS = 1_000;
/** Publisher coalescing: at most one wake per route per interval. */
const PUBLISH_MIN_INTERVAL_MS = 1_000;
/** Bound on the coalescing map; routes churn with sessions. */
const MAX_TRACKED_ROUTES = 1_000;

export function redisWakeKey(route: AgentEventWakeupRoute): string {
  switch (route.kind) {
    case 'owner':
      return `${REDIS_KEY_PREFIX}wake:owner:${route.ownerId}`;
    case 'session':
      return `${REDIS_KEY_PREFIX}wake:session:${route.sessionId}`;
    case 'stage':
      return `${REDIS_KEY_PREFIX}wake:stage:${route.stageId}`;
  }
}

const lastPublished = new Map<string, number>();

function pruneTrackedRoutes(now: number): void {
  if (lastPublished.size <= MAX_TRACKED_ROUTES) return;
  for (const [key, timestamp] of lastPublished) {
    if (now - timestamp > WAKE_TTL_SECONDS * 1000) lastPublished.delete(key);
  }
  if (lastPublished.size <= MAX_TRACKED_ROUTES) return;
  // Still over budget (clock skew or a hot route set): drop the oldest half.
  const entries = [...lastPublished.entries()].sort((a, b) => a[1] - b[1]);
  for (const [key] of entries.slice(0, Math.floor(entries.length / 2))) {
    lastPublished.delete(key);
  }
}

/**
 * Best-effort wake publish. Fire-and-forget by design: never throws, never
 * awaits. Call after the durable write is visible (or, for the in-transaction
 * NOTIFY path, right after it) — an early wake just triggers a poll that
 * finds nothing yet.
 */
export function publishRedisWakeup(route: AgentEventWakeupRoute): void {
  if (!isRedisConfigured()) return;
  const key = redisWakeKey(route);
  const now = Date.now();
  if (now - (lastPublished.get(key) ?? 0) < PUBLISH_MIN_INTERVAL_MS) return;
  lastPublished.set(key, now);
  pruneTrackedRoutes(now);
  void redisSetex(key, WAKE_TTL_SECONDS, '1');
}

/**
 * Poll a route's wake key about once a second, invoking `onWake` once per
 * published signal. Returns the timer, or `null` when Redis is unconfigured
 * (the caller then relies on LISTEN + its fallback poll alone). The caller
 * owns the timer and must clear it on close.
 */
export function startRedisWakePoll(
  route: AgentEventWakeupRoute,
  onWake: () => void,
): ReturnType<typeof setInterval> | null {
  if (!isRedisConfigured()) return null;
  const key = redisWakeKey(route);
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void redisGetdel(key).then(
      (value) => {
        inFlight = false;
        if (value !== null && value !== undefined) onWake();
      },
      () => {
        inFlight = false;
      },
    );
  }, WAKE_POLL_INTERVAL_MS);
  return timer;
}
