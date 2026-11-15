/**
 * `PATCH /api/auth/account` — change the signed-in account's display name.
 *
 * The e-mail and role are administrative: a teacher or admin changes them from
 * the user console, never from the account page.
 */
import type { NextRequest } from 'next/server';

import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { updateAuthUser } from '@/lib/persistence/auth-accounts';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { authDatabase, sessionUserFromHeaders } from '@/lib/server/auth/session';
import { validName } from '@/lib/server/auth/validation';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest) {
  if (!isSameOriginJsonRequest(request)) {
    return apiError('FORBIDDEN', 403, 'Account changes must be same-origin JSON requests');
  }
  const user = await sessionUserFromHeaders(request.headers);
  if (!user) return apiError('UNAUTHENTICATED', 401, 'Sign in required');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }
  const name = validName((body as { name?: unknown } | null)?.name);
  if (!name)
    return apiError('INVALID_REQUEST', 400, 'A name between 1 and 80 characters is required');

  const updated = await updateAuthUser(await authDatabase(), user.id, { name });
  if (!updated) return apiError('UNAUTHENTICATED', 401, 'Sign in required');
  const response = apiSuccess({ user: updated });
  response.headers.set('cache-control', 'no-store');
  return response;
}
