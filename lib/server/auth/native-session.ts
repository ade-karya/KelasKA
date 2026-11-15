/**
 * Sign one Supabase-authenticated access token in as a Kelas KA account.
 *
 * The Android app runs the Supabase PKCE handshake itself (Custom Tab + deep
 * link) and ends up holding the Supabase access token. It cannot reuse
 * `/api/auth/supabase/callback` — the one-time code is spent there and the
 * PKCE verifier lives in the browser cookie jar — so it sends the access
 * token here instead. This module verifies the token against Supabase
 * (`GET /auth/v1/user`), maps the Supabase user onto the account row with the
 * exact same rules as the browser callback, and hands back the app's own
 * revocable session. The Supabase tokens are not stored.
 *
 * Kept out of the route for the same reason as `./supabase-identity`: the
 * refusal paths are worth pinning in tests without HTTP or a live database.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import type { AuthUser } from '@/lib/persistence/auth-accounts';
import { markAuthUserSignedIn } from '@/lib/persistence/auth-accounts';

import { ensureAuthBootstrap } from './bootstrap';
import { supabasePublishableKey, supabaseUrl } from './config';
import { resolveGoogleAccount } from './google-signin';
import { authDatabase, createSessionForUser } from './session';
import { googleIdentityFromSupabaseUser, type SupabaseUserLike } from './supabase-identity';

/** Verification against Supabase answers within this window or the sign-in fails. */
const VERIFY_TIMEOUT_MS = 10_000;

/** Refusals the route turns into stable HTTP answers. */
export type NativeSignInResult =
  | {
      readonly kind: 'signed-in';
      readonly user: AuthUser;
      readonly token: string;
      readonly maxAge: number;
    }
  /** The address is known but waits for an admin's approval; no account data. */
  | { readonly kind: 'pending' }
  /** The token is not a valid Supabase token, or the profile cannot map. */
  | { readonly kind: 'refused' };

export interface NativeSignInMeta {
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

export interface NativeSignInDeps {
  /** Injected for tests; production uses the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injected for tests; production opens the persistence pool itself. */
  readonly database?: () => Promise<Queryable>;
  /** Injected for tests; production mints a real session row + signed token. */
  readonly createSession?: typeof createSessionForUser;
}

/**
 * Verify one Supabase access token and, when the account is allowed in, mint a
 * `kelaska_session` token for it. A brand-new address becomes a **pending**
 * account (a row may be created) and gets no session — exactly like the
 * browser callback.
 */
export async function signInWithSupabaseAccessToken(
  accessToken: string,
  meta: NativeSignInMeta = {},
  deps: NativeSignInDeps = {},
): Promise<NativeSignInResult> {
  const base = supabaseUrl();
  const key = supabasePublishableKey();
  if (!base || !key) return { kind: 'refused' };

  // 1. Prove the token is live at Supabase. The service-role key is never
  // involved; `apikey` is the same public key the browser uses.
  const fetchImpl = deps.fetchImpl ?? fetch;
  let userJson: SupabaseUserLike | null = null;
  try {
    const response = await fetchImpl(`${base}/auth/v1/user`, {
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: 'refused' };
    userJson = (await response.json()) as SupabaseUserLike;
  } catch {
    return { kind: 'refused' };
  }

  // 2. Map the Supabase user onto the account row, same refusal paths as web.
  const identity = googleIdentityFromSupabaseUser(userJson);
  if (!identity) return { kind: 'refused' };

  await ensureAuthBootstrap();
  const database = deps.database ?? authDatabase;
  const queryable = await database();
  const user = await resolveGoogleAccount(queryable, identity);
  if (!user) return { kind: 'pending' };

  const session = await (deps.createSession ?? createSessionForUser)(user, meta);
  await markAuthUserSignedIn(queryable, user.id).catch(() => {
    // The stamp is bookkeeping; a failed write must not fail the sign-in.
  });
  return { kind: 'signed-in', user, token: session.token, maxAge: session.maxAge };
}
