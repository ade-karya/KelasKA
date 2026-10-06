import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateClientBaseUrl, validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { fetchModels, isZeroCostPricing, ModelFetchError } from '@/lib/server/model-fetch';
import {
  savedChatEndpoint,
  savedProviderRef,
  savedProviderResponse,
} from '@/lib/server/model-config/saved-provider';
import { requestProvidersAllowed } from '@/lib/server/model-config/runtime';
import { REQUEST_PROVIDERS_REFUSED } from '@/lib/server/resolve-model';

const log = createLogger('ProbeModels');

/** Model ids that are not chat models — filtered out of probe results. */
const NON_CHAT_PATTERN =
  /(tts|asr|whisper|embedding|rerank|mineru|image|video|voxcpm|moderation|live|transcribe|audio|aqa|imagen)/i;

/**
 * Gemini-only non-text families. Verified against a live `GET /v1beta/models`
 * response: every one of these advertises `generateContent`, so the methods
 * filter in `fetchModels` cannot catch them. Kept Gemini-scoped (not merged
 * into {@link NON_CHAT_PATTERN}) so other providers' models with overlapping
 * substrings (e.g. Xiaomi `mimo-v2-omni`) are unaffected.
 */
const GEMINI_NON_TEXT_PATTERN =
  /(banana|omni|lyria|robotics|computer-use|antigravity|deep-research)/i;

/**
 * Whether a probe target is OpenRouter's catalog. Free-only filtering applies
 * to the official catalog (`openrouter.ai`) or an explicit `openrouter`
 * provider id — custom gateways without pricing keep the generic behavior.
 */
function isOpenRouterTarget(baseUrl: string, providerId?: string, modelsUrl?: string): boolean {
  if (providerId === 'openrouter') return true;
  const haystack = `${baseUrl} ${modelsUrl ?? ''}`.toLowerCase();
  return haystack.includes('openrouter.ai');
}

/**
 * POST /api/provider/probe-models
 *
 * Discovers the chat models a base URL + key exposes. OpenAI-compatible
 * providers use the `/models` endpoint (with multi-candidate fallback);
 * Gemini (`providerType: 'google'` or a `generativelanguage` base URL) uses
 * the native `GET {base}/models` contract (`x-goog-api-key` / `?key=`).
 * OpenRouter targets return FREE models only (`pricing` all $0 per
 * https://openrouter.ai/docs/api_reference/overview → list-models) with
 * proper catalog `name`s as display names.
 * Returns the lit-up list, or a typed status so the UI can fall back to
 * manual model entry.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }
  try {
    let { baseUrl, apiKey, modelsUrl, providerType, providerId } = body as {
      baseUrl?: string;
      apiKey?: string;
      modelsUrl?: string;
      providerType?: string;
      providerId?: string;
    };
    // The settings name one of the workspace's own providers (`provider`):
    // its stored endpoint and key are used, and nothing else from the request.
    const saved = (body as { provider?: unknown }).provider;
    if (saved !== undefined) {
      try {
        const ref = savedProviderRef(saved);
        if (!ref) return apiError('MISSING_REQUIRED_FIELD', 400, 'provider is required');
        ({ baseUrl, apiKey } = await savedChatEndpoint(req, ref));
        modelsUrl = undefined;
      } catch (error) {
        const refused = savedProviderResponse(error, 'language model');
        if (refused) return refused;
        throw error;
      }
    } else if (!requestProvidersAllowed()) {
      // A raw endpoint and key: not under `allowUserKeys: false`.
      return apiError('PROVIDER_DISABLED', 403, REQUEST_PROVIDERS_REFUSED);
    }

    if (!baseUrl) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'baseUrl is required');
    }

    // SSRF guard on both the base URL and an explicit models URL override
    // (a complete URL, so only the base URL is held to the base-URL shape).
    const baseUrlError = await validateClientBaseUrl(baseUrl);
    if (baseUrlError) return apiError('INVALID_REQUEST', 400, baseUrlError);
    if (modelsUrl) {
      const ssrfError = await validateUrlForSSRF(modelsUrl);
      if (ssrfError) return apiError('INVALID_REQUEST', 400, ssrfError);
    }

    const models = await fetchModels(baseUrl, apiKey || '', {
      modelsUrlOverride: modelsUrl,
      providerType,
    });
    // Text-generation models only. The shared pattern applies to every
    // provider; the Gemini families apply to Gemini targets only.
    const isGemini =
      providerType === 'google' ||
      baseUrl.toLowerCase().includes('generativelanguage.googleapis.com');
    // OpenRouter: free ($0) text models only. `pricing` comes from
    // GET /models (all cost keys "0" for free entries, including `:free`
    // variants). Entries without pricing (custom gateways, test doubles)
    // are kept so discovery still works off-catalog.
    const isOpenRouter = isOpenRouterTarget(baseUrl, providerId, modelsUrl);
    const chatModels = models.filter((m) => {
      if (NON_CHAT_PATTERN.test(m.id)) return false;
      if (isGemini && GEMINI_NON_TEXT_PATTERN.test(m.id)) return false;
      if (isOpenRouter) {
        // Non-text outputs (e.g. Lyria audio `["text","audio"]`) are not chat
        // models even when $0 — keep text-only entries.
        if (m.outputModalities && !m.outputModalities.every((mod) => mod === 'text')) {
          return false;
        }
        if (m.pricing && !isZeroCostPricing(m.pricing)) return false;
      }
      return true;
    });

    return apiSuccess({
      models: chatModels.map((m) => ({
        id: m.id,
        ownedBy: m.ownedBy,
        displayName: m.displayName,
        ...(typeof m.contextLength === 'number' ? { contextLength: m.contextLength } : {}),
      })),
      total: models.length,
      filtered: models.length - chatModels.length,
    });
  } catch (error) {
    // Only fixed messages reach the caller: the provider's body, parser output
    // and transport errors are logged server-side.
    log.warn('Model probe failed:', error);
    if (error instanceof ModelFetchError) {
      if (error.status >= 300 && error.status < 400) {
        return apiError('REDIRECT_NOT_ALLOWED', 403, 'Redirects are not allowed');
      }
      if (error.status === 401 || error.status === 403) {
        return apiError('INVALID_REQUEST', 401, 'API key is invalid or expired');
      }
      if (error.status === 404) {
        // No /models endpoint — signal the UI (via 404) to use manual model entry.
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
    // Refused, unresolvable, timed-out and policy-blocked targets all get the
    // same answer.
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Cannot connect to the provider, please check the Base URL',
    );
  }
}
