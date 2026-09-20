import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque username+password session tokens.
 *
 * - Cookie: `openmaic_session` (HTTP-only, SameSite=Lax, 30 days).
 * - Stored value is SHA-256(token), never the raw token.
 * - Identity surfaced to owner partitioning is `user:<id>`.
 *
 * Storage is reached through `./user-store`, which bridges the task-spec
 * host API to the landed pg backend. Both that module and this one import
 * `@openmaic/storage` dynamically so Edge bundles and routes that never
 * touch auth do not pull in the pg-backed implementation.
 */

export const SESSION_COOKIE = 'openmaic_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

/**
 * Upper bound for an opaque session token presented via Cookie.
 * Real tokens are 64 hex chars (32 random bytes); the cap only rejects
 * absurd input before it reaches hashing/storage (anti-DoS).
 */
export const MAX_SESSION_TOKEN_LENGTH = 256;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function readCookie(headers: Headers, name: string): string | undefined {
  const encoded = headers.get('cookie');
  if (!encoded) return undefined;
  for (const item of encoded.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function getSessionTokenFromHeaders(req: Pick<Request, 'headers'>): string | null {
  const token = readCookie(req.headers, SESSION_COOKIE);
  if (!token || token.length === 0 || token.length > MAX_SESSION_TOKEN_LENGTH) return null;
  return token;
}

function sessionCookieSecure(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0';
}

function buildSessionCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = sessionCookieSecure() ? '; Secure' : '';
  return (
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${maxAgeSeconds}${secure}`
  );
}

export function buildClearSessionCookieHeader(): string {
  const secure = sessionCookieSecure() ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function createLoginSession(userId: string): Promise<{
  token: string;
  tokenHash: string;
  expiresAt: Date;
  cookieHeader: string;
}> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { createUserSession } = await import('./user-store');
  await createUserSession(tokenHash, userId, expiresAt);
  return {
    token,
    tokenHash,
    expiresAt,
    cookieHeader: buildSessionCookieHeader(token, SESSION_TTL_SECONDS),
  };
}

/**
 * Resolve the authenticated owner (`user:<id>`) from the session cookie,
 * or null when absent/unknown/expired. Never throws: storage failures and
 * malformed cookies resolve to anonymous (fail-closed to the anon partition).
 */
export async function getAuthenticatedOwnerId(
  req: Pick<Request, 'headers'>,
): Promise<string | null> {
  try {
    const token = getSessionTokenFromHeaders(req);
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const { findUserSession } = await import('./user-store');
    const row = await findUserSession(tokenHash);
    if (!row || !row.user_id) return null;
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;
    return `user:${row.user_id}`;
  } catch {
    return null;
  }
}

/**
 * Delete the session row (best-effort) and return a clearing Set-Cookie value.
 */
export async function destroySession(req: Pick<Request, 'headers'>): Promise<string> {
  try {
    const token = getSessionTokenFromHeaders(req);
    if (token) {
      const { deleteUserSession } = await import('./user-store');
      await deleteUserSession(hashSessionToken(token));
    }
  } catch {
    // Best-effort: the cookie is cleared regardless.
  }
  return buildClearSessionCookieHeader();
}
