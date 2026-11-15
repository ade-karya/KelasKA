/**
 * `POST /api/auth/logout` — revoke this browser's session and clear its cookie.
 *
 * The database row is dropped, so a copied cookie stops working immediately;
 * every other session of the account stays signed in (an admin deactivating
 * the account is what ends those).
 */
import type { NextRequest } from 'next/server';

import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { clearSessionCookieHeader, destroySessionFromHeaders } from '@/lib/server/auth/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isSameOriginJsonRequest(request)) {
    return apiError('FORBIDDEN', 403, 'Logout must be a same-origin JSON request');
  }
  await destroySessionFromHeaders(request.headers);
  const response = apiSuccess({ signedOut: true });
  response.headers.append('set-cookie', clearSessionCookieHeader());
  response.headers.set('cache-control', 'no-store');
  return response;
}
