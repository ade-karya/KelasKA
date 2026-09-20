import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getAuthenticatedOwnerId: vi.fn(),
  softDeleteSession: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/server/auth/session', () => ({
  getAuthenticatedOwnerId: mocks.getAuthenticatedOwnerId,
}));
vi.mock('@/lib/server/agent-runtime/store', () => ({
  getAgentSessionStore: async () => ({ softDeleteSession: mocks.softDeleteSession }),
}));

import { deleteWorkspaceSession } from '@/lib/workbench/workspace-actions';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

function cookieStore(entries: Array<{ name: string; value: string }>) {
  return {
    get: (name: string) => entries.find((entry) => entry.name === name),
    getAll: () => entries,
    set: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deleteWorkspaceSession owner resolution', () => {
  it('deletes with the login identity when a session is authenticated', async () => {
    mocks.cookies.mockResolvedValue(
      cookieStore([{ name: 'openmaic_session', value: 'token-abc' }]),
    );
    mocks.getAuthenticatedOwnerId.mockResolvedValue('user:u1');
    mocks.softDeleteSession.mockResolvedValue(true);

    await expect(deleteWorkspaceSession('s1')).resolves.toEqual({ deleted: true });
    expect(mocks.softDeleteSession).toHaveBeenCalledWith('s1', 'user:u1');
  });

  it('falls back to the anonymous cookie without a login session', async () => {
    mocks.cookies.mockResolvedValue(cookieStore([{ name: 'anonymous_id', value: UUID }]));
    mocks.getAuthenticatedOwnerId.mockResolvedValue(null);
    mocks.softDeleteSession.mockResolvedValue(true);

    await expect(deleteWorkspaceSession('s1')).resolves.toEqual({ deleted: true });
    expect(mocks.softDeleteSession).toHaveBeenCalledWith('s1', `anon:${UUID}`);
  });

  it('reports not-deleted when the owner check fails', async () => {
    mocks.cookies.mockResolvedValue(cookieStore([]));
    mocks.getAuthenticatedOwnerId.mockResolvedValue(null);
    mocks.softDeleteSession.mockResolvedValue(false);

    await expect(deleteWorkspaceSession('s1')).resolves.toEqual({ deleted: false });
  });
});
