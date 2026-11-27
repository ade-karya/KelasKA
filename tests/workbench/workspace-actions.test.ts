import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { deleteWorkspaceSession } from '@/lib/workbench/workspace-actions';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('refuses an empty id without a request', async () => {
  expect(await deleteWorkspaceSession('   ')).toEqual({ deleted: false });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('deletes through the owner-scoped route', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
  expect(await deleteWorkspaceSession('chat-a')).toEqual({ deleted: true });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/agent/sessions/chat-a',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('reports a refused or failed delete as not deleted', async () => {
  fetchMock.mockResolvedValue(new Response('Not found', { status: 404 }));
  expect(await deleteWorkspaceSession('chat-a')).toEqual({ deleted: false });

  fetchMock.mockRejectedValue(new Error('offline'));
  expect(await deleteWorkspaceSession('chat-a')).toEqual({ deleted: false });
});
