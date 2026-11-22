import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAccount, signOutApp } from '@/deploy/spa/lib/account';

afterEach(() => vi.unstubAllGlobals());

describe('SPA account helpers', () => {
  it('reads the signed-in user with the app cookie', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            enabled: true,
            user: { id: 'u1', name: 'Ade', email: 'ade@example.com', role: 'admin' },
            redirectTo: '/',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = await fetchAccount();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(view.user?.role).toBe('admin');
    expect(view.redirectTo).toBe('/');
  });

  it('handles an auth-disabled deployment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true, enabled: false, user: null }), {
            status: 200,
          }),
      ),
    );
    const view = await fetchAccount();
    expect(view.enabled).toBe(false);
    expect(view.user).toBeNull();
  });

  it('signs out with a same-origin JSON request', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ signedOut: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await signOutApp();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBe('{}');
  });
});
