/**
 * `POST /api/auth/native/session` — mint a revocable `kelaska_session` for the
 * Android app (and any other native client).
 *
 * The web callback cannot be reused by a native client: the mobile consent
 * runs in a browser (Custom Tab) and its PKCE verifier lives in the app, not
 * in the browser cookie jar. The app therefore performs the Supabase PKCE
 * exchange itself and posts the resulting Supabase **access token** here; this
 * route re-verifies that token against Supabase, maps it onto the account row
 * with the same rules as the browser callback, and returns the app's own
 * revocable session token as JSON. The Supabase tokens are not stored.
 *
 * A brand-new address becomes a **pending** account and gets `403`; an admin
 * approves it from `/admin`. The addresses in `AUTH_ADMIN_EMAILS` are created
 * active on their first sign-in.
 *
 * Auth is not required to *reach* this route (it is the thing that mints
 * sessions); nothing about the account is revealed beyond the documented
 * answers below.
 */
import type { NextRequest } from 'next/server';

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { authEnabled, supabaseAuthConfigured } from '@/lib/server/auth/config';
import { signInWithSupabaseAccessToken } from '@/lib/server/auth/native-session';
import { clientIdentity } from '@/lib/server/client-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A Supabase access token is a JWT; anything absurdly large is not one. */
const MAX_ACCESS_TOKEN_LENGTH = 16_384;

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')?.trim();
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1]! : null;
}

async function readAccessToken(request: NextRequest): Promise<string | null> {
  const fromHeader = bearerToken(request);
  if (fromHeader) return fromHeader;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const token = (body as { accessToken?: unknown } | null)?.accessToken;
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

export async function POST(request: NextRequest) {
  if (!authEnabled()) {
    return apiError('PROVIDER_DISABLED', 503, 'Account sign-in is disabled');
  }
  if (!supabaseAuthConfigured()) {
    return apiError('PROVIDER_DISABLED', 503, 'Google sign-in is not configured');
  }

  const accessToken = await readAccessToken(request);
  if (!accessToken || accessToken.length > MAX_ACCESS_TOKEN_LENGTH) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'accessToken is required');
  }

  const result = await signInWithSupabaseAccessToken(accessToken, {
    userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    ip: clientIdentity(request),
  });

  if (result.kind === 'refused') {
    return apiError('UNAUTHENTICATED', 401, 'The Google sign-in could not be verified');
  }
  if (result.kind === 'pending') {
    return apiError(
      'FORBIDDEN',
      403,
      'Your account is waiting for an admin to approve it',
    );
  }

  const response = apiSuccess({
    token: result.token,
    expiresIn: result.maxAge,
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      role: result.user.role,
    },
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}
