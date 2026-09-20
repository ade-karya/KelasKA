/**
 * Host-side user/session store bridging the task-spec API to the pg backend.
 *
 * Task spec assumed host wrappers:
 * - createUser(username, passwordHash)
 * - findUserByUsername(username) -> { id, username, password_hash } | null
 * - createUserSession(tokenHash, userId, expiresAt)
 * - findUserSession(tokenHash) -> { user_id, expires_at } | null
 * - deleteUserSession(tokenHash)
 *
 * The storage slice that landed instead exports pg-level functions
 * (`Queryable` first, camelCase rows). This module accepts BOTH: when the
 * export takes a single argument it is called host-style; otherwise a pool
 * from the server persistence provider is supplied as the first argument and
 * camelCase rows are normalized to the spec shape.
 *
 * All storage/provider imports are dynamic so Edge bundles and routes that
 * never touch auth do not pull in pg.
 */

export interface StoredUser {
  id: string;
  username: string;
  password_hash: string;
}

export interface StoredSessionRow {
  user_id: string;
  expires_at: Date | string;
}

type QueryableLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

let ensuredConnectionKey: string | undefined;
let ensurePromise: Promise<void> | undefined;

async function getQueryableWithAuthSchema(): Promise<QueryableLike> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !connectionString.trim()) {
    throw new Error('User auth requires DATABASE_URL');
  }
  const key = connectionString.trim();
  const [{ getServerPersistenceProvider }, storage] = await Promise.all([
    import('@/lib/persistence/server-provider'),
    import('@openmaic/storage'),
  ]);
  const { pool } = await getServerPersistenceProvider(connectionString);
  const queryable = pool as unknown as QueryableLike;
  const ensureAuthSchema = (storage as unknown as {
    ensureAuthSchema?: (q: unknown) => Promise<void>;
  }).ensureAuthSchema;
  if (typeof ensureAuthSchema === 'function') {
    if (ensuredConnectionKey !== key || !ensurePromise) {
      ensuredConnectionKey = key;
      ensurePromise = ensureAuthSchema(queryable).catch((error) => {
        ensuredConnectionKey = undefined;
        ensurePromise = undefined;
        throw error;
      });
    }
    await ensurePromise;
  }
  return queryable;
}

function normalizeUser(raw: unknown): StoredUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : null;
  const username = typeof row.username === 'string' ? row.username : null;
  const passwordHash =
    typeof row.password_hash === 'string'
      ? (row.password_hash as string)
      : typeof row.passwordHash === 'string'
        ? (row.passwordHash as string)
        : null;
  if (!id || !username || !passwordHash) return null;
  return { id, username, password_hash: passwordHash };
}

function normalizeSession(raw: unknown): StoredSessionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const userId =
    typeof row.user_id === 'string'
      ? (row.user_id as string)
      : typeof row.userId === 'string'
        ? (row.userId as string)
        : null;
  const expiresAt =
    row.expires_at instanceof Date
      ? (row.expires_at as Date)
      : typeof row.expires_at === 'string'
        ? (row.expires_at as string)
        : row.expiresAt instanceof Date
          ? (row.expiresAt as Date)
          : typeof row.expiresAt === 'string'
            ? (row.expiresAt as string)
            : null;
  if (!userId || !expiresAt) return null;
  return { user_id: userId, expires_at: expiresAt };
}

export async function findUserByUsername(username: string): Promise<StoredUser | null> {
  const storage = (await import('@openmaic/storage')) as unknown as Record<string, unknown>;
  const fn = storage.findUserByUsername as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;
  if (typeof fn !== 'function') throw new Error('findUserByUsername is unavailable');
  const raw =
    fn.length <= 1
      ? await fn(username)
      : await fn(await getQueryableWithAuthSchema(), username);
  return normalizeUser(raw);
}

export async function createUser(username: string, passwordHash: string): Promise<StoredUser> {
  const storage = (await import('@openmaic/storage')) as unknown as Record<string, unknown>;
  const fn = storage.createUser as ((...args: unknown[]) => Promise<unknown>) | undefined;
  if (typeof fn !== 'function') throw new Error('createUser is unavailable');
  // Host-style per spec takes (username, passwordHash); pg-style prepends Queryable.
  const raw =
    fn.length <= 2
      ? await fn(username, passwordHash)
      : await fn(await getQueryableWithAuthSchema(), username, passwordHash);
  const normalized = normalizeUser(raw);
  if (!normalized) throw new Error('createUser returned an unexpected shape');
  return normalized;
}

export async function createUserSession(
  tokenHash: string,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  const storage = (await import('@openmaic/storage')) as unknown as Record<string, unknown>;
  const fn = storage.createUserSession as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;
  if (typeof fn !== 'function') throw new Error('createUserSession is unavailable');
  // Host-style per spec takes (tokenHash, userId, expiresAt); pg-style prepends Queryable.
  if (fn.length <= 3) {
    await fn(tokenHash, userId, expiresAt);
  } else {
    await fn(await getQueryableWithAuthSchema(), tokenHash, userId, expiresAt);
  }
}

export async function findUserSession(tokenHash: string): Promise<StoredSessionRow | null> {
  const storage = (await import('@openmaic/storage')) as unknown as Record<string, unknown>;
  const fn = storage.findUserSession as ((...args: unknown[]) => Promise<unknown>) | undefined;
  if (typeof fn !== 'function') throw new Error('findUserSession is unavailable');
  let raw: unknown;
  if (fn.length <= 1) {
    raw = await fn(tokenHash);
  } else {
    raw = await fn(await getQueryableWithAuthSchema(), tokenHash);
  }
  const normalized = normalizeSession(raw);
  if (!normalized) return null;
  // Host-side expiry guard (the pg backend also enforces it server-side).
  const expiresAt =
    normalized.expires_at instanceof Date
      ? normalized.expires_at
      : new Date(normalized.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;
  return normalized;
}

export async function deleteUserSession(tokenHash: string): Promise<void> {
  const storage = (await import('@openmaic/storage')) as unknown as Record<string, unknown>;
  const fn = storage.deleteUserSession as ((...args: unknown[]) => Promise<unknown>) | undefined;
  if (typeof fn !== 'function') return;
  if (fn.length <= 1) {
    await fn(tokenHash);
  } else {
    await fn(await getQueryableWithAuthSchema(), tokenHash);
  }
}

export async function findUserById(id: string): Promise<{ id: string; username: string } | null> {
  if (!id) return null;
  try {
    const storage = (await import('@openmaic/storage')) as unknown as Record<string, unknown>;
    for (const key of ['findUserById', 'getUserById']) {
      const fn = storage[key] as ((...args: unknown[]) => Promise<unknown>) | undefined;
      if (typeof fn !== 'function') continue;
      const raw =
        fn.length <= 1 ? await fn(id) : await fn(await getQueryableWithAuthSchema(), id);
      if (raw && typeof raw === 'object') {
        const row = raw as Record<string, unknown>;
        if (typeof row.id === 'string' && typeof row.username === 'string') {
          return { id: row.id, username: row.username };
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  // Fallback: direct lookup (the pg backend has no find-by-id helper).
  try {
    const queryable = await getQueryableWithAuthSchema();
    const result = await queryable.query('SELECT id, username FROM users WHERE id = $1 LIMIT 1', [
      id,
    ]);
    const row = result.rows[0] as { id?: unknown; username?: unknown } | undefined;
    if (row && typeof row.id === 'string' && typeof row.username === 'string') {
      return { id: row.id, username: row.username };
    }
  } catch {
    // Best-effort only.
  }
  return null;
}

export function isUserExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'USER_EXISTS') return true;
  // node-postgres unique-violation bubbling up without the AuthError wrapper.
  if (code === '23505') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message) && /username/i.test(message);
}
