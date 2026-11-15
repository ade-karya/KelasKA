/**
 * The native-app sign-in: a Supabase access token comes in, the app's own
 * revocable session goes out. The Supabase verification call and the account
 * database are injected, so the refusal paths are pinned without HTTP or a
 * live database — the mapping rules are the same ones the browser callback
 * runs through `resolveGoogleAccount`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Queryable } from '@openmaic/storage/document/pg';

import { signInWithSupabaseAccessToken } from '@/lib/server/auth/native-session';

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

/** The smallest dispatcher the account statements need. */
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

function supabaseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'supa-user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'guru@sekolah.id',
    email_confirmed_at: '2026-11-01T00:00:00.000Z',
    app_metadata: { provider: 'google' },
    user_metadata: { full_name: 'Ibu Guru', email_verified: true },
    identities: [
      { provider: 'google', identity_data: { sub: 'google-sub-1', email_verified: true } },
    ],
    ...overrides,
  };
}

function fakeFetch(userJson: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => userJson,
    }) as Response) as unknown as typeof fetch;
}

function deps(fetchImpl: typeof fetch, db: ReturnType<typeof fakeDatabase>) {
  return {
    fetchImpl,
    database: async () => db.queryable,
    createSession: async () => ({
      token: 'signed-kelaska-session',
      maxAge: 2_592_000,
      sessionIdHash: 'session-id-hash',
    }),
  };
}

describe('signInWithSupabaseAccessToken', () => {
  const original = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.AUTH_ADMIN_EMAILS;
    delete process.env.AUTH_ADMIN_EMAIL;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries({
      NEXT_PUBLIC_SUPABASE_URL: original.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: original.key,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: original.publishable,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('mints the app session for an approved account bound to the Google subject', async () => {
    const db = fakeDatabase([
      row({ id: 'u1', email: 'guru@sekolah.id', role: 'teacher', active: true, google_sub: 'google-sub-1' }),
    ]);

    const result = await signInWithSupabaseAccessToken(
      'supabase-access-token',
      {},
      deps(fakeFetch(supabaseUser()), db),
    );

    expect(result.kind).toBe('signed-in');
    if (result.kind !== 'signed-in') return;
    expect(result.token).toBe('signed-kelaska-session');
    expect(result.maxAge).toBe(2_592_000);
    expect(result.user).toMatchObject({ id: 'u1', email: 'guru@sekolah.id', role: 'teacher' });
    expect(db.writes).toEqual(['update']); // the last-login stamp only; no binding needed
  });

  it('creates a pending account for an unknown address and mints nothing', async () => {
    const db = fakeDatabase([]);

    const result = await signInWithSupabaseAccessToken(
      'supabase-access-token',
      {},
      deps(fakeFetch(supabaseUser({ email: 'baru@sekolah.id', identities: [
        { provider: 'google', identity_data: { sub: 'google-new', email_verified: true } },
      ] })), db),
    );

    expect(result.kind).toBe('pending');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ email: 'baru@sekolah.id', active: false, role: 'student' });
  });

  it('keeps an existing pending account pending', async () => {
    const db = fakeDatabase([row({ id: 'u1', email: 'guru@sekolah.id' })]);

    const result = await signInWithSupabaseAccessToken(
      'supabase-access-token',
      {},
      deps(fakeFetch(supabaseUser()), db),
    );

    expect(result.kind).toBe('pending');
  });

  it('refuses when Supabase does not recognise the token', async () => {
    const db = fakeDatabase([
      row({ id: 'u1', email: 'guru@sekolah.id', role: 'teacher', active: true, google_sub: 'google-sub-1' }),
    ]);

    const result = await signInWithSupabaseAccessToken(
      'expired-token',
      {},
      deps(fakeFetch({ message: 'invalid JWT' }, 401), db),
    );

    expect(result.kind).toBe('refused');
    expect(db.rows[0]!.last_login_at).toBeNull();
  });

  it('refuses when the profile has no verified e-mail', async () => {
    const db = fakeDatabase([]);
    const unverified = supabaseUser({
      email_confirmed_at: null,
      user_metadata: { full_name: 'Ibu Guru', email_verified: false },
      identities: [{ provider: 'google', identity_data: { sub: 'google-sub-1', email_verified: false } }],
    });

    const result = await signInWithSupabaseAccessToken(
      'supabase-access-token',
      {},
      deps(fakeFetch(unverified), db),
    );

    expect(result.kind).toBe('refused');
    expect(db.rows).toHaveLength(0);
  });

  it('refuses when the verification request fails', async () => {
    const db = fakeDatabase([]);
    const failingFetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;

    const result = await signInWithSupabaseAccessToken(
      'supabase-access-token',
      {},
      deps(failingFetch, db),
    );

    expect(result.kind).toBe('refused');
  });

  it('refuses when Supabase is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const db = fakeDatabase([]);

    const result = await signInWithSupabaseAccessToken(
      'supabase-access-token',
      {},
      deps(fakeFetch(supabaseUser()), db),
    );

    expect(result.kind).toBe('refused');
  });
});
