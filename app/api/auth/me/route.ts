/**
 * `GET /api/auth/me` — who this browser is signed in as.
 *
 * The account menus, the session provider and the login page's signed-in
 * redirect all read this. It answers `{ enabled: false }` when the account
 * layer is off, so the classic home and the workspace keep their local-profile
 * behaviour on an upstream deployment.
 */
import type { NextRequest } from 'next/server';

import { apiSuccess } from '@/lib/server/api-response';
import { authEnabled, roleHomePath } from '@/lib/server/auth/config';
import { sessionUserFromHeaders } from '@/lib/server/auth/session';
import { isWorkbenchEntryEnabled } from '@/lib/workbench/entry-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!authEnabled()) return apiSuccess({ enabled: false, user: null });

  const user = await sessionUserFromHeaders(request.headers);
  const response = apiSuccess({
    enabled: true,
    user,
    redirectTo: user ? roleHomePath(user.role, isWorkbenchEntryEnabled()) : null,
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}
