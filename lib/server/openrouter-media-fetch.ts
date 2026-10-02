/**
 * OpenRouter image/video catalog fetching with $0-only filtering.
 *
 * Contracts (per https://openrouter.ai/docs/api_reference/overview):
 * - Image catalog: `GET {base}/images/models` → `{ data: [{ id, name }] }`
 *   (public on the official catalog, no auth required).
 * - Pricing source: `GET {base}/models?output_modalities=image&limit=1000`
 *   → `{ data: [{ id, name, pricing: { prompt, completion, image, ... } }] }`
 *   where every price is a decimal USD string ("0" = free). Joining the two
 *   avoids N+1 per-model `/endpoints` calls (57 image models → 2 requests).
 * - Video catalog: `GET {base}/videos/models` → `{ data: [{ id, name }] }`,
 *   pricing via `GET {base}/models?output_modalities=video&limit=1000`.
 *
 * Only entries whose pricing proves $0 are returned. Entries without pricing
 * (custom gateways, mocks) are kept so discovery still works off-catalog.
 */

import { appAttributionHeaders } from '@/lib/config/app-attribution';
import { createProviderFetch, isRejectedRedirectError } from '@/lib/server/provider-fetch';
import { isZeroCostPricing, ModelFetchError } from '@/lib/server/model-fetch';
import { openRouterBaseUrl } from '@/lib/media/adapters/openrouter-image-adapter';

export type OpenRouterMediaFetchTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const pinnedMediaFetch: OpenRouterMediaFetchTransport = createProviderFetch({
  allowLocalNetworks: undefined,
  rejectRedirects: true,
});

const FETCH_TIMEOUT_MS = 15_000;

function fetchTimeout(): DOMException {
  return new DOMException('Model discovery timed out', 'TimeoutError');
}

export interface OpenRouterMediaModel {
  id: string;
  name: string;
}

interface MediaCatalogResponse {
  data?: Array<{ id?: string; slug?: string; name?: string }>;
}

interface PricingCatalogResponse {
  data?: Array<{
    id?: string;
    name?: string;
    pricing?: Record<string, string | number | null | undefined>;
  }>;
}

async function getJson(
  fetchImpl: OpenRouterMediaFetchTransport,
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(fetchTimeout()), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...appAttributionHeaders(url),
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (isRejectedRedirectError(error)) {
        throw new ModelFetchError(302, 'Redirects are not allowed');
      }
      throw error;
    }
    if (res.status >= 300 && res.status < 400) {
      throw new ModelFetchError(res.status, 'Redirects are not allowed');
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new ModelFetchError(res.status, 'The model list response is not valid JSON');
      }
    }
    if (res.status === 404 || res.status === 405) {
      throw new ModelFetchError(404, `No /${url.includes('/videos/') ? 'videos' : 'images'}/models endpoint found`);
    }
    throw new ModelFetchError(res.status, `HTTP ${res.status}`);
  } catch (error) {
    if (error instanceof ModelFetchError) throw error;
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Fetches the free ($0) OpenRouter image or video models.
 * Returns `{ id, name }` sorted by name (proper catalog `name`, never a
 * prettified id). Throws {@link ModelFetchError} on transport/HTTP failure.
 */
export async function fetchOpenRouterMediaModels(
  kind: 'image' | 'video',
  baseUrl: string,
  apiKey: string,
  opts: { fetchImpl?: OpenRouterMediaFetchTransport } = {},
): Promise<OpenRouterMediaModel[]> {
  const fetchImpl = opts.fetchImpl ?? pinnedMediaFetch;
  const root = openRouterBaseUrl(baseUrl || 'https://openrouter.ai/api/v1');

  const catalogBody = (await getJson(
    fetchImpl,
    `${root}/${kind}s/models`,
    apiKey,
    FETCH_TIMEOUT_MS,
  )) as MediaCatalogResponse;
  const catalog = (catalogBody?.data ?? [])
    .map((m) => ({ id: (m.id || m.slug || '').trim(), name: (m.name || '').trim() }))
    .filter((m) => m.id);
  if (catalog.length === 0) return [];

  // Pricing map from the unified list-models endpoint. A 404/405 (custom
  // gateway without it) falls back to the raw catalog with no $0 filter.
  let pricingById = new Map<string, Record<string, string | number | null | undefined>>();
  let pricingNameById = new Map<string, string>();
  try {
    const pricingBody = (await getJson(
      fetchImpl,
      `${root}/models?output_modalities=${kind}&limit=1000`,
      apiKey,
      FETCH_TIMEOUT_MS,
    )) as PricingCatalogResponse;
    for (const m of pricingBody?.data ?? []) {
      const id = (m.id || '').trim();
      if (!id) continue;
      if (m.pricing) pricingById.set(id, m.pricing);
      if (m.name?.trim()) pricingNameById.set(id, m.name.trim());
    }
  } catch (error) {
    if (error instanceof ModelFetchError && error.status === 404) {
      return catalog
        .map((m) => ({ id: m.id, name: m.name || m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    throw error;
  }

  // No pricing data at all (custom gateway shape) → keep the catalog as-is.
  if (pricingById.size === 0) {
    return catalog
      .map((m) => ({ id: m.id, name: m.name || m.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return catalog
    .filter((m) => {
      const pricing = pricingById.get(m.id);
      // Unknown pricing → keep (lenient for custom gateways); known pricing
      // must prove $0.
      if (!pricing) return true;
      return isZeroCostPricing(pricing);
    })
    .map((m) => ({ id: m.id, name: pricingNameById.get(m.id) || m.name || m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
