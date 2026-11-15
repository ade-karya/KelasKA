/**
 * `GET /api/auth/google/start` — begin a Google sign-in.
 *
 * It mints a random `state`, stores a signed short-lived cookie binding that
 * state to this browser (and carrying the deep link to return to), then sends
 * the browser to Google's consent screen. The callback verifies the same
 * cookie before it exchanges the one-time code, so a callback URL replayed in
 * another browser does nothing.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  AUTH_OAUTH_STATE_MAX_AGE_SECONDS,
  authEnabled,
  authPublicBaseUrl,
  authSecret,
  googleOAuthCredentials,
} from '@/lib/server/auth/config';
import { buildGoogleAuthorizationUrl, googleRedirectUri } from '@/lib/server/auth/google-oauth';
import { currentSessionUser, oauthStateCookieHeader } from '@/lib/server/auth/session';
import { signSessionToken } from '@/lib/server/auth/session-token';
import { homeForRole } from '@/lib/server/auth/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only a same-site path is kept as the post-sign-in destination. */
function requestedNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.length > 2_000)
    return '/';
  if (value === '/login' || value.startsWith('/login?')) return '/';
  return value;
}

export async function GET(request: NextRequest) {
  const base = authPublicBaseUrl() ?? request.nextUrl.origin;
  if (!authEnabled()) return NextResponse.redirect(new URL('/', base));

  // A signed-in browser goes to its own home instead of the consent screen.
  const user = await currentSessionUser();
  if (user) return NextResponse.redirect(new URL(homeForRole(user.role), base));

  const credentials = googleOAuthCredentials();
  const secret = authSecret();
  if (!credentials || !secret) {
    return NextResponse.redirect(new URL('/login?error=google_not_configured', base));
  }

  const state = crypto.randomUUID().replace(/-/g, '');
  const next = requestedNext(request.nextUrl.searchParams.get('next'));
  const token = await signSessionToken(
    {
      sid: state,
      sub: encodeURIComponent(next),
      exp: Math.floor(Date.now() / 1000) + AUTH_OAUTH_STATE_MAX_AGE_SECONDS,
    },
    secret,
  );

  const response = NextResponse.redirect(
    buildGoogleAuthorizationUrl({
      credentials,
      redirectUri: googleRedirectUri(base),
      state,
    }),
  );
  response.headers.append(
    'set-cookie',
    oauthStateCookieHeader(token, AUTH_OAUTH_STATE_MAX_AGE_SECONDS),
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}
