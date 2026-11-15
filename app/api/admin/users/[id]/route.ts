/**
 * `PATCH /api/admin/users/[id]` — change an account; `DELETE` — remove it.
 *
 * Admin only, with two invariant guards:
 *
 * - an admin cannot demote or deactivate their own account (otherwise a single
 *   click locks the console for everyone), and
 * - the last active admin can be neither demoted, deactivated nor deleted.
 *
 * Deactivating or deleting an account drops its sessions immediately; a role
 * change does not, because the role is read from the database on every request.
 */
import type { NextRequest } from 'next/server';

import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import {
  countActiveAdmins,
  deleteAuthUser,
  deleteAuthUserSessions,
  findAuthUserById,
  updateAuthUser,
  type UpdateAuthUserInput,
} from '@/lib/persistence/auth-accounts';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { isAuthRole, type AuthRole } from '@/lib/server/auth/config';
import { authDatabase, authUserIdFromOwnerId } from '@/lib/server/auth/session';
import { validName } from '@/lib/server/auth/validation';
import { principalHasRole, OWNER_ROLES, type OwnerPrincipal } from '@/lib/server/identity';
import { withRequestOwner } from '@/lib/server/identity/with-owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function requireAdmin(principal: OwnerPrincipal) {
  return principalHasRole(principal, OWNER_ROLES.admin);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  return withRequestOwner(
    { headers: request.headers, method: request.method, url: request.url },
    async (principal) => {
      if (!requireAdmin(principal)) {
        return apiError('FORBIDDEN', 403, 'Admin access required');
      }
      if (!isSameOriginJsonRequest(request)) {
        return apiError('FORBIDDEN', 403, 'Account changes must be same-origin JSON requests');
      }

      const { id } = await params;
      const queryable = await authDatabase();
      const target = await findAuthUserById(queryable, id);
      if (!target) return apiError('INVALID_REQUEST', 404, 'Account not found');

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
      }
      const input = (body ?? {}) as {
        name?: unknown;
        role?: unknown;
        active?: unknown;
      };

      const patch: {
        -readonly [K in keyof UpdateAuthUserInput]: UpdateAuthUserInput[K];
      } = {};
      if (input.name !== undefined) {
        const name = validName(input.name);
        if (!name) {
          return apiError('INVALID_REQUEST', 400, 'A name between 1 and 80 characters is required');
        }
        patch.name = name;
      }
      let role: AuthRole | undefined;
      if (input.role !== undefined) {
        if (!isAuthRole(input.role)) {
          return apiError('INVALID_REQUEST', 400, 'role must be student, teacher or admin');
        }
        role = input.role;
        patch.role = role;
      }
      if (input.active !== undefined) {
        if (typeof input.active !== 'boolean') {
          return apiError('INVALID_REQUEST', 400, 'active must be a boolean');
        }
        patch.active = input.active;
      }

      const self = authUserIdFromOwnerId(principal.ownerId);
      if (self === target.id) {
        if (role !== undefined && role !== target.role) {
          return apiError('SELF_EDIT_REFUSED', 400, 'You cannot change your own role');
        }
        if (patch.active === false) {
          return apiError('SELF_EDIT_REFUSED', 400, 'You cannot deactivate your own account');
        }
      }

      const demotingOrDeactivating =
        target.role === 'admin' &&
        target.active &&
        ((role !== undefined && role !== 'admin') || patch.active === false);
      if (demotingOrDeactivating && (await countActiveAdmins(queryable)) <= 1) {
        return apiError(
          'LAST_ADMIN',
          409,
          'The last active admin cannot be demoted or deactivated',
        );
      }

      const updated = await updateAuthUser(queryable, target.id, patch);
      if (!updated) return apiError('INVALID_REQUEST', 404, 'Account not found');
      // Deactivation is also revocation: the account's sessions stop resolving.
      if (updated.active === false) await deleteAuthUserSessions(queryable, updated.id);
      return apiSuccess({ user: updated });
    },
  );
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return withRequestOwner(
    { headers: request.headers, method: request.method, url: request.url },
    async (principal) => {
      if (!requireAdmin(principal)) {
        return apiError('FORBIDDEN', 403, 'Admin access required');
      }
      if (!isSameOriginJsonRequest(request)) {
        return apiError('FORBIDDEN', 403, 'Account changes must be same-origin JSON requests');
      }

      const { id } = await params;
      const queryable = await authDatabase();
      const target = await findAuthUserById(queryable, id);
      if (!target) return apiError('INVALID_REQUEST', 404, 'Account not found');
      if (authUserIdFromOwnerId(principal.ownerId) === target.id) {
        return apiError('SELF_EDIT_REFUSED', 400, 'You cannot delete your own account');
      }
      if (target.role === 'admin' && target.active && (await countActiveAdmins(queryable)) <= 1) {
        return apiError('LAST_ADMIN', 409, 'The last active admin cannot be deleted');
      }

      await deleteAuthUser(queryable, target.id);
      return apiSuccess({ deleted: true });
    },
  );
}
