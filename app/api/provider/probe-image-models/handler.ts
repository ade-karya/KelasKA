import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateClientBaseUrl } from '@/lib/server/ssrf-guard';
import { ModelFetchError } from '@/lib/server/model-fetch';
import { fetchOpenRouterMediaModels } from '@/lib/server/openrouter-media-fetch';
import {
  savedMediaConnection,
  savedProviderRef,
  savedProviderResponse,
} from '@/lib/server/model-config/saved-provider';

const log = createLogger('ProbeImageModels');

/**
 * POST /api/provider/probe-image-models
 *
 * Discovers the FREE ($0) OpenRouter image models a base URL + key exposes.
 * Joins the dedicated image catalog (`GET {base}/images/models`,
 * `{ id, name }`) with the unified pricing source
 * (`GET {base}/models?output_modalities=image`) and keeps only entries whose
 * pricing proves $0 per https://openrouter.ai/docs/api_reference/overview →
 * list-models. Returns proper catalog `name`s so the settings panel never
 * shows a prettified id.
 *
 * Either `{ baseUrl, apiKey }` (an explicit endpoint) or `{ provider }` (one
 * of the workspace's own image services, whose stored endpoint and key are
 * used) is accepted.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }
  try {
    let { baseUrl, apiKey } = body as {
      baseUrl?: string;
      apiKey?: string;
    };
    // The settings name one of the workspace's own image services
    // (`provider`): its stored endpoint and key are used, nothing else.
    const saved = (body as { provider?: unknown }).provider;
    if (saved !== undefined) {
      try {
        const ref = savedProviderRef(saved);
        if (!ref) return apiError('MISSING_REQUIRED_FIELD', 400, 'provider is required');
        const connection = await savedMediaConnection(req, 'image', ref);
        baseUrl = connection.baseUrl ?? 'https://openrouter.ai/api/v1';
        apiKey = connection.apiKey;
      } catch (error) {
        const refused = savedProviderResponse(error, 'image model');
        if (refused) return refused;
        throw error;
      }
    }

    if (!baseUrl) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'baseUrl is required');
    }

    const baseUrlError = await validateClientBaseUrl(baseUrl);
    if (baseUrlError) return apiError('INVALID_REQUEST', 400, baseUrlError);

    const models = await fetchOpenRouterMediaModels('image', baseUrl, apiKey || '');

    return apiSuccess({
      models,
      total: models.length,
      filtered: 0,
    });
  } catch (error) {
    log.warn('Image model probe failed:', error);
    if (error instanceof ModelFetchError) {
      if (error.status >= 300 && error.status < 400) {
        return apiError('REDIRECT_NOT_ALLOWED', 403, 'Redirects are not allowed');
      }
      if (error.status === 401 || error.status === 403) {
        return apiError('INVALID_REQUEST', 401, 'API key is invalid or expired');
      }
      if (error.status === 404) {
        return apiError('INVALID_REQUEST', 404, 'This provider does not expose a model list');
      }
      if (error.status >= 200 && error.status < 300) {
        return apiError('UPSTREAM_ERROR', 502, 'The provider returned an invalid model list');
      }
      return apiError(
        'UPSTREAM_ERROR',
        502,
        `The provider rejected the model list request (HTTP ${Math.floor(error.status / 100)}xx)`,
      );
    }
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Cannot connect to the provider, please check the Base URL',
    );
  }
}
