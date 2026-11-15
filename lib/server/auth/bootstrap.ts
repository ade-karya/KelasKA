/**
 * Account-layer startup work.
 *
 * There is nothing to seed any more: sign-in is Google-only, so the first admin
 * is the address named in `AUTH_ADMIN_EMAILS`, who becomes an active admin on
 * their first Google sign-in (see `app/api/auth/supabase/callback/route.ts`).
 * This module's job is the schema — `getServerPersistenceProvider` runs every
 * registered migration, `auth-accounts` included — plus expired-session
 * housekeeping and a loud warning when a deployment has neither a configured
 * admin address nor an active admin, because then nobody can approve the
 * pending accounts that sign-ins create.
 *
 * It runs in the background from `instrumentation.node.ts` and is awaited by
 * the Supabase callback before its first write, so a callback that races the
 * boot still finds the tables.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import { countActiveAdmins, pruneExpiredAuthSessions } from '@/lib/persistence/auth-accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { createLogger } from '@/lib/logger';
import { authAdminEmails, authEnabled, authSecret } from '@/lib/server/auth/config';

const log = createLogger('Auth');

let bootstrapPromise: Promise<void> | undefined;

async function runBootstrap(): Promise<void> {
  const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  const queryable = pool as unknown as Queryable;
  await pruneExpiredAuthSessions(queryable).catch((error) => {
    log.warn('could not prune expired sessions (non-fatal)', error);
  });

  if (authAdminEmails().length > 0) return;
  const admins = await countActiveAdmins(queryable);
  if (admins > 0) return;
  log.warn(
    'AUTH_ADMIN_EMAILS is empty and no active admin exists. New Google sign-ins are created ' +
      'pending and nobody can approve them: set AUTH_ADMIN_EMAILS to the admin Google address ' +
      'and restart, or promote an account directly in auth_users.',
  );
}

/**
 * Provision accounts in the background. Called from `instrumentation.node.ts`;
 * it never blocks the server from starting, and a failure is retried on the
 * next sign-in attempt through {@link ensureAuthBootstrap}.
 */
export function startAuthBootstrap(): void {
  if (!authEnabled()) return;
  if (!process.env.DATABASE_URL?.trim()) return;
  if (!authSecret()) return;
  bootstrapPromise ??= runBootstrap().catch((error) => {
    bootstrapPromise = undefined;
    log.error('account bootstrap failed; the Google callback retries it', error);
  });
}

/**
 * Ensure the schema and the admin warning exist before answering a sign-in.
 * The background call above usually finished long ago; this awaits it when it
 * did not, and starts it when the process has not bootstrapped yet.
 */
export async function ensureAuthBootstrap(): Promise<void> {
  if (!authEnabled()) return;
  bootstrapPromise ??= runBootstrap().catch((error) => {
    bootstrapPromise = undefined;
    throw error;
  });
  await bootstrapPromise;
}
