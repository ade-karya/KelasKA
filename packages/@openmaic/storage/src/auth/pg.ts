/**
 * PostgreSQL backend for username+password login.
 *
 * The backend imports no database driver. A host supplies a direct queryable,
 * exactly like the runtime / skill / material backends. Passwords and session
 * tokens are never hashed here: the host hashes with node:crypto (or another
 * KDF) and this module only stores the resulting `password_hash` /
 * `token_hash` strings it receives as parameters.
 *
 * The DDL is pinned: a deployment that provisions these tables with its own
 * migration tooling must reproduce it exactly for `ensureAuthSchema` to stay
 * the intended no-op.
 */
import { randomUUID } from 'node:crypto';

import type { Queryable } from '../runtime/pg.js';

export type { QueryResult, Queryable } from '../runtime/pg.js';

export type AuthErrorCode = 'USER_EXISTS';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: AuthErrorCode,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
}

export interface AuthUserSession {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Pinned default schema for the PostgreSQL auth backend. */
export const AUTH_PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
  ON user_sessions (user_id);
`;

/**
 * Create the backend-owned tables when absent. Safe to call repeatedly (for
 * example at host startup, before serving traffic); changing an existing
 * table requires a real migration.
 */
export async function ensureAuthSchema(queryable: Queryable): Promise<void> {
  // Keep Queryable minimal: PGlite's query() intentionally accepts one
  // statement at a time, while node-postgres also accepts each statement.
  // This split is deliberately simple and would break on semicolons inside SQL
  // string literals; replace it with a migration runner before adding such SQL.
  for (const sql of AUTH_PG_SCHEMA.split(';')) {
    const statement = sql.trim();
    if (statement !== '') await queryable.query(statement);
  }
}

/** Usernames are case-insensitive: every entry point trims and lowercases. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function assertNonEmpty(value: string, label: string): void {
  if (value === '') {
    throw new Error(`@openmaic/storage: ${label} must not be empty`);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

interface UserRow extends Record<string, unknown> {
  id: string;
  username: string;
  password_hash: string;
  created_at: Date | string;
}

interface UserSessionRow extends Record<string, unknown> {
  token_hash: string;
  user_id: string;
  expires_at: Date | string;
  created_at: Date | string;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

function mapUserSession(row: UserSessionRow): AuthUserSession {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

const USER_COLUMNS = 'id, username, password_hash, created_at';
const USER_SESSION_COLUMNS = 'token_hash, user_id, expires_at, created_at';

/**
 * Insert a user. The id is minted here (`randomUUID`); the password hash is
 * supplied by the caller. Throws an `AuthError` with code `'USER_EXISTS'`
 * when the normalized username is already taken.
 */
export async function createUser(
  queryable: Queryable,
  username: string,
  passwordHash: string,
): Promise<AuthUser> {
  const normalized = normalizeUsername(username);
  assertNonEmpty(normalized, 'username');
  assertNonEmpty(passwordHash, 'passwordHash');
  try {
    const result = await queryable.query<UserRow>(
      `INSERT INTO users (${USER_COLUMNS})
        VALUES ($1, $2, $3, now())
        RETURNING ${USER_COLUMNS}`,
      [randomUUID(), normalized, passwordHash],
    );
    return mapUser(result.rows[0]!);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthError(
        `@openmaic/storage: username ${JSON.stringify(normalized)} already exists`,
        'USER_EXISTS',
      );
    }
    throw error;
  }
}

/** Find a user by username (normalized before lookup); null when absent. */
export async function findUserByUsername(
  queryable: Queryable,
  username: string,
): Promise<AuthUser | null> {
  const normalized = normalizeUsername(username);
  if (normalized === '') return null;
  const result = await queryable.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 LIMIT 1`,
    [normalized],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

/**
 * Insert a session row. `tokenHash` is the caller-hashed session token and
 * `expiresAt` its absolute expiry; both are stored verbatim.
 */
export async function createUserSession(
  queryable: Queryable,
  tokenHash: string,
  userId: string,
  expiresAt: Date | string,
): Promise<AuthUserSession> {
  assertNonEmpty(tokenHash, 'tokenHash');
  assertNonEmpty(userId, 'userId');
  const result = await queryable.query<UserSessionRow>(
    `INSERT INTO user_sessions (${USER_SESSION_COLUMNS})
      VALUES ($1, $2, $3, now())
      RETURNING ${USER_SESSION_COLUMNS}`,
    [tokenHash, userId, expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt],
  );
  return mapUserSession(result.rows[0]!);
}

/**
 * Find a live session by its token hash. Returns null when the row is absent
 * or expired; an expired row is deleted opportunistically (best-effort: a
 * cleanup failure never turns an expired session into an error).
 */
export async function findUserSession(
  queryable: Queryable,
  tokenHash: string,
): Promise<AuthUserSession | null> {
  if (tokenHash === '') return null;
  const result = await queryable.query<UserSessionRow>(
    `SELECT ${USER_SESSION_COLUMNS} FROM user_sessions WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  const session = mapUserSession(row);
  if (session.expiresAt.getTime() <= Date.now()) {
    await queryable.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]).catch(() => {});
    return null;
  }
  return session;
}

/** Delete one session by its token hash; a no-op when absent. */
export async function deleteUserSession(queryable: Queryable, tokenHash: string): Promise<void> {
  if (tokenHash === '') return;
  await queryable.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
}

/** Delete every session of a user (for example a "log out everywhere" route). */
export async function deleteUserSessions(queryable: Queryable, userId: string): Promise<void> {
  if (userId === '') return;
  await queryable.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
}
