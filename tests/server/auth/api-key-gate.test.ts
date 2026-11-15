/**
 * The bring-your-own-key gate, against a real in-memory PostgreSQL.
 *
 * One store (`user_api_key_status`) records the key a verification call
 * succeeded with; the account's workspace configuration is the source of
 * truth for which providers exist and which key is stored. The gate is open
 * only while the two agree, the admin has waived it, or neither applies and
 * a chat key was verified. Everything else — including a changed key — is
 * closed.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectableQueryable } from '@openmaic/storage/server/reference';

import { ensureAuthSchema } from '@/lib/persistence/auth-accounts';
import { ensureWorkspaceModelConfigSchema } from '@/lib/persistence/workspace-model-config';
import {
  ensureUserApiKeyStatusSchema,
  hashApiKey,
  recordVerifiedApiKey,
  deleteVerifiedApiKeys,
  listVerifiedApiKeys,
} from '@/lib/persistence/user-api-keys';
import {
  apiKeyAccessFor,
  isApiKeyGateExemptPath,
  keyedChatProviders,
} from '@/lib/server/auth/api-key-gate';
import { apiKeySummaries } from '@/lib/server/auth/user-api-keys';
import { resetInstanceKeyForTests } from '@/lib/server/secret-box';
import { saveWorkspaceModelConfig } from '@/lib/persistence/workspace-model-config';

class PGlitePool {
  constructor(readonly db: PGlite) {}
  query(text: string, params?: unknown[]) {
    return this.db.query(text, params);
  }
  async connect() {
    return {
      query: (text: string, params?: unknown[]) => this.db.query(text, params),
      release() {},
    };
  }
}

const ALICE = 'user:alice';
const BOB = 'user:bob';

async function createUser(
  db: PGlitePool,
  id: string,
  { exempt = false, active = true }: { exempt?: boolean; active?: boolean } = {},
) {
  await db.query(
    `INSERT INTO auth_users (id, email, name, role, active, api_key_exempt)
     VALUES ($1, $2, $3, 'student', $4, $5)`,
    [
      id.slice('user:'.length),
      `${id.slice('user:'.length)}@example.sch.id`,
      id.slice('user:'.length),
      active,
      exempt,
    ],
  );
}

describe('the bring-your-own-key gate', () => {
  let db: PGlite;
  let pool: ConnectableQueryable & PGlitePool;

  beforeEach(async () => {
    resetInstanceKeyForTests();
    vi.stubEnv('OPENMAIC_SECRET_KEY', 'test-instance-secret');
    db = new PGlite();
    await db.waitReady;
    pool = new PGlitePool(db) as unknown as ConnectableQueryable & PGlitePool;
    await ensureAuthSchema(pool);
    await ensureWorkspaceModelConfigSchema(pool);
    await ensureUserApiKeyStatusSchema(pool);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetInstanceKeyForTests();
    await db.close();
  });

  it('matches only the onboarding, auth and health endpoints', () => {
    for (const path of [
      '/api/auth/me',
      '/api/auth/logout',
      '/api/admin/users',
      '/api/admin/users/abc/api-key',
      '/api/model-config',
      '/api/verify-model',
      '/api/provider/probe-models',
      '/api/health',
      '/api/identity/claim',
    ]) {
      expect(isApiKeyGateExemptPath(path), path).toBe(true);
    }
    for (const path of [
      '/api/chat/pi',
      '/api/stages',
      '/api/model-config-extra',
      '/api/agent/models',
      '/',
      '/api/provider/probe-image-models',
    ]) {
      expect(isApiKeyGateExemptPath(path), path).toBe(false);
    }
  });

  it('stays closed with no workspace configuration at all', async () => {
    await createUser(pool, ALICE);
    await expect(apiKeyAccessFor(pool, ALICE)).resolves.toEqual({
      allowed: false,
      reason: 'no-key',
    });
  });

  it('lets an exempted account through without any key', async () => {
    await createUser(pool, ALICE, { exempt: true });
    await expect(apiKeyAccessFor(pool, ALICE)).resolves.toEqual({
      allowed: true,
      reason: 'exempt',
    });
  });

  it('closing state: a stored key that never verified', async () => {
    await createUser(pool, ALICE);
    await saveWorkspaceModelConfig(
      pool,
      ALICE,
      { providers: { 'onboarding-google': { preset: 'google', apiKey: 'AIza-test-key-1' } } },
      null,
    );
    await expect(apiKeyAccessFor(pool, ALICE)).resolves.toEqual({
      allowed: false,
      reason: 'unverified',
    });
  });

  it('opens once the stored key has a matching verification row', async () => {
    await createUser(pool, ALICE);
    await saveWorkspaceModelConfig(
      pool,
      ALICE,
      { providers: { 'onboarding-google': { preset: 'google', apiKey: 'AIza-test-key-1' } } },
      null,
    );
    await recordVerifiedApiKey(pool, {
      ownerId: ALICE,
      providerId: 'onboarding-google',
      apiKey: 'AIza-test-key-1',
      preset: 'google',
      modelId: 'gemini-3.5-flash-lite',
    });
    await expect(apiKeyAccessFor(pool, ALICE)).resolves.toEqual({
      allowed: true,
      reason: 'verified',
    });
  });

  it('closes again when the key is changed, even though it verified before', async () => {
    await createUser(pool, ALICE);
    await saveWorkspaceModelConfig(
      pool,
      ALICE,
      { providers: { 'onboarding-google': { preset: 'google', apiKey: 'AIza-test-key-1' } } },
      null,
    );
    await recordVerifiedApiKey(pool, {
      ownerId: ALICE,
      providerId: 'onboarding-google',
      apiKey: 'AIza-test-key-1',
      preset: 'google',
      modelId: 'gemini-3.5-flash-lite',
    });
    const stored = await saveWorkspaceModelConfig(
      pool,
      ALICE,
      { providers: { 'onboarding-google': { preset: 'google', apiKey: 'AIza-test-key-2' } } },
      1,
    );
    expect(stored).toBe(2);
    await expect(apiKeyAccessFor(pool, ALICE)).resolves.toEqual({
      allowed: false,
      reason: 'unverified',
    });
  });

  it('a non-chat key does not open the gate', async () => {
    await createUser(pool, ALICE);
    await saveWorkspaceModelConfig(
      pool,
      ALICE,
      { providers: { 'onboarding-tts': { preset: 'voxcpm-tts', apiKey: 'tts-key-1234567890' } } },
      null,
    );
    await recordVerifiedApiKey(pool, {
      ownerId: ALICE,
      providerId: 'onboarding-tts',
      apiKey: 'tts-key-1234567890',
      preset: 'voxcpm-tts',
      modelId: 'irrelevant',
    });
    await expect(apiKeyAccessFor(pool, ALICE)).resolves.toEqual({
      allowed: false,
      reason: 'no-key',
    });
  });

  it('after verification is revoked, the gate closes and rows are gone', async () => {
    await createUser(pool, ALICE);
    await saveWorkspaceModelConfig(
      pool,
      ALICE,
      {
        providers: {
          'onboarding-openrouter': { preset: 'openrouter', apiKey: 'sk-or-test-key-1' },
        },
      },
      null,
    );
    await recordVerifiedApiKey(pool, {
      ownerId: ALICE,
      providerId: 'onboarding-openrouter',
      apiKey: 'sk-or-test-key-1',
      preset: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
    });
    expect((await listVerifiedApiKeys(pool, ALICE)).length).toBe(1);
    await deleteVerifiedApiKeys(pool, ALICE);
    expect(await listVerifiedApiKeys(pool, ALICE)).toEqual([]);
    await expect(apiKeyAccessFor(pool, ALICE)).resolves.toEqual({
      allowed: false,
      reason: 'unverified',
    });
  });

  it('hashApiKey is stable and distinguishable', () => {
    expect(hashApiKey('secret')).toBe(hashApiKey('secret'));
    expect(hashApiKey('secret')).not.toBe(hashApiKey('secret2'));
    expect(hashApiKey('secret')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('summaries per account reflect the same decision for the admin console', async () => {
    await createUser(pool, ALICE);
    await createUser(pool, BOB, { exempt: true });
    await saveWorkspaceModelConfig(
      pool,
      ALICE,
      { providers: { 'onboarding-crowllm': { preset: 'crowllm', apiKey: 'crowd-test-key-123' } } },
      null,
    );
    const users = [
      {
        id: 'alice',
        email: 'alice@example.sch.id',
        name: 'Alice',
        role: 'student' as const,
        active: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        lastLoginAt: null,
        apiKeyExempt: false,
      },
      {
        id: 'bob',
        email: 'bob@example.sch.id',
        name: 'Bob',
        role: 'teacher' as const,
        active: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        lastLoginAt: null,
        apiKeyExempt: true,
      },
    ];
    const before = await apiKeySummaries(pool, users);
    expect(before.get('alice')?.status).toBe('unverified');
    expect(before.get('bob')?.status).toBe('exempt');
    expect(before.get('alice')?.keys[0]?.mask).toBe('…-123');

    await recordVerifiedApiKey(pool, {
      ownerId: ALICE,
      providerId: 'onboarding-crowllm',
      apiKey: 'crowd-test-key-123',
      preset: 'crowllm',
      modelId: 'gpt-5.6-sol:free',
    });
    const after = await apiKeySummaries(pool, users);
    expect(after.get('alice')?.status).toBe('verified');
    expect(after.get('alice')?.keys[0]?.verified).toBe(true);
    expect(after.get('alice')?.keys[0]?.verifiedAt).toBeTruthy();
  });

  it('keyed chat providers are the only ones the gate counts', () => {
    const keyed = keyedChatProviders(
      {
        chat: { preset: 'coarena', apiKey: 'key-chat-123456' },
        voice: { preset: 'voxcpm-tts', apiKey: 'key-tts-1234567' },
        secretless: { preset: 'openrouter' },
      },
      [],
    );
    expect(keyed.map((entry) => entry.id)).toEqual(['chat']);
    // Unreadable secrets never pass the gate.
    expect(
      keyedChatProviders({ chat: { preset: 'coarena', apiKey: 'key-chat-123456' } }, ['chat']),
    ).toEqual([]);
  });
});
