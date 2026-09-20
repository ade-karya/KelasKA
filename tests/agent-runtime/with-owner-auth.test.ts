import { describe, expect, it, vi } from 'vitest';

import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';

function request(): Request {
  return new Request('http://localhost/api/agent/sessions', { method: 'POST' });
}

describe('withRequestOwnerId login gate', () => {
  it('lets anonymous owners through when login is not required', async () => {
    delete process.env.USER_AUTH_ENABLED;
    const handler = vi.fn(async () => new Response('ok'));
    const response = await withRequestOwnerId(request(), handler);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const ownerId = handler.mock.calls[0]?.[0] as string;
    expect(ownerId.startsWith('anon:')).toBe(true);
  });

  it('returns 401 without reaching the handler when login is required', async () => {
    process.env.USER_AUTH_ENABLED = 'true';
    try {
      const handler = vi.fn(async () => new Response('ok'));
      const response = await withRequestOwnerId(request(), handler);
      expect(response.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({
        success: false,
        errorCode: 'UNAUTHENTICATED',
      });
    } finally {
      delete process.env.USER_AUTH_ENABLED;
    }
  });
});
