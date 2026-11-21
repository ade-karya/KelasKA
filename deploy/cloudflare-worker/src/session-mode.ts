/**
 * Static-UI mode helpers.
 *
 * When STATIC_UI_ENABLED is on, the browser loads the SPA from Vercel and every
 * `/api/*` call goes to the live session (Kaggle app first, Colab fallback).
 * The session is asleep most of the time, so its start button needs an endpoint
 * that works while the app itself cannot answer: it lives in the Worker and
 * verifies the Supabase Bearer directly.
 */

import { bearerToken, intEnv, json } from './http';
import type { Env } from './types';

const TRUE_VALUES = new Set(['1', 'true', 'yes']);

export function staticUiEnabled(env: Env): boolean {
  return TRUE_VALUES.has((env.STATIC_UI_ENABLED ?? '').trim().toLowerCase());
}

/**
 * `session:status` is maintained by the proxy: online after a successful API
 * call, offline after an upstream failure. Until it is written, fall back to
 * the existing GPU/Colab health keys so the switch is safe on a fresh deploy.
 */
export async function sessionOnline(env: Env): Promise<boolean> {
  const state = await env.STATE.get('session:status');
  if (state === 'online') return true;
  if (state === 'offline') return false;
  const [gpu, colab] = await Promise.all([
    env.STATE.get('gpu:status'),
    env.STATE.get('colab:status'),
  ]);
  return gpu === 'online' || colab === 'online';
}

export async function markSessionOnline(env: Env, online: boolean): Promise<void> {
  const next = online ? 'online' : 'offline';
  if ((await env.STATE.get('session:status')) !== next) {
    await env.STATE.put('session:status', next);
  }
}

/**
 * The Kaggle lease decides idleness from `gpu:lastRequest`. In static-UI mode
 * every API call counts as activity, not only GPU generation calls, but a KV
 * write per request would be wasteful: once a minute is enough.
 */
export async function noteSessionActivity(env: Env): Promise<void> {
  const now = Date.now();
  const raw = await env.STATE.get('session:activityAt');
  if (raw && Number.isFinite(Number(raw)) && now - Number(raw) < 60_000) return;
  await env.STATE.put('session:activityAt', String(now));
  await env.STATE.put('gpu:lastRequest', String(now));
}

interface SupabaseUser {
  id: string;
}

async function verifyBearer(request: Request, env: Env): Promise<SupabaseUser | null> {
  const token = bearerToken(request);
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  try {
    const response = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), {
      headers: {
        authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === 'string' && body.id ? { id: body.id } : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/session/start — authenticated by Supabase, never by the app's own
 * cookie (the app is down when this is called). The DO keeps starts single-
 * flight; cooldowns stop any logged-in account from burning the weekly quota.
 */
export async function handleSessionStart(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const user = await verifyBearer(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const userCooldown = intEnv(env.SESSION_START_USER_COOLDOWN_SECONDS, 600);
  const globalCooldown = intEnv(env.SESSION_START_GLOBAL_COOLDOWN_SECONDS, 120);
  if (await env.STATE.get(`session:start:user:${user.id}`)) {
    return json({ error: 'cooldown', retryAfter: userCooldown }, 429);
  }
  if (await env.STATE.get('session:start:global')) {
    return json({ error: 'cooldown', retryAfter: globalCooldown }, 429);
  }

  const now = Date.now();
  await Promise.all([
    env.STATE.put(`session:start:user:${user.id}`, String(now), { expirationTtl: userCooldown }),
    env.STATE.put('session:start:global', String(now), { expirationTtl: globalCooldown }),
    env.STATE.put('session:lastStart', String(now)),
    env.STATE.put('session:status', 'starting'),
  ]);

  ctx.waitUntil(
    env.COORDINATOR.get(env.COORDINATOR.idFromName('kaggle'))
      .fetch('https://coordinator/desire', { method: 'POST' })
      .then(() => undefined)
      .catch(async () => {
        // Otherwise a failed start would leave the button waiting forever.
        await env.STATE.put('session:status', 'offline');
      }),
  );

  return json({ status: 'starting', etaSeconds: 300 }, 202, { 'retry-after': '15' });
}
