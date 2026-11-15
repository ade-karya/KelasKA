import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Queryable } from '@openmaic/storage/document/pg';

import { resolveGoogleAccount } from '@/lib/server/auth/google-signin';

interface Row {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  google_sub: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

function row(overrides: Partial<Row> & { id: string; email: string }): Row {
  return {
    name: overrides.email.split('@')[0]!,
    role: 'student',
    active: false,
    google_sub: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    last_login_at: null,
    ...overrides,
  };
}

/**
 * The few statements `resolveGoogleAccount` issues, answered from an in-memory
 * table. It is deliberately a small dispatcher rather than a SQL engine: the
 * point of the test is the approval decision, not the query planner.
 */
function fakeDatabase(initial: Row[]) {
  const rows = initial.map((entry) => ({ ...entry }));
  const writes: string[] = [];

  const queryable = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('WHERE google_sub = $1')) {
        const found = rows.find((entry) => entry.google_sub === params[0]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('WHERE email = $1')) {
        const found = rows.find((entry) => entry.email === params[0]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('INSERT INTO auth_users')) {
        writes.push('insert');
        const created: Row = row({
          id: `new-${rows.length + 1}`,
          email: String(params[1]),
          name: String(params[2]),
          role: String(params[3]),
          active: Boolean(params[4]),
          google_sub: (params[5] as string | null) ?? null,
        });
        if (rows.some((entry) => entry.email === created.email)) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        rows.push(created);
        return { rows: [created] };
      }
      if (sql.includes('SET google_sub = $2')) {
        writes.push('bind');
        const found = rows.find((entry) => entry.id === params[0]);
        if (!found) return { rows: [] };
        found.google_sub = String(params[1]);
        return { rows: [] };
      }
      if (sql.includes('UPDATE auth_users')) {
        writes.push('update');
        const found = rows.find((entry) => entry.id === params[params.length - 1]);
        if (!found) return { rows: [] };
        for (const [index, param] of params.slice(0, -1).entries()) {
          if (sql.includes(`name = $${index + 1}`)) found.name = String(param);
          if (sql.includes(`role = $${index + 1}`)) found.role = String(param);
          if (sql.includes(`active = $${index + 1}`)) found.active = Boolean(param);
        }
        return { rows: [{ ...found }] };
      }
      throw new Error(`unexpected statement in the fake database: ${sql}`);
    },
  } as unknown as Queryable;

  return { queryable, rows, writes };
}

describe('resolveGoogleAccount', () => {
  const originalAdmins = process.env.AUTH_ADMIN_EMAILS;

  beforeEach(() => {
    delete process.env.AUTH_ADMIN_EMAILS;
    delete process.env.AUTH_ADMIN_EMAIL;
  });

  afterEach(() => {
    if (originalAdmins === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = originalAdmins;
  });

  it('creates a new Google address as pending, so an admin can approve it', async () => {
    const db = fakeDatabase([]);

    const user = await resolveGoogleAccount(db.queryable, {
      subject: 'google-1',
      email: 'siswa@sekolah.id',
      name: 'Siswa Baru',
    });

    expect(user).toBeNull();
    expect(db.writes).toEqual(['insert']);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      email: 'siswa@sekolah.id',
      role: 'student',
      active: false,
      google_sub: 'google-1',
    });
  });

  it('creates a configured admin address as an active admin on first sign-in', async () => {
    process.env.AUTH_ADMIN_EMAILS = 'Guru@Sekolah.id, lain@sekolah.id';
    const db = fakeDatabase([]);

    const user = await resolveGoogleAccount(db.queryable, {
      subject: 'google-admin',
      email: 'guru@sekolah.id',
      name: 'Guru Admin',
    });

    expect(user).not.toBeNull();
    expect(user).toMatchObject({ role: 'admin', active: true });
    expect(db.rows[0]).toMatchObject({ role: 'admin', active: true, google_sub: 'google-admin' });
  });

  it('promotes a listed address that was created pending before it was listed', async () => {
    process.env.AUTH_ADMIN_EMAILS = 'kepala@sekolah.id';
    const db = fakeDatabase([
      row({ id: 'u1', email: 'kepala@sekolah.id', role: 'student', active: false }),
    ]);

    const user = await resolveGoogleAccount(db.queryable, {
      subject: 'google-2',
      email: 'kepala@sekolah.id',
      name: 'Kepala Sekolah',
    });

    expect(user).toMatchObject({ id: 'u1', role: 'admin', active: true });
    expect(db.writes).toContain('update');
    expect(db.rows[0]).toMatchObject({ google_sub: 'google-2', role: 'admin', active: true });
  });

  it('returns an approved account whose Google subject is already bound', async () => {
    const db = fakeDatabase([
      row({ id: 'u1', email: 'guru@sekolah.id', role: 'teacher', active: true, google_sub: 'g-1' }),
    ]);

    const user = await resolveGoogleAccount(db.queryable, {
      subject: 'g-1',
      email: 'guru@sekolah.id',
      name: 'Guru',
    });

    expect(user).toMatchObject({ id: 'u1', role: 'teacher' });
    expect(db.writes).toEqual([]);
  });

  it('binds the Google subject to an account an admin approved by e-mail', async () => {
    const db = fakeDatabase([
      row({ id: 'u1', email: 'guru@sekolah.id', role: 'teacher', active: true }),
    ]);

    const user = await resolveGoogleAccount(db.queryable, {
      subject: 'g-9',
      email: 'guru@sekolah.id',
      name: 'Guru',
    });

    expect(user).toMatchObject({ id: 'u1', role: 'teacher' });
    expect(db.writes).toEqual(['bind']);
    expect(db.rows[0]?.google_sub).toBe('g-9');
  });

  it('keeps a pending account pending, binding its subject for the approval', async () => {
    const db = fakeDatabase([row({ id: 'u1', email: 'siswa@sekolah.id', active: false })]);

    const user = await resolveGoogleAccount(db.queryable, {
      subject: 'g-3',
      email: 'siswa@sekolah.id',
      name: 'Siswa',
    });

    expect(user).toBeNull();
    expect(db.writes).toEqual(['bind']);
    expect(db.rows[0]?.google_sub).toBe('g-3');
  });

  it('refuses an address already bound to a different Google account', async () => {
    const db = fakeDatabase([
      row({
        id: 'u1',
        email: 'guru@sekolah.id',
        role: 'teacher',
        active: true,
        google_sub: 'someone-else',
      }),
    ]);

    const user = await resolveGoogleAccount(db.queryable, {
      subject: 'g-attacker',
      email: 'guru@sekolah.id',
      name: 'Penyusup',
    });

    expect(user).toBeNull();
    expect(db.writes).toEqual([]);
    expect(db.rows[0]?.google_sub).toBe('someone-else');
  });
});
