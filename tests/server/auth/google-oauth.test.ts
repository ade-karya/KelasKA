import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GoogleOAuthError,
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserProfile,
  googleRedirectUri,
  requireGoogleOAuthCredentials,
} from '@/lib/server/auth/google-oauth';

const CREDENTIALS = { clientId: 'client-id', clientSecret: 'client-secret' };
const ENV = [
  'AUTH_GOOGLE_CLIENT_ID',
  'AUTH_GOOGLE_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
];

describe('Google sign-in helpers', () => {
  const originals = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of ENV) {
      originals.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of ENV) {
      const value = originals.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    originals.clear();
  });

  it('derives the redirect URI from the public base URL', () => {
    expect(googleRedirectUri('https://kelaska.riau.ai')).toBe(
      'https://kelaska.riau.ai/api/auth/google/callback',
    );
    expect(googleRedirectUri('https://kelaska.riau.ai/')).toBe(
      'https://kelaska.riau.ai/api/auth/google/callback',
    );
  });

  it('asks for the identity scopes and the account chooser', () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        credentials: CREDENTIALS,
        redirectUri: 'https://kelaska.riau.ai/api/auth/google/callback',
        state: 'state-123',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://kelaska.riau.ai/api/auth/google/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('state-123');
    // Shared school devices: never silently reuse the browser's active account.
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('treats a deployment without a Google client as not configured', () => {
    expect(() => requireGoogleOAuthCredentials()).toThrowError(GoogleOAuthError);
    try {
      requireGoogleOAuthCredentials();
    } catch (error) {
      expect((error as GoogleOAuthError).code).toBe('not-configured');
    }
  });

  it('prefers AUTH_GOOGLE_* and falls back to GOOGLE_*', () => {
    process.env.GOOGLE_CLIENT_ID = 'short-id';
    process.env.GOOGLE_CLIENT_SECRET = 'short-secret';
    expect(requireGoogleOAuthCredentials()).toEqual({
      clientId: 'short-id',
      clientSecret: 'short-secret',
    });

    process.env.AUTH_GOOGLE_CLIENT_ID = 'auth-id';
    process.env.AUTH_GOOGLE_CLIENT_SECRET = 'auth-secret';
    expect(requireGoogleOAuthCredentials()).toEqual({
      clientId: 'auth-id',
      clientSecret: 'auth-secret',
    });
  });

  it('exchanges the one-time code for an access token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'token' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      exchangeGoogleAuthorizationCode({
        credentials: CREDENTIALS,
        redirectUri: 'https://kelaska.riau.ai/api/auth/google/callback',
        code: 'one-time',
      }),
    ).resolves.toBe('token');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('one-time');
    expect(body.get('client_secret')).toBe('client-secret');
  });

  it('reports a refused code exchange', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad code' }), {
            status: 400,
          }),
      ),
    );

    await expect(
      exchangeGoogleAuthorizationCode({
        credentials: CREDENTIALS,
        redirectUri: 'https://kelaska.riau.ai/api/auth/google/callback',
        code: 'stale',
      }),
    ).rejects.toMatchObject({ name: 'GoogleOAuthError', code: 'token-exchange-failed' });
  });

  it('reads a verified profile and normalizes the address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sub: 'google-1',
              email: 'Guru@Sekolah.ID',
              email_verified: true,
              name: '  Bu Guru  ',
            }),
          ),
      ),
    );

    await expect(fetchGoogleUserProfile('token')).resolves.toEqual({
      subject: 'google-1',
      email: 'guru@sekolah.id',
      name: 'Bu Guru',
    });
  });

  it('refuses an unverified address, another person could own it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ sub: 'google-1', email: 'x@sekolah.id', email_verified: false }),
          ),
      ),
    );

    await expect(fetchGoogleUserProfile('token')).rejects.toMatchObject({
      name: 'GoogleOAuthError',
      code: 'email-unverified',
    });
  });

  it('refuses a profile without a stable subject', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ email: 'x@sekolah.id', email_verified: true })),
      ),
    );

    await expect(fetchGoogleUserProfile('token')).rejects.toMatchObject({
      name: 'GoogleOAuthError',
      code: 'profile-unavailable',
    });
  });
});
