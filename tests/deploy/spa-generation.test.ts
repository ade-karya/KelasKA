import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchRun, startRun } from '@/deploy/spa/lib/generation';

afterEach(() => vi.unstubAllGlobals());

const run = { id: 'run-1', state: 'running', step: 'outline', seq: 3, stageId: null };

describe('SPA generation preview', () => {
  it('starts a run with the requirement and material ids', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ run }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await startRun({ requirement: ' Hujan ', materialIds: ['m1', 'm2'] })).toEqual(run);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/generation-runs');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      requirement: ' Hujan ',
      materialIds: ['m1', 'm2'],
    });
  });

  it('polls a run by id with the app cookie', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ run: { ...run, stageId: 'stage-1' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const next = await fetchRun('run/1');
    expect(next.stageId).toBe('stage-1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/generation-runs/run%2F1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('maps an unverified-key refusal to an Indonesian message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    await expect(startRun({ requirement: 'x' })).rejects.toThrow('kunci API belum diverifikasi');
  });
});
