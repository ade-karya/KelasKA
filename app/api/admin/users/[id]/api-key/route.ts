/**
 * `/api/admin/users/[id]/api-key` — administer an account's API key.
 *
 * Admin only, and the account is the one in the URL — never the caller's.
 *
 * - `PUT`    — set or replace the account's chat key. The key is verified
 *              against the provider *before* anything is persisted; on
 *              success the workspace provider is stored (sealed, as the
 *              self-service settings would), the `llm` and `agent` slots are
 *              assigned to it, and the verification is recorded so the
 *              account passes the bring-your-own-key gate.
 * - `PATCH`  — exempt the account from the gate (`{ exempt: boolean }`).
 * - `DELETE` — revoke: every keyed chat provider in the account's workspace
 *              configuration is removed, and every verification row is
 *              dropped. The account is back in onboarding on its next page.
 *
 * The key itself is never returned, never logged, and stored sealed; the
 * account list masks it to its last four characters.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isSameOriginJsonRequest } from '@/lib/persistence/owner-claim-http';
import { findAuthUserById, updateAuthUser } from '@/lib/persistence/auth-accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import {
  readWorkspaceModelConfig,
  saveWorkspaceModelConfig,
  WorkspaceConfigConflictError,
} from '@/lib/persistence/workspace-model-config';
import { recordVerifiedApiKey, deleteVerifiedApiKeys } from '@/lib/persistence/user-api-keys';
import { applyModelSettingsChange, ModelSettingsError } from '@/lib/server/model-config/settings';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { authDatabase } from '@/lib/server/auth/session';
import { isOnboardingPreset, onboardingProvider } from '@/lib/config/api-key-onboarding';
import type { ProviderId } from '@/lib/types/provider';
import { getProvider, getModel } from '@/lib/ai/providers';
import { callLLM } from '@/lib/ai/llm';
import { upstreamHttpStatus } from '@/lib/server/llm-error-response';
import { createLogger } from '@/lib/logger';
import { principalHasRole, OWNER_ROLES, type OwnerPrincipal } from '@/lib/server/identity';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getProviderPreset } from '@/lib/config/provider-presets';
import { fetchWithRedirectValidation } from '@/lib/server/fetch-with-redirect-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('Admin API Keys');

type Params = { params: Promise<{ id: string }> };

function requireAdmin(principal: OwnerPrincipal) {
  return principalHasRole(principal, OWNER_ROLES.admin);
}

async function workspaceQueryable() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set');
  const { pool } = await getServerPersistenceProvider(url);
  return pool;
}

/** Same minimal probe verify-model runs, pinned to the deployment's own registry id. */
async function probeOnboardingKey(preset: string, modelId: string, apiKey: string) {
  const registered = getProvider(preset as ProviderId);
  if (!registered) throw new Error(`Unknown provider: ${preset}`);
  const { model } = getModel({
    providerId: preset as ProviderId,
    modelId,
    apiKey,
    baseUrl: registered.defaultBaseUrl,
    fetchImpl: fetchWithRedirectValidation,
  });
  await callLLM(
    { model, prompt: 'Say "OK" if you can hear me.', maxOutputTokens: 64 },
    'verify-model',
    undefined,
    { mode: 'disabled', enabled: false },
  );
}

export async function PUT(request: NextRequest, { params }: Params) {
  return withRequestOwner(
    { headers: request.headers, method: request.method, url: request.url },
    async (principal) => {
      if (!requireAdmin(principal)) return apiError('FORBIDDEN', 403, 'Admin access required');
      if (!isSameOriginJsonRequest(request)) {
        return apiError('FORBIDDEN', 403, 'Account changes must be same-origin JSON requests');
      }

      const { id } = await params;
      const auth = await authDatabase();
      const target = await findAuthUserById(auth, id);
      if (!target) return apiError('INVALID_REQUEST', 404, 'Account not found');

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
      }
      const input = (body ?? {}) as { preset?: unknown; apiKey?: unknown; model?: unknown };
      if (!isOnboardingPreset(input.preset)) {
        return apiError(
          'INVALID_REQUEST',
          400,
          'preset must be one of google, openrouter, coarena, crowllm',
        );
      }
      const preset = onboardingProvider(input.preset)!;
      const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
      if (apiKey.length < 8 || apiKey.length > 512) {
        return apiError('INVALID_REQUEST', 400, 'apiKey must be between 8 and 512 characters');
      }
      const modelId =
        typeof input.model === 'string' && input.model.trim()
          ? input.model.trim()
          : preset.defaultModel;
      const catalogue = getProvider(preset.preset as ProviderId)?.models ?? [];
      if (!catalogue.some((entry) => entry.id === modelId)) {
        return apiError('INVALID_REQUEST', 400, 'model is not in the provider’s catalogue');
      }

      // 1. Prove the key works before persisting anything.
      try {
        await probeOnboardingKey(preset.preset, modelId, apiKey);
      } catch (error) {
        const status = upstreamHttpStatus(error);
        log.warn(
          `admin probed an API key and the provider refused [preset=${preset.preset} status=${status ?? 'n/a'}]`,
        );
        if (status === 401 || status === 403) {
          return apiError('INVALID_CREDENTIALS', 422, 'API key is invalid or expired');
        }
        if (status === 404) {
          return apiError('MISSING_MODEL', 422, 'Model not found or API endpoint error');
        }
        if (status === 429) {
          return apiError('RATE_LIMITED', 422, 'API rate limit exceeded, please try again later');
        }
        return apiError(
          'UPSTREAM_ERROR',
          422,
          'Cannot connect to the provider, please check the key and model',
        );
      }

      // 2. Persist the workspace provider, then the slot assignments.
      const queryable = await workspaceQueryable();
      const ownerId = `user:${target.id}`;
      const stored = await readWorkspaceModelConfig(queryable, ownerId);
      const revision = stored?.revision ?? null;
      let next;
      try {
        next = await applyModelSettingsChange(stored?.config ?? null, {
          kind: 'provider',
          id: preset.id,
          preset: preset.preset,
          apiKey,
        });
        const ref = `${preset.id}:${modelId}`;
        next = await applyModelSettingsChange(next, {
          kind: 'slots',
          set: { llm: ref, agent: ref },
        });
      } catch (error) {
        if (error instanceof ModelSettingsError) {
          if (error.code === 'PROVIDERS_NOT_ALLOWED') {
            return apiError('PROVIDER_DISABLED', 403, error.message);
          }
          return apiError('INVALID_REQUEST', 400, error.message);
        }
        throw error;
      }
      try {
        await saveWorkspaceModelConfig(queryable, ownerId, next, revision);
      } catch (error) {
        if (error instanceof WorkspaceConfigConflictError) {
          return NextResponse.json(
            {
              error: {
                code: 'CONFLICT',
                message: 'The settings changed; reload them and try again',
              },
            },
            { status: 409 },
          );
        }
        throw error;
      }

      // 3. Record the verification so the account passes the gate.
      await recordVerifiedApiKey(queryable, {
        ownerId,
        providerId: preset.id,
        apiKey,
        preset: preset.preset,
        modelId,
      });
      return apiSuccess({ ok: true, provider: preset.id, model: modelId });
    },
  );
}

export async function PATCH(request: NextRequest, { params }: Params) {
  return withRequestOwner(
    { headers: request.headers, method: request.method, url: request.url },
    async (principal) => {
      if (!requireAdmin(principal)) return apiError('FORBIDDEN', 403, 'Admin access required');
      if (!isSameOriginJsonRequest(request)) {
        return apiError('FORBIDDEN', 403, 'Account changes must be same-origin JSON requests');
      }

      const { id } = await params;
      const queryable = await authDatabase();
      const target = await findAuthUserById(queryable, id);
      if (!target) return apiError('INVALID_REQUEST', 404, 'Account not found');

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
      }
      const exempt = (body as { exempt?: unknown } | null)?.exempt;
      if (typeof exempt !== 'boolean') {
        return apiError('INVALID_REQUEST', 400, 'exempt must be a boolean');
      }
      const updated = await updateAuthUser(queryable, target.id, { apiKeyExempt: exempt });
      if (!updated) return apiError('INVALID_REQUEST', 404, 'Account not found');
      return apiSuccess({ user: updated });
    },
  );
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return withRequestOwner(
    { headers: request.headers, method: request.method, url: request.url },
    async (principal) => {
      if (!requireAdmin(principal)) return apiError('FORBIDDEN', 403, 'Admin access required');
      if (!isSameOriginJsonRequest(request)) {
        return apiError('FORBIDDEN', 403, 'Account changes must be same-origin JSON requests');
      }

      const { id } = await params;
      const auth = await authDatabase();
      const target = await findAuthUserById(auth, id);
      if (!target) return apiError('INVALID_REQUEST', 404, 'Account not found');

      const queryable = await workspaceQueryable();
      const ownerId = `user:${target.id}`;
      const stored = await readWorkspaceModelConfig(queryable, ownerId);
      let revoked = 0;
      if (stored) {
        // Only chat providers carry the gate; the rest (tts, image, …) stay.
        const chatIds = Object.entries(stored.config.providers ?? {})
          .filter(([, provider]) => provider.apiKey)
          .filter(([, provider]) => Boolean(getProviderPreset(provider.preset)?.capabilities.chat))
          .map(([providerId]) => providerId);
        let working = stored.config;
        for (const providerId of chatIds) {
          working = await applyModelSettingsChange(working, {
            kind: 'remove-provider',
            id: providerId,
          });
          revoked += 1;
        }
        if (chatIds.length) {
          try {
            await saveWorkspaceModelConfig(queryable, ownerId, working, stored.revision, {
              clearKeys: chatIds,
            });
          } catch (error) {
            if (error instanceof WorkspaceConfigConflictError) {
              return NextResponse.json(
                {
                  error: {
                    code: 'CONFLICT',
                    message: 'The settings changed; reload them and try again',
                  },
                },
                { status: 409 },
              );
            }
            throw error;
          }
        }
      }
      await deleteVerifiedApiKeys(queryable, ownerId);
      return apiSuccess({ revoked });
    },
  );
}
