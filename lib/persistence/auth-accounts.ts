/**
 * Accounts and their sessions: the persistence behind the login layer.
 *
 * One row per account in `auth_users` (a student, a teacher or an admin) and
 * one row per live session in `auth_sessions`. The account id is also the
 * owner id every course, chat and upload is scoped to (`user:<id>`, see
 * `lib/server/auth/session.ts`), so signing out never moves anybody's work.
 *
 * Sessions are stored by the SHA-256 of the random id the cookie names, not
 * the id itself: a database dump of `auth_sessions` is then not a set of
 * replayable cookies. The signed cookie's signature only proves this
 * deployment minted the token; the row is what makes it revocable, and an
 * account deactivated by an admin stops resolving on its next request.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

import type { AuthRole } from '@/lib/server/auth/config';

export const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auth_users_role_idx ON auth_users (role);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
`;

export const AUTH_MIGRATIONS: SchemaMigrationSet = {
  store: 'auth-accounts',
  migrations: [
    { version: 1, name: 'baseline', up: AUTH_SCHEMA, transaction: false },
    {
      version: 2,
      name: 'google-sign-in',
      // Sign-in is Google-only, so an account no longer carries a password.
      // Existing rows may keep theirs (it is never read again); dropping the
      // NOT NULL lets a new account be created pending, before its first
      // Google callback binds `google_sub`.
      up: `
ALTER TABLE auth_users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_google_sub_idx
  ON auth_users (google_sub)
  WHERE google_sub IS NOT NULL;
`,
      transaction: false,
    },
    {
      version: 3,
      name: 'api-key-exempt',
      // The bring-your-own-key gate (see lib/server/auth/api-key-gate.ts): an
      // account the admin exempts never has to verify a chat provider's key.
      up: `
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS api_key_exempt BOOLEAN NOT NULL DEFAULT false;
`,
      transaction: false,
    },
  ],
};

export async function ensureAuthSchema(queryable: Queryable): Promise<void> {
  await applySchemaMigrations(queryable, AUTH_MIGRATIONS);
}

/** An account as the rest of the application may see it: never the hash. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AuthRole;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastLoginAt: string | null;
  /** Exempt from the bring-your-own-key gate (admin-managed). */
  readonly apiKeyExempt: boolean;
}

/** An account plus the Google subject bound to it, for the sign-in callback. */
export interface AuthUserWithGoogle extends AuthUser {
  readonly googleSub: string | null;
}

interface AuthUserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
  api_key_exempt?: boolean;
}

interface AuthUserWithGoogleRow extends AuthUserRow {
  google_sub: string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AuthRole,
    active: row.active,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
    lastLoginAt: iso(row.last_login_at),
    apiKeyExempt: row.api_key_exempt ?? false,
  };
}

/** The e-mail address is already taken (the `UNIQUE` constraint on `auth_users.email`). */
export class AuthEmailTakenError extends Error {
  constructor(readonly email: string) {
    super(`an account with the e-mail ${email} already exists`);
    this.name = 'AuthEmailTakenError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

/** Normalized form used for storage and lookups. */
export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateAuthUserInput {
  readonly email: string;
  readonly name: string;
  readonly role: AuthRole;
  /** Approved accounts can sign in; a Google-first account starts pending. */
  readonly active?: boolean;
  /** The Google subject, when the account is created by a sign-in. */
  readonly googleSub?: string;
}

/** Insert an account. Throws {@link AuthEmailTakenError} on a duplicate e-mail. */
export async function createAuthUser(
  queryable: Queryable,
  input: CreateAuthUserInput,
): Promise<AuthUser> {
  const id = crypto.randomUUID();
  try {
    const result = await queryable.query<AuthUserRow & Record<string, unknown>>(
      `INSERT INTO auth_users (id, email, name, role, active, google_sub)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, role, active, created_at, updated_at, last_login_at, api_key_exempt`,
      [
        id,
        normalizeAuthEmail(input.email),
        input.name.trim(),
        input.role,
        input.active ?? false,
        input.googleSub ?? null,
      ],
    );
    return mapUser(result.rows[0]!);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AuthEmailTakenError(normalizeAuthEmail(input.email));
    throw error;
  }
}

/** Look an account up by e-mail, with its Google binding (sign-in only). */
export async function findAuthUserByEmail(
  queryable: Queryable,
  email: string,
): Promise<AuthUserWithGoogle | null> {
  const result = await queryable.query<AuthUserWithGoogleRow & Record<string, unknown>>(
    `SELECT id, email, name, role, active, google_sub, created_at, updated_at, last_login_at, api_key_exempt
       FROM auth_users
      WHERE email = $1`,
    [normalizeAuthEmail(email)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...mapUser(row), googleSub: row.google_sub };
}

/** Look an account up by its Google subject. */
export async function findAuthUserByGoogleSub(
  queryable: Queryable,
  googleSub: string,
): Promise<AuthUser | null> {
  const result = await queryable.query<AuthUserRow & Record<string, unknown>>(
    `SELECT id, email, name, role, active, created_at, updated_at, last_login_at, api_key_exempt
       FROM auth_users
      WHERE google_sub = $1`,
    [googleSub],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

/** Bind a Google subject to an account the admin approved by e-mail first. */
export async function bindAuthUserGoogleSub(
  queryable: Queryable,
  id: string,
  googleSub: string,
): Promise<void> {
  await queryable.query(`UPDATE auth_users SET google_sub = $2, updated_at = now() WHERE id = $1`, [
    id,
    googleSub,
  ]);
}

/** Look an account up by id. */
export async function findAuthUserById(queryable: Queryable, id: string): Promise<AuthUser | null> {
  const result = await queryable.query<AuthUserRow & Record<string, unknown>>(
    `SELECT id, email, name, role, active, created_at, updated_at, last_login_at, api_key_exempt
       FROM auth_users
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

/** Every account, newest first. */
export async function listAuthUsers(queryable: Queryable): Promise<AuthUser[]> {
  const result = await queryable.query<AuthUserRow & Record<string, unknown>>(
    `SELECT id, email, name, role, active, created_at, updated_at, last_login_at, api_key_exempt
       FROM auth_users
      ORDER BY created_at ASC`,
  );
  return result.rows.map(mapUser);
}

export interface UpdateAuthUserInput {
  readonly name?: string;
  readonly role?: AuthRole;
  readonly active?: boolean;
  /** Exempt from (or reinstated into) the bring-your-own-key gate. */
  readonly apiKeyExempt?: boolean;
}

/** Change an account; returns the updated row, or null when the id is unknown. */
export async function updateAuthUser(
  queryable: Queryable,
  id: string,
  patch: UpdateAuthUserInput,
): Promise<AuthUser | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) add('name', patch.name.trim());
  if (patch.role !== undefined) add('role', patch.role);
  if (patch.active !== undefined) add('active', patch.active);
  if (patch.apiKeyExempt !== undefined) add('api_key_exempt', patch.apiKeyExempt);
  if (assignments.length === 0) return findAuthUserById(queryable, id);
  assignments.push('updated_at = now()');
  values.push(id);
  const result = await queryable.query<AuthUserRow & Record<string, unknown>>(
    `UPDATE auth_users
        SET ${assignments.join(', ')}
      WHERE id = $${values.length}
      RETURNING id, email, name, role, active, created_at, updated_at, last_login_at, api_key_exempt`,
    values,
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

/** Remove an account (its sessions cascade). */
export async function deleteAuthUser(queryable: Queryable, id: string): Promise<boolean> {
  const result = await queryable.query(`DELETE FROM auth_users WHERE id = $1`, [id]);
  return (result as unknown as { rowCount?: number | null }).rowCount === 1;
}

/** How many active admins exist; the last one may not be demoted or removed. */
export async function countActiveAdmins(queryable: Queryable): Promise<number> {
  const result = await queryable.query<{ n: number | string } & Record<string, unknown>>(
    `SELECT COUNT(*)::int AS n FROM auth_users WHERE role = 'admin' AND active`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** Sort accounts the way the admin console shows them: admins, teachers, students. */
export function sortAuthUsers(users: readonly AuthUser[]): AuthUser[] {
  const rank: Record<AuthRole, number> = { admin: 0, teacher: 1, student: 2 };
  return [...users].sort(
    (a, b) =>
      rank[a.role] - rank[b.role] || a.name.localeCompare(b.name) || a.email.localeCompare(b.email),
  );
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateAuthSessionInput {
  /** SHA-256 of the session id the cookie carries. */
  readonly idHash: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

export async function createAuthSessionRow(
  queryable: Queryable,
  input: CreateAuthSessionInput,
): Promise<void> {
  await queryable.query(
    `INSERT INTO auth_sessions (id_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.idHash,
      input.userId,
      input.expiresAt.toISOString(),
      input.userAgent ?? null,
      input.ip ?? null,
    ],
  );
}

/**
 * The account a live session belongs to: the row exists, has not expired and
 * the account is still active. Any failure returns null.
 */
export async function findAuthSessionUser(
  queryable: Queryable,
  idHash: string,
): Promise<AuthUser | null> {
  const result = await queryable.query<AuthUserRow & Record<string, unknown>>(
    `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at, u.updated_at, u.last_login_at, u.api_key_exempt
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
      WHERE s.id_hash = $1
        AND s.expires_at > now()
        AND u.active`,
    [idHash],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function deleteAuthSessionRow(queryable: Queryable, idHash: string): Promise<void> {
  await queryable.query(`DELETE FROM auth_sessions WHERE id_hash = $1`, [idHash]);
}

/** Drop every session of one account, optionally keeping the current one. */
export async function deleteAuthUserSessions(
  queryable: Queryable,
  userId: string,
  exceptIdHash?: string,
): Promise<void> {
  await queryable.query(
    `DELETE FROM auth_sessions
      WHERE user_id = $1
        AND ($2::text IS NULL OR id_hash <> $2)`,
    [userId, exceptIdHash ?? null],
  );
}

/** Best-effort housekeeping; safe to run repeatedly. */
export async function pruneExpiredAuthSessions(queryable: Queryable): Promise<void> {
  await queryable.query(`DELETE FROM auth_sessions WHERE expires_at <= now()`);
}

/** Record a successful sign-in, for the admin console's "last login" column. */
export async function markAuthUserSignedIn(queryable: Queryable, userId: string): Promise<void> {
  await queryable.query(`UPDATE auth_users SET last_login_at = now() WHERE id = $1`, [userId]);
}
