import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authEnabledMock, sessionUserMock } = vi.hoisted(() => ({
  authEnabledMock: vi.fn(),
  sessionUserMock: vi.fn(),
}));

vi.mock('@/lib/server/auth/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/auth/config')>();
  return { ...actual, authEnabled: authEnabledMock };
});
vi.mock('@/lib/server/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/auth/session')>();
  return { ...actual, sessionUserFromHeaders: sessionUserMock };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async () => Buffer.from('<html>docs</html>')),
    stat: vi.fn(async () => ({ isFile: () => true })),
  };
});

import { GET } from '@/app/docs/[[...slug]]/route';

const indexContext = { params: Promise.resolve({ slug: [] as string[] }) };
const request = () => new Request('http://localhost/docs');

describe('/docs is admin-only when accounts are enabled', () => {
  beforeEach(() => {
    authEnabledMock.mockReset();
    sessionUserMock.mockReset();
  });

  it('stays open on a deployment without accounts', async () => {
    authEnabledMock.mockReturnValue(false);
    const response = await GET(request(), indexContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('public');
    expect(sessionUserMock).not.toHaveBeenCalled();
  });

  it('serves admins with private, non-cacheable bytes', async () => {
    authEnabledMock.mockReturnValue(true);
    sessionUserMock.mockResolvedValue({ id: '1', role: 'admin', active: true });
    const response = await GET(request(), indexContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toContain('<html>docs</html>');
  });

  it('answers 404 for other roles and for signed-out browsers', async () => {
    authEnabledMock.mockReturnValue(true);
    for (const user of [null, { id: '2', role: 'student', active: true }]) {
      sessionUserMock.mockResolvedValue(user);
      const response = await GET(request(), indexContext);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('Not found');
    }
  });

  it('gates the docs site assets too, not only the pages', async () => {
    authEnabledMock.mockReturnValue(true);
    sessionUserMock.mockResolvedValue({ id: '2', role: 'teacher', active: true });
    const assetContext = {
      params: Promise.resolve({ slug: ['_next', 'static', 'chunk.css'] }),
    };
    const response = await GET(request(), assetContext);
    expect(response.status).toBe(404);
  });
});
