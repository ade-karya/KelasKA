import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '@/app/api/health/route';
import { createAccessToken } from '@/lib/server/access-token';
import { proxy } from '@/proxy';

/** The deployment's slots behind the capabilities these tests expect. */
async function configureSlots(slots: Record<string, unknown>) {
  (await import('@/lib/server/model-config/runtime')).setDeploymentConfigForTests({
    layer: {
      source: 'deployment',
      config: {
        providers: {
          tv: { preset: 'tavily', apiKey: 'k' },
          mm: { preset: 'minimax-tts', apiKey: 'k' },
        },
        slots,
      } as never,
    },
    legacy: false,
    notices: [],
  });
}

afterEach(() => vi.unstubAllEnvs());

const anonymousRequest = () => new NextRequest('http://localhost/api/health');
const authenticatedRequest = (code: string) =>
  new NextRequest('http://localhost/api/health', {
    headers: { cookie: `openmaic_access=${createAccessToken(code)}` },
  });

describe('health access-code configuration', () => {
  it.each([undefined, '', 'health-route-test-secret', ' '])(
    'probes stay reachable without a cookie but disclose no topology: ACCESS_CODE=%j',
    async (code) => {
      vi.stubEnv('ACCESS_CODE', code);
      await configureSlots({ tts: 'mm', image: null });

      // Health remains available to deployment probes without an access cookie.
      const gate = await proxy(anonymousRequest());
      expect(gate.status).toBe(200);

      const response = await GET(anonymousRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true, status: 'ok' });
      // The minimal probe shape leaks neither the code nor the topology.
      expect(JSON.stringify(body)).not.toContain('health-route-test-secret');
      expect(JSON.stringify(body)).not.toContain('version');

      // The new diagnostic must not change the local-first default or gate.
      const api = await proxy(new NextRequest('http://localhost/api/foo'));
      expect(api.status).toBe(code ? 401 : 200);
    },
  );

  it('an owner holding the access cookie sees the full diagnostics', async () => {
    vi.stubEnv('ACCESS_CODE', 'health-route-test-secret');
    await configureSlots({ tts: 'mm', image: null });

    const response = await GET(authenticatedRequest('health-route-test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      status: 'ok',
      version: expect.any(String),
      accessCodeConfigured: true,
      capabilities: {
        webSearch: false,
        imageGeneration: false,
        videoGeneration: false,
        tts: true,
      },
      generation: { parallelSceneConcurrency: 0 },
    });
    expect(JSON.stringify(body)).not.toContain('health-route-test-secret');
  });

  it('a forged cookie is treated as an anonymous probe', async () => {
    vi.stubEnv('ACCESS_CODE', 'health-route-test-secret');
    await configureSlots({ tts: 'mm', image: null });

    const request = new NextRequest('http://localhost/api/health', {
      headers: { cookie: 'openmaic_access=forged.token' },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, status: 'ok' });
  });
});
