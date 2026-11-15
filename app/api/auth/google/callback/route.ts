/**
 * `GET /api/auth/google/callback` — finish a Google sign-in.
 *
 * The state cookie is checked first, then the one-time code is exchanged and
 * the profile read. A brand-new address becomes a **pending** account (no
 * session): an admin approves it and picks its role from `/admin`. The
 * addresses in `AUTH_ADMIN_EMAILS` are the exception — they are created as
 * active admins on their first sign-in, which is how the first approval can
 * happen at all. An approved account gets the ordinary revocable session
 * cookie and lands on the home its role owns.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { markAuthUserSignedIn, type AuthUser } from '@/lib/persistence/auth-accounts';
import { createLogger } from '@/lib/logger';
import { ensureAuthBootstrap } from '@/lib/server/auth/bootstrap';
import {
  AUTH_OAUTH_STATE_COOKIE,
  authEnabled,
  authPublicBaseUrl,
  authSecret,
} from '@/lib/server/auth/config';
import {
  GoogleOAuthError,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserProfile,
  googleRedirectUri,
  requireGoogleOAuthCredentials,
} from '@/lib/server/auth/google-oauth';
import { resolveGoogleAccount } from '@/lib/server/auth/google-signin';
import { safeNextPath } from '@/lib/server/auth/guards';
import {
  authDatabase,
  clearOAuthStateCookieHeader,
  createSessionForUser,
  sessionCookieHeader,
} from '@/lib/server/auth/session';
import { verifySessionToken } from '@/lib/server/auth/session-token';
import { clientIdentity } from '@/lib/server/client-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('Auth');

/** Where a refused sign-in returns; the login page maps the code to a message. */
function loginError(base: string, code: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/login?error=${code}`, base));
  response.headers.append('set-cookie', clearOAuthStateCookieHeader());
  response.headers.set('cache-control', 'no-store');
  return response;
}

function decodeNext(payloadSub: string): string {
  try {
    return decodeURIComponent(payloadSub);
  } catch {
    return '/';
  }
}

export async function GET(request: NextRequest) {
  const base = authPublicBaseUrl() ?? request.nextUrl.origin;
  if (!authEnabled()) return NextResponse.redirect(new URL('/', base));

  const secret = authSecret();
  if (!secret) return loginError(base, 'google_not_configured');

  // 1. State: the callback must come from this browser's start route.
  const stateCookie = request.cookies.get(AUTH_OAUTH_STATE_COOKIE)?.value;
  const statePayload = stateCookie ? await verifySessionToken(stateCookie, secret) : null;
  const state = request.nextUrl.searchParams.get('state');
  if (!statePayload || !state || statePayload.sid !== state) {
    return loginError(base, 'google_state');
  }

  const error = request.nextUrl.searchParams.get('error');
  if (error) return loginError(base, error === 'access_denied' ? 'google_denied' : 'google_failed');

  const code = request.nextUrl.searchParams.get('code');
  if (!code) return loginError(base, 'google_failed');

  // 2. Exchange the code and read the verified profile.
  let profile;
  try {
    const accessToken = await exchangeGoogleAuthorizationCode({
      credentials: requireGoogleOAuthCredentials(),
      redirectUri: googleRedirectUri(base),
      code,
    });
    profile = await fetchGoogleUserProfile(accessToken);
  } catch (cause) {
    const reason =
      cause instanceof GoogleOAuthError && cause.code === 'not-configured'
        ? 'google_not_configured'
        : 'google_failed';
    log.warn('Google sign-in failed', cause);
    return loginError(base, reason);
  }

  // 3. Decide the account. The schema is guaranteed before the first write.
  let user: AuthUser | null;
  try {
    await ensureAuthBootstrap();
    const queryable = await authDatabase();
    user = await resolveGoogleAccount(queryable, profile);
    if (!user) {
      // The pending row (if one was created) is an admin's to approve now; the
      // browser gets a neutral message, never whether the address exists.
      return loginError(base, 'pending');
    }

    const session = await createSessionForUser(user, {
      userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      ip: clientIdentity(request),
    });
    await markAuthUserSignedIn(queryable, user.id).catch((cause) => {
      log.warn('the last-login stamp could not be written', cause);
    });

    const response = NextResponse.redirect(
      new URL(safeNextPath(decodeNext(statePayload.sub), user.role), base),
      303,
    );
    response.headers.append('set-cookie', sessionCookieHeader(session.token, session.maxAge));
    response.headers.append('set-cookie', clearOAuthStateCookieHeader());
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (cause) {
    log.error('the Google sign-in could not be resolved', cause);
    return loginError(base, 'google_failed');
  }
}
