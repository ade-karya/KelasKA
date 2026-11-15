/**
 * The rule that turns a verified Google profile into a signed-in account.
 *
 * A bound subject wins, an approved e-mail is bound on its first sign-in, a
 * listed admin address is promoted, and an unknown address becomes a pending
 * account (or is refused when the e-mail already belongs to a *different*
 * Google identity). Kept out of the route so it can be read and tested on its
 * own; the route owns HTTP, cookies and redirects.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import {
  bindAuthUserGoogleSub,
  createAuthUser,
  findAuthUserByEmail,
  findAuthUserByGoogleSub,
  updateAuthUser,
  type AuthUser,
} from '@/lib/persistence/auth-accounts';
import { isAuthAdminEmail } from './config';

export interface GoogleIdentity {
  /** Google's stable account id. */
  readonly subject: string;
  readonly email: string;
  readonly name: string;
}

/**
 * The account this Google identity may sign in to, or `null` when it must wait
 * for an admin's approval. A pending row is still created, so the admin sees
 * the request in `/admin`.
 */
export async function resolveGoogleAccount(
  queryable: Queryable,
  identity: GoogleIdentity,
): Promise<AuthUser | null> {
  let user = await findAuthUserByGoogleSub(queryable, identity.subject);

  if (!user) {
    const byEmail = await findAuthUserByEmail(queryable, identity.email);
    if (byEmail) {
      // The address belongs to another Google identity: refuse instead of
      // handing this person the other account.
      if (byEmail.googleSub && byEmail.googleSub !== identity.subject) return null;
      if (!byEmail.googleSub) {
        await bindAuthUserGoogleSub(queryable, byEmail.id, identity.subject);
      }
      user = byEmail;
    }
  }

  const isAdminAddress = isAuthAdminEmail(identity.email);
  if (!user) {
    const created = await createAuthUser(queryable, {
      email: identity.email,
      name: identity.name,
      role: isAdminAddress ? 'admin' : 'student',
      active: isAdminAddress,
      googleSub: identity.subject,
    });
    return created.active ? created : null;
  }

  // A configured admin address is promoted on sign-in, even if it was created
  // pending before the operator added it to AUTH_ADMIN_EMAILS.
  if (isAdminAddress && (user.role !== 'admin' || !user.active)) {
    user = (await updateAuthUser(queryable, user.id, { role: 'admin', active: true })) ?? user;
  }

  return user.active ? user : null;
}
