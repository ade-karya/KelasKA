import { afterEach, describe, expect, it, vi } from 'vitest';

import { withSecurityHeaders } from '@/deploy/cloudflare-worker/src/http';
import { upstreamFor } from '@/deploy/cloudflare-worker/src/routing';
import {
  handleSessionStart,
  noteSessionActivity,
  sessionOnline,
  staticUiEnabled,
} from '@/deploy/cloudflare-worker/src/session-mode';
import type { Env } from '@/deploy/cloudflare-worker/src/types';

interface StoredValue {
  value: string;
  expirationTtl?: number;
}

function fakeEnv(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, StoredValue>();
  const doFetches: string[] = [];
  const env = {
    STATIC_UI_ENABLED: '1',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    COLAB_ORIGIN: 'https://api.example.com',
    VERCEL_ORIGIN: 'https://vercel.example.com',
    STATE: {
      get: async (key: string) => store.get(key)?.value ?? null,
      put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
        store.set(key, { value, expirationTtl: options?.expirationTtl });
      },
      delete: async (key: string) => {
        store.delete(key);
      },
      list: async () => ({ keys: [] }),
    },
    COORDINATOR: {
      idFromName: () => 'coordinator-id',
      get: () => ({
        fetch: async (url: string) => {
          doFetches.push(url);
          return new Response('{}', { status: 200 });
        },
      }),
    },
    ...overrides,
  } as unknown as Env;
  return { env, store, doFetches };
}

function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
      passThroughOnException: () => undefined,
    } as ExecutionContext,
    flush: () => Promise.all(pending),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('static-UI route split', () => {
  it('keeps legacy routing until the flag is on', () => {
    const { env } = fakeEnv({ STATIC_UI_ENABLED: '0' });
    expect(staticUiEnabled(env)).toBe(false);
    expect(upstreamFor('/', 'GET', env)).toBe('colab');
    expect(upstreamFor('/api/stages', 'GET', env)).toBe('colab');
  });

  it('sends pages to Vercel and APIs to the session when enabled', () => {
    const { env } = fakeEnv();
    expect(staticUiEnabled(env)).toBe(true);
    expect(upstreamFor('/classroom/abc', 'GET', env)).toBe('vercel');
    expect(upstreamFor('/_next/static/chunk.js', 'GET', env)).toBe('vercel');
    expect(upstreamFor('/api/stages', 'GET', env)).toBe('session');
  });
});

describe('session start endpoint', () => {
  it('requires a valid Supabase Bearer token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const { env } = fakeEnv();
    const { ctx } = fakeCtx();
    const response = await handleSessionStart(
      new Request('https://kelaska.riau.ai/api/session/start', {
        method: 'POST',
        headers: { authorization: 'Bearer bad' },
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(401);
  });

  it('starts once, applies cooldown, and never exposes the Supabase key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 'user-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const { env, store, doFetches } = fakeEnv({
      SESSION_START_USER_COOLDOWN_SECONDS: '600',
      SESSION_START_GLOBAL_COOLDOWN_SECONDS: '120',
    });
    const { ctx, flush } = fakeCtx();
    const request = new Request('https://kelaska.riau.ai/api/session/start', {
      method: 'POST',
      headers: { authorization: 'Bearer good' },
    });

    const first = await handleSessionStart(request, env, ctx);
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({ status: 'starting', etaSeconds: 300 });
    await flush();
    expect(doFetches).toEqual(['https://coordinator/desire']);
    expect(store.get('session:status')?.value).toBe('starting');
    expect(store.get('session:start:user:user-1')?.expirationTtl).toBe(600);
    expect(store.get('session:start:global')?.expirationTtl).toBe(120);
    expect(JSON.stringify([...store.entries()])).not.toContain('anon-key');

    const second = await handleSessionStart(request, env, fakeCtx().ctx);
    expect(second.status).toBe(429);
  });
});

describe('session liveness and headers', () => {
  it('falls back to health keys, then honours the explicit status', async () => {
    const { env } = fakeEnv();
    expect(await sessionOnline(env)).toBe(false);
    await env.STATE.put('gpu:status', 'online');
    expect(await sessionOnline(env)).toBe(true);
    await env.STATE.put('session:status', 'offline');
    expect(await sessionOnline(env)).toBe(false);
  });

  it('throttles activity writes to one per minute', async () => {
    const { env, store } = fakeEnv();
    await noteSessionActivity(env);
    const first = store.get('session:activityAt')?.value;
    vi.spyOn(Date, 'now').mockReturnValue(Number(first) + 10_000);
    await noteSessionActivity(env);
    expect(store.get('session:activityAt')?.value).toBe(first);
    vi.spyOn(Date, 'now').mockReturnValue(Number(first) + 61_000);
    await noteSessionActivity(env);
    expect(store.get('session:activityAt')?.value).toBe(String(Number(first) + 61_000));
    vi.restoreAllMocks();
  });

  it('adds the security headers the static export no longer sets', () => {
    const response = withSecurityHeaders(new Response('ok'));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('permissions-policy')).toContain('microphone=(self)');
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });
});
