import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUser, fetchUsers, updateUser } from '@/deploy/spa/lib/admin';

afterEach(() => vi.unstubAllGlobals());

const user = {
  id: 'u1',
  email: 'pending@example.com',
  name: 'Pending',
  role: 'student' as const,
  active: false,
  createdAt: '2026-11-22T00:00:00Z',
};

describe('SPA admin console', () => {
  it('lists users with the app cookie', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ users: [user] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchUsers()).toEqual([user]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('approves a pending account with a same-origin PATCH', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { ...user, active: true } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const updated = await updateUser('u/1', { active: true });
    expect(updated.active).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/users/u%2F1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ active: true });
  });

  it('maps a non-admin refusal to an Indonesian message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    await expect(fetchUsers()).rejects.toThrow('Hanya admin');
  });

  it('creates an approved account', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { ...user, active: true } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await createUser('new@example.com', 'Baru', 'teacher');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'new@example.com',
      name: 'Baru',
      role: 'teacher',
    });
  });
});
