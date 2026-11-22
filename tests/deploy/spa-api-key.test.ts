import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ONBOARDING_PROVIDERS,
  onboardKey,
  safeNext,
  type OnboardingProvider,
} from '@/deploy/spa/lib/api-key';
import { fetchSettings } from '@/deploy/spa/lib/settings';

afterEach(() => vi.unstubAllGlobals());

const provider: OnboardingProvider = ONBOARDING_PROVIDERS[0]!;

describe('SPA onboarding', () => {
  it('only accepts local next paths', () => {
    expect(safeNext('/classes')).toBe('/classes');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });

  it('saves with the current revision, verifies, then assigns slots', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === '/api/model-config' && !init?.method) {
        return new Response(JSON.stringify({ revision: 3 }), { status: 200 });
      }
      if (url === '/api/model-config' && init?.method === 'PUT') {
        const revision = calls.at(-1)?.body as { revision: number };
        return new Response(JSON.stringify({ revision: revision.revision + 1 }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await onboardKey(provider, 'a-secret-key', 'gemini-3.5-flash-lite');
    expect(result.ok).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/model-config',
      'PUT /api/model-config',
      'POST /api/verify-model',
      'PUT /api/model-config',
    ]);
    expect(calls[1]?.body).toEqual({
      revision: 3,
      change: {
        kind: 'provider',
        id: provider.id,
        preset: provider.preset,
        apiKey: 'a-secret-key',
      },
    });
    expect(calls[2]?.body).toEqual({ provider: provider.id, model: 'gemini-3.5-flash-lite' });
    expect(calls[3]?.body).toEqual({
      revision: 4,
      change: {
        kind: 'slots',
        set: {
          llm: `${provider.id}:gemini-3.5-flash-lite`,
          agent: `${provider.id}:gemini-3.5-flash-lite`,
        },
      },
    });
  });

  it('stops when the provider save is refused', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ revision: 1 }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 'PROVIDERS_NOT_ALLOWED' } }), {
        status: 403,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await onboardKey(provider, 'a-secret-key', 'model');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('PROVIDERS_NOT_ALLOWED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('SPA settings view', () => {
  it('renders providers and slots from the session app', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            revision: 7,
            allowUserKeys: true,
            providers: [
              { id: 'onboarding-google', preset: 'google', key: { set: true, mask: '****key' } },
            ],
            slots: [{ slot: 'llm', source: { kind: 'assigned' } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = await fetchSettings();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/model-config',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(view.revision).toBe(7);
    expect(view.providers[0]?.key?.mask).toBe('****key');
    expect(view.slots[0]?.slot).toBe('llm');
  });
});
