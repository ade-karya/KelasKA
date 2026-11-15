import { NextRequest } from 'next/server';
import { resolveRequestOwner } from '@/lib/server/identity/resolve';
import {
  attachOwnerCookies,
  invalidOwnerCredentialResponse,
} from '@/lib/server/identity/with-owner';
import type { OwnerPrincipal } from '@/lib/server/identity/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { readWorkspaceModelConfig } from '@/lib/persistence/workspace-model-config';
import { recordVerifiedApiKey } from '@/lib/persistence/user-api-keys';
import {
  savedLanguageModel,
  savedProviderRef,
  savedProviderResponse,
} from '@/lib/server/model-config/saved-provider';
import { callLLM } from '@/lib/ai/llm';
import { upstreamHttpStatus } from '@/lib/server/llm-error-response';
const log = createLogger('Verify Model');

export async function POST(req: NextRequest) {
  const owner = await resolveRequestOwner(req);
  if (!owner.ok) return invalidOwnerCredentialResponse();
  return attachOwnerCookies(await verify(req, owner.principal), owner.setCookies);
}

async function verify(req: NextRequest, principal: OwnerPrincipal) {
  let model: string | undefined;
  try {
    const body = await req.json();
    const { apiKey, baseUrl, providerType } = body;
    model = body.model;

    if (typeof model !== 'string' || !model.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }
    const requestedModel = model;

    // The settings test a saved provider by its id (`provider`, with `model`
    // its model id): the server's configuration supplies key and endpoint.
    let languageModel;
    let savedRef: string | undefined;
    try {
      savedRef = savedProviderRef(body.provider, model);
      if (savedRef) languageModel = (await savedLanguageModel(req, savedRef)).model;
    } catch (error) {
      const refused = savedProviderResponse(error, 'language model');
      if (refused) return refused;
      return apiError(
        'INVALID_REQUEST',
        401,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (savedRef) {
      model = savedRef;
    } else {
      // Parse model string and resolve server-side fallback
      try {
        const result = await resolveModel({
          modelString: model,
          apiKey: apiKey || '',
          baseUrl: baseUrl || undefined,
          providerType,
        });
        languageModel = result.model;
      } catch (error) {
        const refused = savedProviderResponse(error, 'language model');
        if (refused) return refused;
        return apiError(
          'INVALID_REQUEST',
          401,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (!languageModel) return apiError('MISSING_MODEL', 400, 'Model name is required');

    // Send a minimal test message. Use the unified wrapper so compatible
    // providers can receive provider-specific request options.
    const { text } = await callLLM(
      {
        model: languageModel,
        prompt: 'Say "OK" if you can hear me.',
        maxOutputTokens: 64,
      },
      'verify-model',
      undefined,
      // Probe the exact model the user typed in — a fallback would report a
      // dead or mis-keyed model as healthy. The shared layer disables the
      // fallback for the 'verify-model' source automatically.
      { mode: 'disabled', enabled: false },
    );

    // The key this account just proved works is the one the onboarding gate
    // counts. Recorded only for a saved workspace provider (the browser never
    // holds the key again); failures here must not flip the answer the user
    // sees, the gate simply stays closed until a verification records.
    if (savedRef && principal.kind === 'user') {
      try {
        const colon = savedRef.indexOf(':');
        const providerId = colon === -1 ? savedRef : savedRef.slice(0, colon);
        const modelId = colon === -1 ? requestedModel : savedRef.slice(colon + 1);
        const databaseUrl = process.env.DATABASE_URL?.trim();
        if (databaseUrl) {
          const { pool } = await getServerPersistenceProvider(databaseUrl);
          const queryable = pool as unknown as import('@openmaic/storage/document/pg').Queryable;
          const stored = await readWorkspaceModelConfig(queryable, principal.ownerId);
          const provider = stored?.config.providers?.[providerId];
          if (provider?.apiKey) {
            await recordVerifiedApiKey(queryable, {
              ownerId: principal.ownerId,
              providerId,
              apiKey: provider.apiKey,
              preset: provider.preset,
              modelId,
            });
          }
        }
      } catch (error) {
        log.error('The verification could not be recorded for the onboarding gate:', error);
      }
    }

    return apiSuccess({
      message: 'Connection successful',
      response: text,
    });
  } catch (error) {
    log.error(`Model verification failed [model="${model ?? 'unknown'}"]:`, error);

    // Classify by the provider's HTTP status only. Error messages can carry the
    // provider's response body or transport detail, so they are logged above
    // and never returned.
    const status = upstreamHttpStatus(error);
    let errorMessage: string;
    if (status === 401 || status === 403) {
      errorMessage = 'API key is invalid or expired';
    } else if (status === 404) {
      errorMessage = 'Model not found or API endpoint error';
    } else if (status === 429) {
      errorMessage = 'API rate limit exceeded, please try again later';
    } else if (status !== undefined) {
      errorMessage = `API request failed (HTTP ${Math.floor(status / 100)}xx)`;
    } else {
      // Refused, unresolvable, timed-out, redirecting and policy-blocked
      // targets, and unreadable responses, all get the same answer.
      errorMessage = 'Cannot connect to API server, please check the Base URL';
    }

    return apiError('INTERNAL_ERROR', 500, errorMessage);
  }
}
