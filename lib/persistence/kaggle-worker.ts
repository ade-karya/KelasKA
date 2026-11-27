/**
 * Launch bookkeeping for the on-demand Kaggle worker.
 *
 * A Vercel function ends with its request, so the generation runner that
 * claims runs cannot live there. The UI host starts a Kaggle kernel instead;
 * that kernel runs the full app (including the runner) against the same
 * database. Starting a kernel is expensive, so the row in this table is the
 * cross-instance cooldown: one Vercel instance reserves a launch, and the
 * others skip instead of pushing another kernel version.
 *
 * The row is deliberately tiny and best-effort. If it cannot be written the
 * caller still starts the worker (an extra launch is cheaper than a run that
 * waits forever), so this table is not part of any correctness guarantee.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const KAGGLE_WORKER_SCHEMA = `
CREATE TABLE IF NOT EXISTS kaggle_worker_launch (
  id               TEXT PRIMARY KEY,
  last_started_at  BIGINT NOT NULL,
  last_status      TEXT,
  last_error       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const KAGGLE_WORKER_MIGRATIONS: SchemaMigrationSet = {
  store: 'kaggle-worker',
  migrations: [{ version: 1, name: 'baseline', up: KAGGLE_WORKER_SCHEMA, transaction: false }],
};

export async function ensureKaggleWorkerSchema(queryable: Queryable): Promise<void> {
  await applySchemaMigrations(queryable, KAGGLE_WORKER_MIGRATIONS);
}

const LAUNCH_ID = 'default';

/**
 * Reserve the next launch slot. Returns true when this caller may start the
 * worker: no launch was recorded within `cooldownMs`. The upsert is atomic,
 * so concurrent Vercel instances cannot both win.
 */
export async function reserveKaggleWorkerLaunch(
  queryable: Queryable,
  cooldownMs: number,
  now = Date.now(),
): Promise<boolean> {
  const { rows } = await queryable.query<{ id: string }>(
    `INSERT INTO kaggle_worker_launch (id, last_started_at)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE
       SET last_started_at = EXCLUDED.last_started_at, updated_at = now()
       WHERE kaggle_worker_launch.last_started_at < $3
     RETURNING id`,
    [LAUNCH_ID, now, now - cooldownMs],
  );
  return rows.length > 0;
}

/** Record how the launch ended, for the next operator looking at the table. */
export async function recordKaggleWorkerLaunch(
  queryable: Queryable,
  status: string,
  error?: string,
): Promise<void> {
  await queryable.query(
    `UPDATE kaggle_worker_launch
        SET last_status = $2, last_error = $3, updated_at = now()
      WHERE id = $1`,
    [LAUNCH_ID, status, error ?? null],
  );
}
