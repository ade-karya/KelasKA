/**
 * `GET /api/auth/supabase/callback` — finish a Supabase Google sign-in.
 *
 * Supabase arrives here after the consent screen with the one-time code the
 * browser's PKCE verifier (kept in cookies by `@supabase/ssr`) can redeem.
 * The code is exchanged, the Supabase user mapped onto the account row, and a
 * brand-new e-mail address becomes a **pending** account (no session): an
 * admin approves it and picks its role from `/admin`. The addresses in
 * `AUTH_ADMIN_EMAILS` are created as active admins on their first sign-in.
 * The Supabase tokens are discarded; approved accounts get the ordinary
 * revocable `kelaska_session` cookie and land on the home their role owns.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { markAuthUserSignedIn, type AuthUser } from '@/lib/persistence/auth-accounts';
import { createLogger } from '@/lib/logger';
import { ensureAuthBootstrap } from '@/lib/server/auth/bootstrap';
import { authEnabled, supabaseAuthConfigured } from '@/lib/server/auth/config';
import { resolveGoogleAccount } from '@/lib/server/auth/google-signin';
import { safeNextPath } from '@/lib/server/auth/guards';
import { authDatabase, createSessionForUser, sessionCookieHeader } from '@/lib/server/auth/session';
import { googleIdentityFromSupabaseUser } from '@/lib/server/auth/supabase-identity';
import { clientIdentity } from '@/lib/server/client-identity';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';
import { createSupabaseHandshakeClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('Auth');

/** The short-lived cookie carrying the post-sign-in deep link. */
const NEXT_COOKIE = 'kelaska_oauth_next';

function clearNextCookieHeader(): string {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return `${NEXT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

/** Where a refused sign-in returns; the login page maps the code to a message. */
function loginError(origin: string, code: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
  response.headers.set('cache-control', 'no-store');
  return response;
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!authEnabled()) return NextResponse.redirect(new URL('/', origin));
  if (!supabaseAuthConfigured()) return loginError(origin, 'google_not_configured');

  // The consent screen itself can bounce here with an error instead of a code.
  const consentError = request.nextUrl.searchParams.get('error');
  if (consentError) {
    return loginError(origin, consentError === 'access_denied' ? 'google_denied' : 'google_failed');
  }

  const code = request.nextUrl.searchParams.get('code');
  if (!code) return loginError(origin, 'google_failed');

  // 1. Redeem the code (the verifier rides in the browser's cookies).
  const supabase = createSupabaseHandshakeClient(request);
  if (!supabase) return loginError(origin, 'google_not_configured');

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    log.warn('the Supabase code exchange failed', error);
    return loginError(origin, 'google_failed');
  }

  const identity = googleIdentityFromSupabaseUser(data.user);
  if (!identity) return loginError(origin, 'google_failed');

  // 2. Decide the account. The schema is guaranteed before the first write.
  try {
    await ensureAuthBootstrap();
    const queryable = await authDatabase();
    const user: AuthUser | null = await resolveGoogleAccount(queryable, identity);
    if (!user) {
      // The pending row (if one was created) is an admin's to approve now; the
      // browser gets a neutral message, never whether the address exists.
      return loginError(origin, 'pending');
    }

    const session = await createSessionForUser(user, {
      userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      ip: clientIdentity(request),
    });
    await markAuthUserSignedIn(queryable, user.id).catch((cause) => {
      log.warn('the last-login stamp could not be written', cause);
    });

    // The deep link the login button stored before leaving for Supabase
    // (the redirect URL itself must exactly match a Redirect URLs entry).
    let next: string | null = null;
    const rawNext = request.cookies.get(NEXT_COOKIE)?.value;
    if (rawNext) {
      try {
        next = decodeURIComponent(rawNext);
      } catch {
        next = null;
      }
    }
    const response = NextResponse.redirect(new URL(safeNextPath(next, user.role), origin), 303);
    response.headers.append('set-cookie', sessionCookieHeader(session.token, session.maxAge));
    response.headers.append('set-cookie', clearNextCookieHeader());
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch (cause) {
    log.error('the Supabase sign-in could not be resolved', cause);
    return loginError(origin, 'google_failed');
  }
}
