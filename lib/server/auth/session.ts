/**
 * Account sessions on the server: the cookie, the signed token, the database
 * row behind it, and the owner principal every request resolves to.
 *
 * A signed-in account is an owner like any other, with the id `user:<uuid>`.
 * That is what makes the account layer fit the rest of the application without
 * touching any route: the login method registered in
 * `lib/server/identity/host/session-cookie.ts` hands core this principal, and
 * every course, chat, upload and setting is then scoped to the account.
 *
 * Node-only: it reads the database and hashes session ids with `node:crypto`.
 * The Edge proxy verifies the same token through `./session-token.ts` and does
 * not import this module.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { Queryable } from '@openmaic/storage/document/pg';
import {
  createAuthSessionRow,
  deleteAuthSessionRow,
  findAuthSessionUser,
} from '@/lib/persistence/auth-accounts';
import type { AuthUser } from '@/lib/persistence/auth-accounts';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';
import { OWNER_ROLES, type OwnerPrincipal } from '@/lib/server/identity';
import type { AuthRole } from './config';
import {
  AUTH_COOKIE,
  AUTH_OAUTH_STATE_COOKIE,
  authEnabled,
  authSecret,
  authSessionMaxAgeSeconds,
} from './config';
import { signSessionToken, verifySessionToken } from './session-token';

/** The session id is 32 random bytes, base64url-encoded. */
const SESSION_ID_BYTES = 32;

function randomSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url');
}

/** What the database stores instead of the replayable session id. */
export function hashSessionId(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

/** The persistence pool, once its schemas are in place. */
async function authQueryable() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('AUTH_ENABLED needs DATABASE_URL: accounts and sessions are stored there.');
  }
  const { pool } = await getServerPersistenceProvider(connectionString);
  return pool;
}

/** The account tables' query surface; the provider has already ensured them. */
export async function authDatabase(): Promise<Queryable> {
  return (await authQueryable()) as unknown as Queryable;
}

/** The account id inside an owner id minted here, or null for another owner. */
export function authUserIdFromOwnerId(ownerId: string): string | null {
  if (!ownerId.startsWith('user:')) return null;
  const id = ownerId.slice('user:'.length);
  return id.length > 0 ? id : null;
}

/** Parse one cookie out of a `Cookie` header. */
export function readSessionCookieFromHeaders(headers: Headers): string | undefined {
  const raw = headers.get('cookie');
  if (!raw) return undefined;
  for (const item of raw.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== AUTH_COOKIE) continue;
    const value = item.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

/** A `Set-Cookie` value that persists a session for its full lifetime. */
export function sessionCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return (
    `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${maxAgeSeconds}${secure}`
  );
}

/** A `Set-Cookie` value that removes the session cookie. */
export function clearSessionCookieHeader(): string {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/**
 * The cookie that ties a Google callback to the browser that started it. It is
 * scoped to the sign-in routes and short-lived; `Lax` is required because the
 * browser arrives back from Google with a top-level GET navigation.
 */
export function oauthStateCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return (
    `${AUTH_OAUTH_STATE_COOKIE}=${token}; Path=/api/auth/google; HttpOnly; ` +
    `SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`
  );
}

export function clearOAuthStateCookieHeader(): string {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return `${AUTH_OAUTH_STATE_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** The roles an account carries into owner resolution. */
export function rolesForAuthRole(role: AuthRole): ReadonlySet<string> {
  switch (role) {
    case 'admin':
      return new Set([OWNER_ROLES.coursePublish, OWNER_ROLES.admin]);
    case 'teacher':
      return new Set([OWNER_ROLES.coursePublish]);
    default:
      return new Set<string>();
  }
}

/** The owner principal a signed-in account resolves to. */
export function principalForAuthUser(user: AuthUser): OwnerPrincipal {
  return {
    ownerId: `user:${user.id}`,
    kind: 'user',
    roles: rolesForAuthRole(user.role),
    assurance: 'verified',
    channel: 'session',
  };
}

/** The account a token names, if the session is live and the account is active. */
export async function sessionUserFromToken(token: string): Promise<AuthUser | null> {
  const secret = authSecret();
  if (!secret) return null;
  const payload = await verifySessionToken(token, secret);
  if (!payload) return null;
  const queryable = await authQueryable();
  const user = await findAuthSessionUser(queryable, hashSessionId(payload.sid));
  if (!user || user.id !== payload.sub) return null;
  return user;
}

/** The account a request's cookie names, if any. */
export async function sessionUserFromHeaders(headers: Headers): Promise<AuthUser | null> {
  if (!authEnabled()) return null;
  const token = readSessionCookieFromHeaders(headers);
  if (!token) return null;
  try {
    return await sessionUserFromToken(token);
  } catch (error) {
    console.error('[auth] the session cookie could not be resolved', error);
    return null;
  }
}

/** The account of the current page render or Server Action, if any. */
export async function currentSessionUser(): Promise<AuthUser | null> {
  if (!authEnabled()) return null;
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    return await sessionUserFromToken(token);
  } catch (error) {
    console.error('[auth] the session cookie could not be resolved', error);
    return null;
  }
}

export interface CreatedSession {
  /** The signed cookie value. */
  readonly token: string;
  /** Its lifetime in seconds, for the cookie's `Max-Age`. */
  readonly maxAge: number;
  /** The session id, whose hash identifies the row. */
  readonly sessionIdHash: string;
}

/** Mint a session for an account: a fresh id, a signed cookie and a database row. */
export async function createSessionForUser(
  user: AuthUser,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<CreatedSession> {
  const secret = authSecret();
  if (!secret) {
    throw new Error('AUTH_ENABLED needs a session secret: set AUTH_SECRET or OPENMAIC_SECRET_KEY.');
  }
  const maxAge = authSessionMaxAgeSeconds();
  const sid = randomSessionId();
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  const token = await signSessionToken(
    { sid, sub: user.id, exp: Math.floor(expiresAt.getTime() / 1000) },
    secret,
  );
  const sessionIdHash = hashSessionId(sid);
  const queryable = await authQueryable();
  await createAuthSessionRow(queryable, {
    idHash: sessionIdHash,
    userId: user.id,
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  return { token, maxAge, sessionIdHash };
}

/** Drop the session a request names, if any. */
export async function destroySessionFromHeaders(headers: Headers): Promise<void> {
  const token = readSessionCookieFromHeaders(headers);
  const secret = authSecret();
  if (!token || !secret) return;
  const payload = await verifySessionToken(token, secret);
  if (!payload) return;
  try {
    await deleteAuthSessionRow(await authQueryable(), hashSessionId(payload.sid));
  } catch (error) {
    console.error('[auth] the session row could not be deleted', error);
  }
}
