import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ validateUrlForSSRF: vi.fn() }));
const opencodeMocks = vi.hoisted(() => ({ listOpencodeModels: vi.fn() }));

vi.mock('@/lib/server/ssrf-guard', () => ({
  validateUrlForSSRF: mocks.validateUrlForSSRF,
}));

vi.mock('@/lib/ai/opencode-cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/opencode-cli')>();
  return { ...actual, listOpencodeModels: opencodeMocks.listOpencodeModels };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

async function postProbeModels(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/provider/probe-models/route');
  const request = new Request('http://localhost/api/provider/probe-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

describe('POST /api/provider/probe-models', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.validateUrlForSSRF.mockReset();
    mocks.validateUrlForSSRF.mockResolvedValue(null);
    opencodeMocks.listOpencodeModels.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps an upstream redirect to the exact redirect-not-allowed contract without reading it', async () => {
    const text = vi.fn().mockResolvedValue('redirect response body');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      text,
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
    });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({
      success: false,
      errorCode: 'REDIRECT_NOT_ALLOWED',
      error: 'Redirects are not allowed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it('preserves successful model filtering and response metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: 'chat-model', owned_by: 'provider' },
              { id: 'text-embedding-3-small', owned_by: 'provider' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      models: [{ id: 'chat-model', ownedBy: 'provider' }],
      total: 2,
      filtered: 1,
    });
  });

  it.each([401, 403])('preserves the API-key error contract for upstream %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: vi.fn().mockResolvedValue('invalid key'),
      } as unknown as Response),
    );

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'bad-key',
    });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'API key is invalid or expired',
    });
  });

  it('preserves the manual-entry response when no model endpoint exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn(),
      } as unknown as Response),
    );

    const res = await postProbeModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'This provider does not expose a model list',
    });
  });

  it('probes Gemini through the Google ListModels dialect', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await postProbeModels({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'google-key',
      providerType: 'google',
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      models: [{ id: 'gemini-2.5-flash' }],
      total: 1,
      // The embedding entry is dropped by the Google dialect's
      // `generateContent` filter before the route's non-chat filter runs.
      filtered: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({ headers: { 'x-goog-api-key': 'google-key' } }),
    );
  });

  it('lists the local opencode CLI models without requiring a base URL', async () => {
    opencodeMocks.listOpencodeModels.mockResolvedValue([
      'opencode-go/deepseek-v4-pro',
      'opencode/muse-spark-1.3-contributor-free',
      'opencode/big-pickle',
      'anthropic/claude-opus-5',
    ]);

    const res = await postProbeModels({ providerType: 'opencode' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      models: [{ id: 'big-pickle' }, { id: 'muse-spark-1.3-contributor-free' }],
      total: 2,
      filtered: 0,
    });
    expect(mocks.validateUrlForSSRF).not.toHaveBeenCalled();
  });

  it('surfaces a missing opencode binary instead of a base-URL error', async () => {
    opencodeMocks.listOpencodeModels.mockRejectedValue(
      new Error('No `opencode` binary was found. Install it (see https://opencode.ai).'),
    );

    const res = await postProbeModels({ providerType: 'opencode' });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/opencode/i);
  });
});
