/**
 * The bring-your-own-key gate: an account that has not proved a chat key
 * works may not use the application.
 *
 * Every page and (owner-resolved) API route a signed-in account can reach
 * answers with a redirect or a 403 until either
 *
 * - the admin exempts the account (`auth_users.api_key_exempt`), or
 * - a chat provider in the account's workspace configuration stores a key
 *   whose SHA-256 matches the one a verification call succeeded with (the
 *   `user_api_key_status` rows) — so editing the key re-arms the requirement
 *   until the new key is verified again.
 *
 * The onboarding page (`/onboarding/api-key`) and the API surface the wizard
 * needs (`/api/model-config`, `/api/verify-model`) stay open on purpose;
 * everything else — pages, streams, the chat — requires the key. The check
 * fails open (with a log) when the database cannot be read: an outage
 * already breaks the app, a 403 on top would not help.
 *
 * Anonymous owners (accounts off, or a visitor without a session) are not
 * gated; only `kind: 'user'` principals minted from an `AUTH_ENABLED`
 * session are.
 */
import { redirect } from 'next/navigation';

import type { Queryable } from '@openmaic/storage/document/pg';
import { getProviderPreset } from '@/lib/config/provider-presets';

import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readWorkspaceModelConfig } from '@/lib/persistence/workspace-model-config';
import { hashApiKey, listVerifiedApiKeys } from '@/lib/persistence/user-api-keys';
import { authEnabled } from '@/lib/server/auth/config';
import type { AuthUser } from '@/lib/persistence/auth-accounts';
import type { ModelConfigFile } from '@/lib/server/model-config/openmaic-yml';
import type { OwnerPrincipal } from '@/lib/server/identity/types';

export const API_KEY_REQUIRED_CODE = 'API_KEY_REQUIRED';

type WorkspaceProviders = NonNullable<ModelConfigFile['providers']>;

/** API routes a not-yet-verified account may still reach. */
export function isApiKeyGateExemptPath(pathname: string): boolean {
  const n = pathname.replace(/\/+$/, '') || '/';
  return (
    n.startsWith('/api/auth/') ||
    n.startsWith('/api/access-code/') ||
    n.startsWith('/api/admin/') ||
    n.startsWith('/api/identity/') ||
    n === '/api/model-config' ||
    n.startsWith('/api/model-config/') ||
    n === '/api/verify-model' ||
    n === '/api/provider/probe-models' ||
    n === '/api/health'
  );
}

function pathnameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

export type ApiKeyAccess =
  | { readonly allowed: true; readonly reason: 'exempt' | 'verified' }
  | { readonly allowed: false; readonly reason: 'no-key' | 'unverified' };

export interface KeyedChatProvider {
  readonly id: string;
  readonly preset: string;
  readonly mask: string;
  readonly apiKey: string;
}

const maskKey = (key: string) => (key.length >= 12 ? `…${key.slice(-4)}` : '…');

/** The workspace's own chat providers that currently store a key. */
export function keyedChatProviders(
  providers: WorkspaceProviders | undefined,
  unreadable: readonly string[],
): KeyedChatProvider[] {
  const unreadableSet = new Set(unreadable);
  const keyed: KeyedChatProvider[] = [];
  for (const [id, provider] of Object.entries(providers ?? {})) {
    if (!provider.apiKey || unreadableSet.has(id)) continue;
    const preset = getProviderPreset(provider.preset);
    if (!preset?.capabilities.chat) continue;
    keyed.push({
      id,
      preset: provider.preset,
      mask: maskKey(provider.apiKey),
      apiKey: provider.apiKey,
    });
  }
  return keyed;
}

async function db(): Promise<Queryable> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set');
  const { pool } = await getServerPersistenceProvider(url);
  return pool as unknown as Queryable;
}

/**
 * The access decision for one account owner id (`user:<id>`). Reads the
 * account's exempt flag, its workspace configuration and the verification
 * rows, and answers whether the gate lets the account through.
 */
export async function apiKeyAccessFor(
  queryable: Queryable,
  ownerId: string,
): Promise<ApiKeyAccess> {
  const auth = await queryable.query<{ api_key_exempt: boolean } & Record<string, unknown>>(
    'SELECT api_key_exempt FROM auth_users WHERE id = $1',
    [ownerId.startsWith('user:') ? ownerId.slice('user:'.length) : ownerId],
  );
  if (auth.rows[0]?.api_key_exempt) return { allowed: true, reason: 'exempt' };

  const stored = await readWorkspaceModelConfig(queryable, ownerId);
  if (!stored) return { allowed: false, reason: 'no-key' };
  const providers = keyedChatProviders(stored.config.providers, stored.unreadableSecrets);
  if (providers.length === 0) return { allowed: false, reason: 'no-key' };

  const verified = await listVerifiedApiKeys(queryable, ownerId);
  const allowed = providers.some((provider) =>
    verified.some(
      (row) => row.providerId === provider.id && row.keyHash === hashApiKey(provider.apiKey),
    ),
  );
  return allowed ? { allowed: true, reason: 'verified' } : { allowed: false, reason: 'unverified' };
}

/** Whether the account may use the app. Database errors fail open (with a log). */
export async function apiKeyAccessAllowed(queryable: Queryable, ownerId: string): Promise<boolean> {
  try {
    return (await apiKeyAccessFor(queryable, ownerId)).allowed;
  } catch (error) {
    console.error('[api-key-gate] the gate could not be read; letting the request through', error);
    return true;
  }
}

/** The gate for one page render: redirects to the onboarding wizard. */
export async function requireApiKeyPass(user: AuthUser): Promise<void> {
  if (!authEnabled()) return;
  const ownerId = `user:${user.id}`;
  try {
    const queryable = await db();
    if (await apiKeyAccessAllowed(queryable, ownerId)) return;
  } catch (error) {
    console.error('[api-key-gate] the gate could not be read; letting the request through', error);
    return;
  }
  redirect('/onboarding/api-key');
}

/** Whether the gate currently lets this account through (the onboarding page asks). */
export async function apiKeyPassesForUser(user: AuthUser): Promise<boolean> {
  if (!authEnabled()) return true;
  try {
    const queryable = await db();
    return await apiKeyAccessAllowed(queryable, `user:${user.id}`);
  } catch (error) {
    console.error(
      '[api-key-gate] the gate could not be read; treating the account as passed',
      error,
    );
    return true;
  }
}

/** The gate for one API route: an anonymous 403 with a stable error code. */
export async function apiKeyGateResponse(
  url: string | undefined,
  principal: OwnerPrincipal,
): Promise<Response | undefined> {
  if (!authEnabled()) return undefined;
  if (principal.kind !== 'user') return undefined;
  const pathname = pathnameFromUrl(url);
  if (pathname && isApiKeyGateExemptPath(pathname)) return undefined;
  let queryable: Queryable;
  try {
    queryable = await db();
  } catch (error) {
    console.error('[api-key-gate] the gate could not be read; letting the request through', error);
    return undefined;
  }
  if (await apiKeyAccessAllowed(queryable, principal.ownerId)) return undefined;
  return Response.json(
    {
      error: {
        code: API_KEY_REQUIRED_CODE,
        message: 'A verified API key is required before the app can be used.',
      },
      errorCode: API_KEY_REQUIRED_CODE,
    },
    { status: 403 },
  );
}
