/**
 * Mapping a Supabase Auth user onto the identity the account layer binds.
 *
 * Supabase finishes the Google handshake and hands back its own user object.
 * Everything the account layer needs is in it: the Google `sub` to bind the
 * row to (never the e-mail alone), the verified flag and a display name. The
 * mapping is kept pure so the approval rules in `./google-signin.ts` can be
 * reused untouched and the refusal paths can be unit-tested.
 */
import { normalizeAuthEmail } from '@/lib/persistence/auth-accounts';

import type { GoogleIdentity } from './google-signin';

/** The shape of the Supabase user object this mapper reads. */
export interface SupabaseUserLike {
  /** Supabase's own id; used as a fallback subject only when no provider sub exists. */
  readonly id?: string | null;
  readonly email?: string | null;
  readonly email_confirmed_at?: string | null;
  readonly user_metadata?: Record<string, unknown> | null;
  readonly app_metadata?: Record<string, unknown> | null;
  readonly identities?: ReadonlyArray<{
    readonly provider?: string | null;
    readonly identity_data?: Record<string, unknown> | null;
  }> | null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanFlag(value: unknown): boolean {
  return value === true;
}

/**
 * The Google identity for one Supabase user, or `null` when the sign-in must
 * be refused: no e-mail, an unverified e-mail (an unverified address could be
 * another person's; never approve or bind by it) or no stable subject to bind.
 */
export function googleIdentityFromSupabaseUser(
  user: SupabaseUserLike | null | undefined,
): GoogleIdentity | null {
  if (!user) return null;

  const email = nonEmptyString(user.email)?.toLowerCase();
  if (!email) return null;

  // Prefer the Google identity's data; fall back to the first identity that
  // carries a subject (the only provider this deployment enables is Google).
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const google =
    identities.find((identity) => identity?.provider === 'google') ??
    identities.find((identity) => Boolean(identity?.identity_data));
  const identityData = google?.identity_data ?? {};
  const metadata = user.user_metadata ?? {};

  const verified =
    booleanFlag(identityData.email_verified) ||
    booleanFlag(metadata.email_verified) ||
    nonEmptyString(user.email_confirmed_at) !== undefined;
  if (!verified) return null;

  // Google's stable account id. A Supabase project keeps it in
  // `identities[].identity_data.sub`; only if it is absent do we fall back to
  // Supabase's own user id (still stable per project, still not the e-mail).
  const subject = nonEmptyString(identityData.sub) ?? nonEmptyString(user.id);
  if (!subject) return null;

  const name =
    nonEmptyString(metadata.full_name) ??
    nonEmptyString(metadata.name) ??
    nonEmptyString(metadata.user_name) ??
    normalizeAuthEmail(email).split('@')[0]!;

  return { subject, email: normalizeAuthEmail(email), name };
}
