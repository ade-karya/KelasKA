/**
 * Verified API keys for accounts (the "bring your own key" gate).
 *
 * A row here says: this owner (`user:<id>`) proved at least once that a chat
 * provider stored in its workspace configuration answered a real chat call,
 * with the key that is stored there. Only the SHA-256 of the key is kept —
 * never the key itself — so the gate can match "the key that was verified"
 * against "the key the workspace configuration stores now". A user who edits
 * the key in settings silently invalidates the verification (the hashes no
 * longer match) and is sent back through the onboarding wizard until the new
 * key is verified again.
 *
 * Rows are keyed by (owner_id, provider_id): each provider may carry its own
 * verified key. Removing a provider (in settings or by an admin) makes its
 * row unreachable — the workspace configuration is the source of truth for
 * which providers exist — and a stale row never re-opens the gate because
 * the stored key's hash is compared, not merely the provider's presence.
 */
import { createHash } from 'node:crypto';

import type { Queryable } from '@openmaic/storage/document/pg';
import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

export const USER_API_KEY_STATUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_api_key_status (
  owner_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  preset TEXT NOT NULL,
  model_id TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, provider_id)
);

CREATE INDEX IF NOT EXISTS user_api_key_status_owner_idx ON user_api_key_status (owner_id);
`;

export const USER_API_KEY_STATUS_MIGRATIONS: SchemaMigrationSet = {
  store: 'user-api-key-status',
  migrations: [
    { version: 1, name: 'baseline', up: USER_API_KEY_STATUS_SCHEMA, transaction: false },
  ],
};

export async function ensureUserApiKeyStatusSchema(queryable: Queryable): Promise<void> {
  await applySchemaMigrations(queryable, USER_API_KEY_STATUS_MIGRATIONS);
}

/** SHA-256 of an API key; the only form of the key this table ever holds. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

export interface UserApiKeyStatus {
  readonly ownerId: string;
  readonly providerId: string;
  readonly keyHash: string;
  readonly preset: string;
  readonly modelId: string;
  readonly verifiedAt: string;
}

interface UserApiKeyStatusRow extends Record<string, unknown> {
  owner_id: string;
  provider_id: string;
  key_hash: string;
  preset: string;
  model_id: string;
  verified_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: UserApiKeyStatusRow): UserApiKeyStatus {
  return {
    ownerId: row.owner_id,
    providerId: row.provider_id,
    keyHash: row.key_hash,
    preset: row.preset,
    modelId: row.model_id,
    verifiedAt: iso(row.verified_at),
  };
}

/** Record (or refresh) a successful verification of one provider's key. */
export async function recordVerifiedApiKey(
  queryable: Queryable,
  input: {
    readonly ownerId: string;
    readonly providerId: string;
    readonly apiKey: string;
    readonly preset: string;
    readonly modelId: string;
  },
): Promise<void> {
  await queryable.query(
    `INSERT INTO user_api_key_status (owner_id, provider_id, key_hash, preset, model_id, verified_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (owner_id, provider_id) DO UPDATE
       SET key_hash = $3, preset = $4, model_id = $5, verified_at = now(), updated_at = now()`,
    [input.ownerId, input.providerId, hashApiKey(input.apiKey), input.preset, input.modelId],
  );
}

/** Every status row for one owner. */
export async function listVerifiedApiKeys(
  queryable: Queryable,
  ownerId: string,
): Promise<UserApiKeyStatus[]> {
  const result = await queryable.query<UserApiKeyStatusRow & Record<string, unknown>>(
    `SELECT owner_id, provider_id, key_hash, preset, model_id, verified_at
       FROM user_api_key_status
      WHERE owner_id = $1`,
    [ownerId],
  );
  return result.rows.map(mapRow);
}

/** Status rows for many owners at once (the admin console's list). */
export async function listVerifiedApiKeysForOwners(
  queryable: Queryable,
  ownerIds: readonly string[],
): Promise<UserApiKeyStatus[]> {
  if (ownerIds.length === 0) return [];
  const result = await queryable.query<UserApiKeyStatusRow & Record<string, unknown>>(
    `SELECT owner_id, provider_id, key_hash, preset, model_id, verified_at
       FROM user_api_key_status
      WHERE owner_id = ANY($1::text[])`,
    [ownerIds],
  );
  return result.rows.map(mapRow);
}

/** Forget verification state: one provider, or every key of the owner. */
export async function deleteVerifiedApiKeys(
  queryable: Queryable,
  ownerId: string,
  providerId?: string,
): Promise<void> {
  if (providerId === undefined) {
    await queryable.query(`DELETE FROM user_api_key_status WHERE owner_id = $1`, [ownerId]);
    return;
  }
  await queryable.query(
    `DELETE FROM user_api_key_status WHERE owner_id = $1 AND provider_id = $2`,
    [ownerId, providerId],
  );
}
