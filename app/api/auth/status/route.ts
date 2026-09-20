import type { NextRequest } from 'next/server';

import { isUserAuthEnabled } from '@/lib/config/feature-flags';
import { apiSuccess } from '@/lib/server/api-response';
import { getAuthenticatedOwnerId } from '@/lib/server/auth/session';
import { findUserById } from '@/lib/server/auth/user-store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const ownerId = await getAuthenticatedOwnerId(req);
  if (!ownerId) {
    const anonymous = apiSuccess({ authenticated: false, enabled: isUserAuthEnabled() });
    anonymous.headers.set('Cache-Control', 'no-store');
    anonymous.headers.set('Pragma', 'no-cache');
    return anonymous;
  }

  const userId = ownerId.startsWith('user:') ? ownerId.slice('user:'.length) : ownerId;
  let username: string | undefined;
  try {
    const user = await findUserById(userId);
    if (user?.username) username = user.username;
  } catch {
    // Username is best-effort; the ownerId is authoritative.
  }

  const response = apiSuccess({
    authenticated: true,
    enabled: isUserAuthEnabled(),
    ownerId,
    ...(username ? { username } : {}),
  });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
}
