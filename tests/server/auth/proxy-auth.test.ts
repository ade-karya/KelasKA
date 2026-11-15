import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { proxy } from '@/proxy';
import { AUTH_COOKIE } from '@/lib/server/auth/config';
import { signSessionToken } from '@/lib/server/auth/session-token';

const SECRET = 'proxy-test-secret';

function request(pathname: string, cookieValue?: string): NextRequest {
  const headers = new Headers();
  if (cookieValue !== undefined) headers.set('cookie', `${AUTH_COOKIE}=${cookieValue}`);
  return new NextRequest(`http://localhost${pathname}`, { method: 'GET', headers });
}

async function sessionToken(expSeconds = Math.floor(Date.now() / 1000) + 3600): Promise<string> {
  return signSessionToken(
    { sid: 'c2Vzc2lvbi1pZC10aGF0LWlzLWxvbmcgZW5vdWdo', sub: 'user-123', exp: expSeconds },
    SECRET,
  );
}

describe('the proxy account gate', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_SECRET = SECRET;
    delete process.env.ACCESS_CODE;
    delete process.env.OPENMAIC_SECRET_KEY;
  });

  afterEach(() => {
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_SECRET;
    delete process.env.ACCESS_CODE;
  });

  it('sends a signed-out page request to the login page with the path it asked for', async () => {
    const response = await proxy(request('/workspace?tab=chat'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?next=%2Fworkspace%3Ftab%3Dchat',
    );
  });

  it('answers a signed-out API request with 401 instead of running its handler', async () => {
    const response = await proxy(request('/api/persistence/sessions'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ errorCode: 'UNAUTHENTICATED' });
  });

  it('lets a signed-in request through, leaving /login to the page itself', async () => {
    const token = await sessionToken();

    const api = await proxy(request('/api/persistence/sessions', token));
    expect(api.status).toBe(200);
    expect(api.headers.get('x-middleware-next')).toBe('1');

    // The proxy cannot know whether the session row still exists, so it never
    // redirects /login on a merely valid signature (that would loop a revoked
    // session). The login page resolves the account and redirects a live one.
    const login = await proxy(request('/login', token));
    expect(login.status).toBe(200);
    expect(login.headers.get('x-middleware-next')).toBe('1');
  });

  it('refuses an expired cookie and clears it on the way out', async () => {
    const expired = await sessionToken(Math.floor(Date.now() / 1000) - 3600);

    const response = await proxy(request('/api/persistence/sessions', expired));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_COOKIE}=;`);
  });

  it('refuses a forged cookie', async () => {
    const response = await proxy(request('/api/persistence/sessions', 'v1.abc.def'));

    expect(response.status).toBe(401);
  });

  it('keeps the login surface reachable while signed out', async () => {
    for (const pathname of ['/login', '/api/auth/login', '/api/auth/me', '/api/health']) {
      const response = await proxy(request(pathname));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('does not fall back to the shared access code once accounts are on', async () => {
    process.env.ACCESS_CODE = 'a-long-enough-access-code';

    const response = await proxy(request('/api/persistence/sessions'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ errorCode: 'UNAUTHENTICATED' });
  });

  it('answers 503 when authentication is on without a signing secret', async () => {
    delete process.env.AUTH_SECRET;

    const api = await proxy(request('/api/persistence/sessions'));
    expect(api.status).toBe(503);

    const page = await proxy(request('/'));
    expect(page.status).toBe(503);
  });

  it('leaves the deployment untouched when accounts are off', async () => {
    delete process.env.AUTH_ENABLED;

    const response = await proxy(request('/api/persistence/sessions'));

    expect(response.status).not.toBe(401);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
