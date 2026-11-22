/**
 * `POST /api/auth/spa/session` — mint the app cookie for the static SPA.
 *
 * The SPA cannot reuse the native session route because a browser may not set
 * a `Cookie` header from JavaScript: this route re-verifies the Supabase
 * access token and returns `kelaska_session` as an HttpOnly SameSite=Lax
 * cookie instead. The session app (not Vercel) answers it, via the Worker.
 */
import type { NextRequest } from 'next/server';

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { authEnabled, supabaseAuthConfigured } from '@/lib/server/auth/config';
import { signInWithSupabaseAccessToken } from '@/lib/server/auth/native-session';
import { clearSessionCookieHeader, sessionCookieHeader } from '@/lib/server/auth/session';
import { clientIdentity } from '@/lib/server/client-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ACCESS_TOKEN_LENGTH = 16_384;

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')?.trim();
  return /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null;
}

export async function POST(request: NextRequest) {
  if (!authEnabled() || !supabaseAuthConfigured()) {
    return apiError('PROVIDER_DISABLED', 503, 'Google sign-in is not configured');
  }
  const accessToken = bearerToken(request);
  if (!accessToken || accessToken.length > MAX_ACCESS_TOKEN_LENGTH) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Bearer access token is required');
  }

  const result = await signInWithSupabaseAccessToken(accessToken, {
    userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    ip: clientIdentity(request),
  });
  if (result.kind === 'refused') {
    return apiError('UNAUTHENTICATED', 401, 'The Google sign-in could not be verified');
  }
  if (result.kind === 'pending') {
    return apiError('FORBIDDEN', 403, 'Your account is waiting for an admin to approve it');
  }

  const response = apiSuccess({
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      role: result.user.role,
    },
  });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('set-cookie', sessionCookieHeader(result.token, result.maxAge));
  return response;
}

export async function DELETE() {
  const response = apiSuccess({ signedOut: true });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('set-cookie', clearSessionCookieHeader());
  return response;
}
