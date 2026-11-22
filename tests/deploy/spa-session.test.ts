import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  exchangeAppSession,
  fetchEdgeStatus,
  sessionState,
  startFailureMessage,
  startSession,
} from '@/deploy/spa/lib/session';

afterEach(() => vi.unstubAllGlobals());

describe('SPA session state', () => {
  it('prefers the Worker session field and falls back to health keys', () => {
    expect(sessionState({ session: 'online' })).toBe('online');
    expect(sessionState({ session: 'starting', gpu: { status: 'online' } })).toBe('starting');
    expect(sessionState({ session: 'offline', colab: { status: 'online' } })).toBe('offline');
    expect(sessionState({ gpu: { status: 'online' } })).toBe('online');
    expect(sessionState({})).toBe('offline');
  });

  it('reads the public status endpoint without storing credentials', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, session: 'online', queue: 2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const status = await fetchEdgeStatus();
    expect(fetchMock).toHaveBeenCalledWith(
      '/__kelaska/status',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(status.queue).toBe(2);
    expect(sessionState(status)).toBe('online');
  });
});

describe('SPA session requests', () => {
  it('starts with the Supabase Bearer and reports Retry-After', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'starting' }), {
          status: 202,
          headers: { 'retry-after': '15' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await startSession('access-token');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/session/start',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
      }),
    );
    expect(result).toEqual({ ok: true, status: 202, retryAfterSeconds: 15 });
  });

  it('exchanges the token for an HttpOnly cookie on the session app', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await exchangeAppSession('access-token');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/spa/session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { authorization: 'Bearer access-token' },
      }),
    );
  });

  it('maps refusal codes to Indonesian messages', () => {
    expect(startFailureMessage(401)).toContain('Google');
    expect(startFailureMessage(429)).toContain('Tunggu');
    expect(startFailureMessage(500)).toContain('Coba lagi');
  });
});
