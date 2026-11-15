/**
 * What the admin console may see of an account's API keys: which providers
 * the account stores a key for, the key's mask, and whether a verification
 * call succeeded with the key that is stored. The key itself never leaves
 * this module — summaries carry the last four characters at best.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { getProviderPreset } from '@/lib/config/provider-presets';

import { readWorkspaceModelConfig } from '@/lib/persistence/workspace-model-config';
import { listVerifiedApiKeysForOwners } from '@/lib/persistence/user-api-keys';
import { hashApiKey } from '@/lib/persistence/user-api-keys';
import type { AuthUser } from '@/lib/persistence/auth-accounts';
import type { ModelConfigFile } from '@/lib/server/model-config/openmaic-yml';

export interface AdminKeyView {
  /** The workspace provider's id (`onboarding-google`, …). */
  readonly id: string;
  /** The preset serving it (`google`, `openrouter`, `coarena`, `crowllm`). */
  readonly preset: string;
  /** The key's last four characters; `…` when there is nothing to show. */
  readonly mask: string;
  /** Chat providers carry the app's access gate; other capabilities do not. */
  readonly isChat: boolean;
  /** Whether the stored key still matches one a verification succeeded with. */
  readonly verified: boolean;
  /** When the matching verification happened, ISO, or null. */
  readonly verifiedAt: string | null;
  /** The model the verification ran on, or null. */
  readonly modelId: string | null;
  /** The stored secret does not open (the instance secret changed). */
  readonly unreadable: boolean;
}

export interface AdminUserKeySummary {
  /** The admin exempted this account from the gate. */
  readonly exempt: boolean;
  /**
   * `exempt` — the admin waived the gate.
   * `verified` — at least one chat key is stored and verified.
   * `unverified` — a chat key is stored but none matches a verification.
   * `none` — no chat key stored.
   */
  readonly status: 'exempt' | 'verified' | 'unverified' | 'none';
  /** Every provider with a stored secret, chat and non-chat. */
  readonly keys: readonly AdminKeyView[];
}

const maskKey = (key: string) => (key.length >= 12 ? `…${key.slice(-4)}` : '…');

type WorkspaceProviders = NonNullable<ModelConfigFile['providers']>;

function keyViews(
  providers: WorkspaceProviders | undefined,
  unreadable: readonly string[],
  verified: readonly { providerId: string; keyHash: string; verifiedAt: string; modelId: string }[],
): AdminKeyView[] {
  const unreadableSet = new Set(unreadable);
  const verifiedByProvider = new Map(verified.map((row) => [row.providerId, row]));
  const keys: AdminKeyView[] = [];
  for (const [id, provider] of Object.entries(providers ?? {})) {
    const isChat = Boolean(getProviderPreset(provider.preset)?.capabilities.chat);
    if (unreadableSet.has(id)) {
      keys.push({
        id,
        preset: provider.preset,
        mask: '…',
        isChat,
        verified: false,
        verifiedAt: null,
        modelId: null,
        unreadable: true,
      });
      continue;
    }
    if (!provider.apiKey && !provider.credentials) continue;
    const keyHash = provider.apiKey ? hashApiKey(provider.apiKey) : null;
    const match = keyHash
      ? verifiedByProvider.get(id)?.keyHash === keyHash
        ? verifiedByProvider.get(id)
        : undefined
      : undefined;
    keys.push({
      id,
      preset: provider.preset,
      mask: provider.apiKey ? maskKey(provider.apiKey) : '…',
      isChat,
      verified: Boolean(match),
      verifiedAt: match?.verifiedAt ?? null,
      modelId: match?.modelId ?? null,
      unreadable: false,
    });
  }
  // Chat first: the gate's fate lives there.
  return keys.sort((a, b) => Number(b.isChat) - Number(a.isChat) || a.id.localeCompare(b.id));
}

/** The key summary per account, one query for the statuses and one read per owner. */
export async function apiKeySummaries(
  queryable: Queryable,
  users: readonly AuthUser[],
): Promise<Map<string, AdminUserKeySummary>> {
  const ownerIds = users.map((user) => `user:${user.id}`);
  const statuses = await listVerifiedApiKeysForOwners(queryable, ownerIds);
  const verifiedByOwner = new Map<string, typeof statuses>();
  for (const row of statuses) {
    const bucket = verifiedByOwner.get(row.ownerId) ?? [];
    bucket.push(row);
    verifiedByOwner.set(row.ownerId, bucket);
  }

  const summaries = new Map<string, AdminUserKeySummary>();
  for (const user of users) {
    const ownerId = `user:${user.id}`;
    let keys: AdminKeyView[] = [];
    try {
      const stored = await readWorkspaceModelConfig(queryable, ownerId);
      keys = stored
        ? keyViews(
            stored.config.providers,
            stored.unreadableSecrets,
            verifiedByOwner.get(ownerId) ?? [],
          )
        : [];
    } catch (error) {
      // A configuration that cannot be read must not break the account list;
      // the row is shown with no key information instead.
      console.error('[admin-api-keys] the workspace configuration could not be read', error);
    }
    const chatKeys = keys.filter((key) => key.isChat);
    const status = user.apiKeyExempt
      ? ('exempt' as const)
      : chatKeys.length === 0
        ? ('none' as const)
        : chatKeys.some((key) => key.verified)
          ? ('verified' as const)
          : ('unverified' as const);
    summaries.set(user.id, { exempt: user.apiKeyExempt, status, keys });
  }
  return summaries;
}
