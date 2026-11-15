/**
 * `GET /api/admin/users` — list accounts, `POST` — create one.
 *
 * Admin only. The role comes from the database on every request (the owner
 * method re-reads it), so a promoted or demoted account takes effect on its
 * next call without signing out. Like every owner-scoped route it resolves
 * through `withRequestOwner`, which also means an unsigned request is a 401
 * before the role check runs.
 */
import type { NextRequest } from 'next/server';

import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import {
  AuthEmailTakenError,
  createAuthUser,
  listAuthUsers,
  sortAuthUsers,
} from '@/lib/persistence/auth-accounts';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { authDatabase } from '@/lib/server/auth/session';
import { apiKeySummaries } from '@/lib/server/auth/user-api-keys';
import { validEmail, validName } from '@/lib/server/auth/validation';
import { isAuthRole, type AuthRole } from '@/lib/server/auth/config';
import { principalHasRole, OWNER_ROLES } from '@/lib/server/identity';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return withRequestOwner(
    { headers: request.headers, method: request.method, url: request.url },
    async (principal) => {
      if (!principalHasRole(principal, OWNER_ROLES.admin)) {
        return apiError('FORBIDDEN', 403, 'Admin access required');
      }
      const queryable = await authDatabase();
      const users = sortAuthUsers(await listAuthUsers(queryable));
      const keySummaries = await apiKeySummaries(queryable, users);
      const withKeys = users.map((user) => ({
        ...user,
        apiKey: keySummaries.get(user.id) ?? {
          exempt: user.apiKeyExempt,
          status: 'none',
          keys: [],
        },
      }));
      const response = apiSuccess({ users: withKeys });
      response.headers.set('cache-control', 'no-store');
      return response;
    },
  );
}

export async function POST(request: NextRequest) {
  return withRequestOwner(
    { headers: request.headers, method: request.method, url: request.url },
    async (principal) => {
      if (!principalHasRole(principal, OWNER_ROLES.admin)) {
        return apiError('FORBIDDEN', 403, 'Admin access required');
      }
      if (!isSameOriginJsonRequest(request)) {
        return apiError('FORBIDDEN', 403, 'Account changes must be same-origin JSON requests');
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
      }
      const input = (body ?? {}) as {
        email?: unknown;
        name?: unknown;
        role?: unknown;
      };
      const email = validEmail(input.email);
      const name = validName(input.name);
      const role: AuthRole | undefined = isAuthRole(input.role) ? input.role : undefined;
      if (!email || !name || !role) {
        return apiError(
          'INVALID_REQUEST',
          400,
          'email, name and role (student|teacher|admin) are required',
        );
      }

      try {
        // An account an admin creates is approved by definition; the person
        // signs in with that Google address whenever they use the app.
        const user = await createAuthUser(await authDatabase(), {
          email,
          name,
          role,
          active: true,
        });
        return apiSuccess({ user }, 201);
      } catch (error) {
        if (error instanceof AuthEmailTakenError) {
          return apiError('EMAIL_TAKEN', 409, 'That e-mail address already has an account');
        }
        console.error('[auth] the account could not be created', error);
        return apiError('INTERNAL_ERROR', 500, 'The account could not be created');
      }
    },
  );
}
