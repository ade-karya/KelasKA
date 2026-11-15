/**
 * The host's owner auth method: one signed session cookie per account.
 *
 * This is the seam `lib/server/identity/host/README.md` describes. Registering
 * it (from `instrumentation.node.ts`, before the server answers a request)
 * makes every owner-scoped route resolve a signed-in account to its own owner
 * id, and refuses an anonymous fallback: with accounts on, a request without a
 * session is answered 401 rather than silently becoming a new anonymous owner.
 *
 * A token that is present but invalid, expired or revoked answers `invalid`
 * (not `not-applicable`), so a broken cookie can never quietly downgrade into
 * a different identity.
 */
import { configureOwnerAuthentication, type OwnerAuthMethod } from '@/lib/server/identity';
import { authEnabled } from '@/lib/server/auth/config';
import {
  principalForAuthUser,
  readSessionCookieFromHeaders,
  sessionUserFromHeaders,
  sessionUserFromToken,
} from '@/lib/server/auth/session';

export const HOST_SESSION_METHOD_NAME = 'hostSessionCookie';

export const hostSessionCookieMethod: OwnerAuthMethod = {
  name: HOST_SESSION_METHOD_NAME,

  async authenticate(req) {
    if (!authEnabled()) return { status: 'not-applicable' };
    if (!readSessionCookieFromHeaders(req.headers)) return { status: 'not-applicable' };
    const user = await sessionUserFromHeaders(req.headers);
    if (!user) return { status: 'invalid', reason: 'the account session is expired or revoked' };
    return { status: 'authenticated', principal: principalForAuthUser(user) };
  },

  async authenticateFromContext() {
    if (!authEnabled()) return { status: 'not-applicable' };
    const { cookies } = await import('next/headers');
    const { AUTH_COOKIE } = await import('@/lib/server/auth/config');
    const token = (await cookies()).get(AUTH_COOKIE)?.value;
    if (!token) return { status: 'not-applicable' };
    const user = await sessionUserFromToken(token);
    if (!user) return { status: 'invalid', reason: 'the account session is expired or revoked' };
    return { status: 'authenticated', principal: principalForAuthUser(user) };
  },

  describeStoredOwner(ownerId) {
    return ownerId.startsWith('user:') ? { kind: 'user' } : undefined;
  },
};

let registered = false;

/**
 * Register the session method once per process. No-op when accounts are off, so
 * an upstream deployment keeps the anonymous-owner behaviour untouched.
 */
export function registerHostSessionAuthentication(): void {
  if (registered || !authEnabled()) return;
  registered = true;
  // Page responses must stop minting anonymous owners: the method turns the
  // fallback off, and a cookie no request resolves to would only become a claim
  // candidate on every cookieless load. The Edge proxy also skips minting when
  // authentication is on; this keeps the Node side consistent even when the
  // operator did not set the variable.
  if (!process.env.OWNER_ANONYMOUS_PREMINT) process.env.OWNER_ANONYMOUS_PREMINT = 'false';
  configureOwnerAuthentication({
    methods: [hostSessionCookieMethod],
    anonymousFallback: false,
  });
}

/** Test hook: forget the registration so a suite can register again. */
export function resetHostSessionAuthenticationForTests(): void {
  registered = false;
}
