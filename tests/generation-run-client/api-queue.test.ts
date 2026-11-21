/**
 * The browser half of the edge queue: a 202 start is replayed through
 * `/__kelaska/jobs/:id` with its own secret, and the run snapshot comes from
 * the replay rather than from the original (queued) answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RunApiError,
  startGenerationRun,
  type StartRunInput,
} from '@/lib/generation-run-client/api';
import type { RunSnapshot } from '@/lib/generation-run-client/types';

const input = {
  requirement: 'Photosynthesis',
  materialIds: [],
  interactive: false,
  taskEngine: false,
  agents: { mode: 'auto' },
  outlineReview: 'countdown',
} as StartRunInput;

const queued = () =>
  new Response(JSON.stringify({ queued: true, jobId: 'job-1', secret: 's3cret', position: 2 }), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('queued generation starts', () => {
  it('reports the queue and returns the run when the edge replays it', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(queued())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'queued', position: 2 }), { status: 202 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'started', run: { id: 'run-1' } })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const onQueued = vi.fn();

    const pending = startGenerationRun(input, { onQueued });
    // First tick: the queued answer. Second tick: the "still queued" poll.
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const run = (await pending) as RunSnapshot;

    expect(onQueued).toHaveBeenCalledWith({ position: 2, etaSeconds: 300 });
    expect(run.id).toBe('run-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/__kelaska/jobs/job-1');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      'x-kelaska-job-secret': 's3cret',
    });
  }, 15_000);

  it('raises a caller-facing error when the queued job expired', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(queued())
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'expired' }), { status: 410 }),
        ),
    );

    const assertion = expect(startGenerationRun(input)).rejects.toBeInstanceOf(RunApiError);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });
});
