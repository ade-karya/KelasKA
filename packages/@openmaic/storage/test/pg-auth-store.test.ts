/**
 * PGlite contract for the PostgreSQL username+password auth backend.
 *
 * Mirrors the user-skill backend's PGlite harness: the real pinned DDL
 * against a real (in-process) database, so the UNIQUE / FOREIGN KEY /
 * ON DELETE CASCADE behavior is exercised rather than faked. Needs no
 * external Postgres: PGlite runs embedded, like every other `*.test.ts`
 * in this directory (only `*.pg.test.ts` needs a live server).
 */
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  AUTH_PG_SCHEMA,
  AuthError,
  createUser,
  createUserSession,
  deleteUserSession,
  deleteUserSessions,
  ensureAuthSchema,
  findUserByUsername,
  findUserSession,
  type Queryable,
} from '../src/auth/pg.js';

let db: PGlite;
let queryable: Queryable;

// PGlite boots an embedded Postgres per test; on a slow machine that can
// exceed vitest's default 10s hook budget, so raise it explicitly.
beforeEach(async () => {
  db = new PGlite();
  await db.waitReady;
  await ensureAuthSchema(db);
  queryable = db as Queryable;
}, 60_000);

afterEach(async () => {
  await db.close();
}, 30_000);

describe('ensureAuthSchema', () => {
  test('provisions the users and user_sessions tables idempotently', async () => {
    await expect(ensureAuthSchema(queryable)).resolves.toBeUndefined();
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [['users', 'user_sessions']],
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      'user_sessions',
      'users',
    ]);
  });

  test('pins the exact columns the login layer depends on', async () => {
    expect(AUTH_PG_SCHEMA).toContain('username TEXT UNIQUE NOT NULL');
    expect(AUTH_PG_SCHEMA).toContain('password_hash TEXT NOT NULL');
    expect(AUTH_PG_SCHEMA).toContain('token_hash TEXT PRIMARY KEY');
    expect(AUTH_PG_SCHEMA).toContain('REFERENCES users(id) ON DELETE CASCADE');
    expect(AUTH_PG_SCHEMA).toContain('expires_at TIMESTAMPTZ NOT NULL');
  });
});

describe('users', () => {
  test('createUser round-trips and normalizes the username', async () => {
    const created = await createUser(queryable, '  Alice  ', 'hash-1');
    expect(created.id).toBeTruthy();
    expect(created.username).toBe('alice');
    expect(created.passwordHash).toBe('hash-1');
    expect(created.createdAt).toBeInstanceOf(Date);

    await expect(findUserByUsername(queryable, 'ALICE')).resolves.toEqual(created);
    await expect(findUserByUsername(queryable, '  alice  ')).resolves.toEqual(created);
  });

  test('duplicate usernames throw code USER_EXISTS, case-insensitively', async () => {
    await createUser(queryable, 'alice', 'hash-1');
    for (const dup of ['alice', 'ALICE', '  alice  ']) {
      const caught = await createUser(queryable, dup, 'hash-2').then(
        () => null,
        (error: unknown) => error,
      );
      expect(caught).toBeInstanceOf(AuthError);
      expect((caught as AuthError).code).toBe('USER_EXISTS');
    }
  });

  test('findUserByUsername returns null when absent', async () => {
    await expect(findUserByUsername(queryable, 'nobody')).resolves.toBeNull();
  });
});

describe('user_sessions', () => {
  test('create and find round-trip a live session', async () => {
    const user = await createUser(queryable, 'alice', 'hash-1');
    const expiresAt = new Date(Date.now() + 3_600_000);
    const created = await createUserSession(queryable, 'tok-1', user.id, expiresAt);
    expect(created.tokenHash).toBe('tok-1');
    expect(created.userId).toBe(user.id);

    await expect(findUserSession(queryable, 'tok-1')).resolves.toEqual(created);
  });

  test('find returns null for an unknown token', async () => {
    await expect(findUserSession(queryable, 'missing')).resolves.toBeNull();
  });

  test('expired sessions read as null and are deleted opportunistically', async () => {
    const user = await createUser(queryable, 'alice', 'hash-1');
    await createUserSession(queryable, 'tok-expired', user.id, new Date(Date.now() - 1_000));

    await expect(findUserSession(queryable, 'tok-expired')).resolves.toBeNull();
    const rows = await db.query<{ token_hash: string }>(
      'SELECT token_hash FROM user_sessions WHERE token_hash = $1',
      ['tok-expired'],
    );
    expect(rows.rows).toHaveLength(0);
  });

  test('deleteUserSession removes one token and keeps the rest', async () => {
    const user = await createUser(queryable, 'alice', 'hash-1');
    const expiresAt = new Date(Date.now() + 3_600_000);
    await createUserSession(queryable, 'tok-1', user.id, expiresAt);
    await createUserSession(queryable, 'tok-2', user.id, expiresAt);

    await expect(deleteUserSession(queryable, 'tok-1')).resolves.toBeUndefined();
    await expect(findUserSession(queryable, 'tok-1')).resolves.toBeNull();
    await expect(findUserSession(queryable, 'tok-2')).resolves.not.toBeNull();
  });

  test('deleteUserSessions clears one user and keeps the other', async () => {
    const alice = await createUser(queryable, 'alice', 'hash-1');
    const bob = await createUser(queryable, 'bob', 'hash-2');
    const expiresAt = new Date(Date.now() + 3_600_000);
    await createUserSession(queryable, 'tok-a1', alice.id, expiresAt);
    await createUserSession(queryable, 'tok-a2', alice.id, expiresAt);
    await createUserSession(queryable, 'tok-b1', bob.id, expiresAt);

    await expect(deleteUserSessions(queryable, alice.id)).resolves.toBeUndefined();
    await expect(findUserSession(queryable, 'tok-a1')).resolves.toBeNull();
    await expect(findUserSession(queryable, 'tok-a2')).resolves.toBeNull();
    await expect(findUserSession(queryable, 'tok-b1')).resolves.not.toBeNull();
  });

  test('deleting a user cascades to its sessions', async () => {
    const user = await createUser(queryable, 'alice', 'hash-1');
    await createUserSession(queryable, 'tok-1', user.id, new Date(Date.now() + 3_600_000));

    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    await expect(findUserSession(queryable, 'tok-1')).resolves.toBeNull();
  });
});
