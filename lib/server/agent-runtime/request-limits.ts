/**
 * Per-user request limits for the workbench agent control plane.
 *
 * Owner identity is the app-level partition key `user:<id>` (login) or
 * `anon:<uuid>` (see `owner.ts`) — NOT a client IP, so unlike
 * `attempt-limiter.ts` this needs no `TRUST_PROXY_HEADERS` gate: attribution
 * is exact even without a proxy.
 *
 * In-memory sliding windows per owner (Map + opportunistic sweep). State is
 * per-process and NOT shared across replicas: for a multi-instance deployment
 * replace the two Maps with Redis (e.g. one sorted-set per owner per window,
 * `ZREMRANGEBYSCORE` + `ZCARD` + `EXPIRE`).
 *
 * Memory is bounded for the 20-50 concurrent-chat peak and beyond: owner keys
 * are copied (never sliced, so a key cannot retain a larger string), each
 * owner's timestamps are pruned to the active window, and tracked owners are
 * capped with oldest-first eviction.
 *
 * Integration (the integrator wires these into the routes; this file never
 * touches the DB or the transport):
 *
 * sessions POST — inside `withRequestOwnerId`, before `createSession`:
 * ```ts
 * const rl = checkAgentRateLimit(ownerId, 'session');
 * if (!rl.allowed) return new Response('Too Many Requests',
 *   { status: 429, headers: { ...responseHeaders, 'Retry-After': String(rl.retryAfterSeconds ?? 60) } });
 * const active = (await store.listSessionsByOwner(ownerId)).filter((s) => s.status === 'queued' || s.status === 'running');
 * if (isOwnerAtSessionCap(active.length)) return new Response('Too Many Requests', { status: 429, headers: responseHeaders });
 * ```
 *
 * messages POST — inside `withRequestOwnerId`, before `postUserMessage`:
 * ```ts
 * const rl = checkAgentRateLimit(ownerId);
 * if (!rl.allowed) return new Response('Too Many Requests',
 *   { status: 429, headers: { ...responseHeaders, 'Retry-After': String(rl.retryAfterSeconds ?? 60) } });
 * await store.postUserMessage(id, { text }, { expectedOwnerId: ownerId });
 * ```
 */

const numberFromEnv = (value: string | undefined, fallback: number): number =>
  value ? Number(value) : fallback;

/** Built-in rate values referenced ONLY when the operator sets the matching env. */
export const DEFAULT_TURNS_PER_MINUTE_PER_USER = 10;
/** Default session creations per hour per owner (applied only when env is set). */
export const DEFAULT_SESSIONS_PER_HOUR_PER_USER = 20;
/** Default concurrently active (queued/running) sessions per owner (env-gated). */
export const DEFAULT_MAX_ACTIVE_SESSIONS_PER_USER = 3;

/** Sliding-window length for the per-minute turn budget. */
export const TURN_WINDOW_MS = 60_000;
/** Sliding-window length for the per-hour session-creation budget. */
export const SESSION_WINDOW_MS = 3_600_000;

/** Hard cap on tracked owners per window; oldest entries are evicted past this. */
export const REQUEST_LIMIT_MAX_OWNERS = 10_000;
/** Maximum characters of an owner id retained as a storage key. */
export const REQUEST_LIMIT_MAX_OWNER_LENGTH = 128;

export type AgentRequestKind = 'turn' | 'session';

export interface AgentRateLimitResult {
  allowed: boolean;
  /** Whole seconds until the owner may retry; present (>= 1) only when denied. */
  retryAfterSeconds?: number;
}

/**
 * Copy the owner id prefix into a fresh string so a stored key is bounded in
 * both length and retained memory (mirrors `boundIdentityKey`: `slice` would
 * keep the parent string alive in V8).
 */
function boundOwnerKey(ownerId: string): string {
  const length = Math.min(ownerId.length, REQUEST_LIMIT_MAX_OWNER_LENGTH);
  let copy = '';
  for (let i = 0; i < length; i += 1) {
    copy += ownerId.charAt(i);
  }
  return copy;
}

/**
 * Parse one rate env. Upstream parity: UNSET/blank means unlimited — limits
 * are strictly opt-in so default behavior matches upstream OpenMAIC (no
 * throttling). An explicit `0`/negative also means unlimited (operator
 * override); NaN falls back to unlimited as well. Only a positive number
 * enforces.
 */
function limitFromEnv(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function resolveTurnLimit(): number {
  return limitFromEnv('AGENT_TURNS_PER_MINUTE_PER_USER');
}

function resolveSessionLimit(): number {
  return limitFromEnv('AGENT_SESSIONS_PER_HOUR_PER_USER');
}

function resolveMaxActiveSessions(): number {
  return limitFromEnv('AGENT_MAX_ACTIVE_SESSIONS_PER_USER');
}

const turnHits = new Map<string, number[]>();
const sessionHits = new Map<string, number[]>();

/** Keep only timestamps inside the active window; returns the survivors. */
function pruneAt(store: Map<string, number[]>, key: string, now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  const timestamps = (store.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (timestamps.length === 0) {
    store.delete(key);
  } else {
    store.set(key, timestamps);
  }
  return timestamps;
}

/** Drop expired entries, then evict oldest-inserted ones until within cap. */
function enforceCapacity(store: Map<string, number[]>, now: number, windowMs: number): void {
  if (store.size <= REQUEST_LIMIT_MAX_OWNERS) return;
  const cutoff = now - windowMs;
  for (const [key, timestamps] of store) {
    if (store.size <= REQUEST_LIMIT_MAX_OWNERS) break;
    if (timestamps.every((timestamp) => timestamp <= cutoff)) {
      store.delete(key);
    }
  }
  while (store.size > REQUEST_LIMIT_MAX_OWNERS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function consume(
  store: Map<string, number[]>,
  ownerId: string,
  limit: number,
  windowMs: number,
): AgentRateLimitResult {
  if (limit <= 0) return { allowed: true };
  const key = boundOwnerKey(ownerId);
  const now = Date.now();
  const timestamps = pruneAt(store, key, now, windowMs);
  if (timestamps.length >= limit) {
    const retryAfterMs = timestamps[0] + windowMs - now;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  timestamps.push(now);
  // Re-insert so the most recently active owners are evicted last.
  store.delete(key);
  store.set(key, timestamps);
  enforceCapacity(store, now, windowMs);
  return { allowed: true };
}

/**
 * Reserve one request from the owner's sliding-window budget, and report how
 * long to wait when the budget is spent. Check and record happen in one
 * synchronous tick, so concurrent requests cannot slip past the window
 * between a check and a later record.
 *
 * `kind` selects the window: `'turn'` (default) spends the per-minute budget
 * for messages/follow-up posts; `'session'` spends the per-hour budget for
 * session creation. Budgets are OPT-IN: unless the matching
 * `AGENT_TURNS_PER_MINUTE_PER_USER` / `AGENT_SESSIONS_PER_HOUR_PER_USER` env
 * is set to a positive number, every call allows (upstream parity — no
 * throttling out of the box).
 *
 * The route translates a denial into `429` with a `Retry-After` header (see
 * the examples in this file's header).
 */
export function checkAgentRateLimit(
  ownerId: string,
  kind: AgentRequestKind = 'turn',
): AgentRateLimitResult {
  if (kind === 'session') {
    return consume(sessionHits, ownerId, resolveSessionLimit(), SESSION_WINDOW_MS);
  }
  return consume(turnHits, ownerId, resolveTurnLimit(), TURN_WINDOW_MS);
}

/**
 * Whether `activeSessionCount` (queued + running sessions for the owner, as
 * counted by the route from the store — this helper never queries the DB)
 * has reached the `AGENT_MAX_ACTIVE_SESSIONS_PER_USER` cap. Opt-in like the
 * rest of this file: unset/blank/`0` env means unlimited, always `false`
 * (upstream parity).
 */
export function isOwnerAtSessionCap(activeSessionCount: number): boolean {
  const max = resolveMaxActiveSessions();
  if (max <= 0) return false;
  return activeSessionCount >= max;
}

/** Drop all tracked request-limit state. Exists mainly for tests. */
export function resetAgentRequestLimitState(): void {
  turnHits.clear();
  sessionHits.clear();
}
