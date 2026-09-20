import type { NextRequest, NextResponse } from 'next/server';

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { MAX_PASSWORD_LENGTH, hashPassword } from '@/lib/server/auth/password';
import { createLoginSession } from '@/lib/server/auth/session';
import {
  createUser,
  findUserByUsername,
  isUserExistsError,
} from '@/lib/server/auth/user-store';

export const runtime = 'nodejs';

const USERNAME_PATTERN = /^[A-Za-z0-9]{3,32}$/;

function isRegistrationAllowed(): boolean {
  const raw = process.env.ALLOW_REGISTRATION;
  if (raw === undefined || raw === '') return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return true;
}

interface RegisterBody {
  username?: unknown;
  password?: unknown;
}

// Auth responses carry identity state and must never be cached.
function withNoCache(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Pragma', 'no-cache');
  return res;
}

export async function POST(req: NextRequest) {
  if (!isRegistrationAllowed()) {
    return withNoCache(apiError('INVALID_REQUEST', 403, 'Registration is disabled'));
  }

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return withNoCache(apiError('INVALID_REQUEST', 400, 'Invalid JSON body'));
  }

  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!USERNAME_PATTERN.test(username)) {
    return withNoCache(
      apiError('INVALID_REQUEST', 400, 'Username must be 3-32 alphanumeric characters'),
    );
  }
  if (typeof password !== 'string' || password.length < 8) {
    return withNoCache(apiError('INVALID_REQUEST', 400, 'Password must be at least 8 characters'));
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return withNoCache(
      apiError(
        'INVALID_REQUEST',
        400,
        `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
      ),
    );
  }

  let existing: { id: string } | null = null;
  try {
    existing = await findUserByUsername(username);
  } catch {
    return withNoCache(apiError('INTERNAL_ERROR', 500, 'Failed to check username'));
  }
  if (existing) {
    return withNoCache(apiError('INVALID_REQUEST', 409, 'Username already exists'));
  }

  let passwordHash: string;
  try {
    passwordHash = hashPassword(password);
  } catch {
    return withNoCache(apiError('INTERNAL_ERROR', 500, 'Failed to hash password'));
  }

  let userId: string;
  let storedUsername = username;
  try {
    const created = await createUser(username, passwordHash);
    userId = created.id;
    storedUsername = created.username;
  } catch (error) {
    // A concurrent insert racing us surfaces here; re-check to answer 409.
    if (isUserExistsError(error)) {
      return withNoCache(apiError('INVALID_REQUEST', 409, 'Username already exists'));
    }
    try {
      const raced = await findUserByUsername(username);
      if (raced) return withNoCache(apiError('INVALID_REQUEST', 409, 'Username already exists'));
    } catch {
      // Fall through to the generic failure below.
    }
    return withNoCache(apiError('INTERNAL_ERROR', 500, 'Failed to create user'));
  }

  let cookieHeader: string;
  try {
    const session = await createLoginSession(userId);
    cookieHeader = session.cookieHeader;
  } catch {
    return withNoCache(apiError('INTERNAL_ERROR', 500, 'Failed to create session'));
  }

  const response = withNoCache(
    apiSuccess({ username: storedUsername, ownerId: `user:${userId}` }, 201),
  );
  response.headers.append('Set-Cookie', cookieHeader);
  // Surface the owner cookie contract used by agent routes: the anonymous
  // cookie is NOT minted for authenticated principals.
  return response;
}
