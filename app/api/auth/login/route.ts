import type { NextRequest, NextResponse } from 'next/server';

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { MAX_PASSWORD_LENGTH, verifyPassword } from '@/lib/server/auth/password';
import { createLoginSession } from '@/lib/server/auth/session';
import { findUserByUsername } from '@/lib/server/auth/user-store';
import { SlidingWindowFailureLimiter } from '@/lib/server/attempt-limiter';
import { clientIdentity } from '@/lib/server/client-identity';

export const runtime = 'nodejs';

/**
 * Simple per-identity throttle for password guessing. 20 attempts / 60s per
 * client identity (collapses to a shared `direct` bucket without
 * TRUST_PROXY_HEADERS, same tradeoff as the access-code limiter).
 */
const loginAttemptLimiter = new SlidingWindowFailureLimiter({
  maxFailures: 20,
  windowMs: 60_000,
});

const GENERIC_FAILURE = 'Invalid username or password';

// Bounds for credential fields before any DB/KDF work (anti-DoS).
const MAX_USERNAME_LENGTH = 64;

// Well-formed but never-matching scrypt envelope. Verified against when the
// username does not exist so a miss costs the same scrypt work as a password
// mismatch (anti user-enumeration via timing).
const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;

// Auth responses carry identity state and must never be cached.
function withNoCache(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Pragma', 'no-cache');
  return res;
}

export async function POST(req: NextRequest) {
  const identity = clientIdentity(req);
  const limit = loginAttemptLimiter.consume(identity);
  if (limit.limited) {
    const response = withNoCache(apiError('RATE_LIMITED', 429, 'Too many login attempts'));
    response.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return response;
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withNoCache(apiError('INVALID_REQUEST', 400, 'Invalid JSON body'));
  }

  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) {
    return withNoCache(apiError('INVALID_REQUEST', 400, 'username and password are required'));
  }
  if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return withNoCache(apiError('INVALID_REQUEST', 400, 'username and password are required'));
  }

  let user: { id: string; username: string; password_hash: string } | null;
  try {
    user = await findUserByUsername(username);
  } catch {
    return withNoCache(apiError('INTERNAL_ERROR', 500, 'Login failed'));
  }

  // Generic 401 either way: must not reveal whether the username exists.
  // When there is no such user, still run scrypt against the dummy hash so
  // the response time matches a wrong-password attempt.
  const passwordValid = user
    ? verifyPassword(password, user.password_hash)
    : (verifyPassword(password, DUMMY_PASSWORD_HASH), false);
  if (!user || !passwordValid) {
    return withNoCache(apiError('INVALID_CREDENTIALS', 401, GENERIC_FAILURE));
  }

  let cookieHeader: string;
  try {
    const session = await createLoginSession(user.id);
    cookieHeader = session.cookieHeader;
  } catch {
    return withNoCache(apiError('INTERNAL_ERROR', 500, 'Failed to create session'));
  }

  loginAttemptLimiter.recordSuccess(identity);
  const response = withNoCache(
    apiSuccess({ username: user.username, ownerId: `user:${user.id}` }),
  );
  response.headers.append('Set-Cookie', cookieHeader);
  return response;
}
