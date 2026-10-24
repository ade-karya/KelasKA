import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PBL_STREAM_TIMEOUT_MS,
  runOneStream,
} from '@/components/scene-renderers/pbl/v2/use-instructor-stream';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';

function makeProject(): PBLProjectV2 {
  return {
    roles: [{ id: 'role-i', type: 'instructor', name: 'Instructor' }],
    threads: [{ agentId: 'role-i', messages: [] }],
    updatedAt: '2026-05-29T00:00:00.000Z',
    milestones: [
      {
        id: 'ms-1',
        title: 'Milestone 1',
        status: 'active',
        order: 0,
        documents: [],
        microtasks: [
          {
            id: 'mt-1',
            title: 'Task 1',
            status: 'in_progress',
            assignee: 'user',
            hints: [],
            order: 0,
          },
        ],
      },
    ],
    evaluations: [],
    engagementEvents: [],
  } as unknown as PBLProjectV2;
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PBL v2 — runOneStream transport safety', () => {
  it('applies project_patch frames from an SSE stream and publishes updates', async () => {
    const message = {
      id: 'msg-1',
      agentId: 'role-i',
      roleType: 'instructor',
      content: 'Halo, Detektif Cilik!',
      ts: '2026-10-09T08:30:00.000Z',
      microtaskId: 'mt-1',
    };
    const body =
      sseFrame('token', { delta: 'Halo' }) +
      sseFrame('project_patch', { patch: { kind: 'message', message } }) +
      sseFrame('done', {});

    let seenSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
        seenSignal = init?.signal;
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const project = makeProject();
    let draft = '';
    const onProjectUpdated = vi.fn();
    const next = await runOneStream({
      endpoint: '/api/pbl/v2/evaluate',
      body: { project, kind: 'task' },
      startingProject: project,
      setDraftAssistant: (fn) => {
        draft = fn(draft);
      },
      onProjectUpdated,
    });

    // The committed message patch lands on the instructor thread...
    const thread = next.threads.find((t) => t.agentId === 'role-i');
    expect(thread?.messages.map((m) => m.content)).toContain('Halo, Detektif Cilik!');
    // ...is published incrementally...
    expect(onProjectUpdated).toHaveBeenCalled();
    // ...and the live token draft was cleared by the committed patch.
    expect(draft).toBe('');
    // Every stream carries an abort signal so a stall can be interrupted.
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces HTTP failures instead of hanging the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );

    await expect(
      runOneStream({
        endpoint: '/api/pbl/v2/evaluate',
        body: { project: makeProject(), kind: 'task' },
        startingProject: makeProject(),
        setDraftAssistant: () => {},
      }),
    ).rejects.toThrow('HTTP 500');
  });

  it('rejects promptly when the stream is aborted (stalled-stream recovery)', async () => {
    // Mimics undici: fetch with an already-aborted signal rejects instead
    // of ever resolving. runOneStream must propagate that rejection so the
    // caller's finally releases the streaming locks (chat Send + Kirim
    // Hasil) instead of wedging them forever.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
        if (init?.signal?.aborted) throw init.signal.reason ?? new Error('aborted');
        return new Response(sseFrame('done', {}), { status: 200 });
      }),
    );

    const controller = new AbortController();
    controller.abort(new Error('stream stalled: no response within budget'));

    await expect(
      runOneStream({
        endpoint: '/api/pbl/v2/evaluate',
        body: { project: makeProject(), kind: 'task' },
        startingProject: makeProject(),
        setDraftAssistant: () => {},
        signal: controller.signal,
      }),
    ).rejects.toThrow('stream stalled');
  });

  it('uses a bounded default timeout for streams without an explicit signal', () => {
    // Guard against "infinite hang" regressions: the default ceiling must be
    // finite and generous (minutes, not seconds — healthy eval turns stream
    // for a while; only dead streams should trip it).
    expect(PBL_STREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(PBL_STREAM_TIMEOUT_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});
