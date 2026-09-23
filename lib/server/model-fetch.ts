/**
 * Model-list fetching for LLM providers.
 *
 * Ported from cc-switch `src-tauri/src/services/model_fetch.rs`. The core value
 * is `buildModelsUrlCandidates`: token-plan / aggregator base URLs come in many
 * shapes, so we generate an ordered candidate list (with an Anthropic-compat
 * suffix-strip fallback) and try each until one returns a model list.
 *
 * Two dialects are understood:
 * - OpenAI-compatible `/models`: `Authorization: Bearer`, `{ data: [{ id }] }`.
 * - Google Generative Language ListModels (`providerType: 'google'`):
 *   `x-goog-api-key`, `{ models: [{ name: 'models/<id>' }] }`.
 */

/** A model id discovered from a provider's model-list endpoint. */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
}

/** Options shared by {@link buildModelsUrlCandidates} and {@link fetchModels}. */
export interface ModelFetchOptions {
  /** Explicit `/models` URL that replaces every derived candidate. */
  modelsUrlOverride?: string;
  /**
   * Provider protocol. `'google'` switches URL construction, auth header and
   * response parsing to the Generative Language ListModels dialect; every
   * other value (including undefined) keeps the OpenAI-compatible contract.
   */
  providerType?: string;
}

function isGoogleProviderType(providerType?: string): boolean {
  return providerType === 'google';
}

/**
 * Known "Anthropic-compatible subpath" suffixes. When a base URL ends with one
 * of these, candidates also include the suffix-stripped root + /v1/models and
 * /models. Ordered longest-first so `/api/anthropic` wins over `/anthropic`.
 */
const KNOWN_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
] as const;

const FETCH_TIMEOUT_MS = 15_000;
// Preserve the existing per-attempt allowance, with one retry and a finite
// budget shared by every candidate and attempt in a discovery operation.
const DISCOVERY_TIMEOUT_MS = 2 * FETCH_TIMEOUT_MS;

function discoveryTimeout(): DOMException {
  return new DOMException('Model discovery timed out', 'TimeoutError');
}

/** Whether the URL's last path segment is an OpenAI-style version segment `/v{N}`. */
function endsWithVersionSegment(url: string): boolean {
  const last = url.split('/').pop() ?? '';
  if (!last.startsWith('v')) return false;
  const digits = last.slice(1);
  return digits.length > 0 && /^\d+$/.test(digits);
}

/** Whether the URL's last path segment is a Google version segment (`v1beta`, `v1alpha1`, ...). */
function isGoogleVersionSegment(url: string): boolean {
  const last = url.split('/').pop() ?? '';
  return /^v\d+(?:(?:alpha|beta)\d*)?$/.test(last);
}

/** If the URL ends with a known compat suffix, returns the stripped remainder. */
function stripCompatSuffix(baseUrl: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length);
    }
  }
  return null;
}

/**
 * Builds the ordered list of candidate `/models` URLs for a base URL.
 *
 * Order:
 * 1. `modelsUrlOverride` (if provided) — sole candidate
 * 2. Google (`providerType: 'google'`) — `{base}/models` for a versioned base
 *    (`.../v1beta`), or `{base}/v1beta/models` then `{base}/models` otherwise
 * 3. `{base}/v1/models`; or `{base}/models` when base ends in a version segment
 *    (`/v1`, `.../paas/v4`), plus `{base}/v1/models` fallback when that segment
 *    is not `/v1`
 * 4. If base hits a known Anthropic-compat suffix, the stripped root +
 *    `/v1/models` and `/models`
 *
 * Deduped, order-preserving. Throws on an empty base URL.
 */
export function buildModelsUrlCandidates(baseUrl: string, opts: ModelFetchOptions = {}): string[] {
  const override = opts.modelsUrlOverride?.trim();
  if (override) return [override];

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL is empty');

  const candidates: string[] = [];

  if (isGoogleProviderType(opts.providerType)) {
    if (isGoogleVersionSegment(trimmed)) {
      candidates.push(`${trimmed}/models`);
    } else {
      candidates.push(`${trimmed}/v1beta/models`);
      candidates.push(`${trimmed}/models`);
    }
  }

  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith('/v1')) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else if (!isGoogleProviderType(opts.providerType)) {
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/, '');
    if (root && root.includes('://')) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }

  // Linear dedupe preserving first occurrence (≤4 candidates).
  return candidates.filter((url, i) => candidates.indexOf(url) === i);
}

interface ModelsApiResponse {
  data?: Array<{ id: string; owned_by?: string }>;
  /** Google Generative Language ListModels envelope. */
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
}

/**
 * Normalize either dialect's payload into {@link FetchedModel}s.
 *
 * Google entries keep only models that can serve chat (`generateContent`) —
 * `embedContent` / `predictLongRunning` models (embeddings, Imagen, Veo) are
 * not selectable chat models — and lose the `models/` name prefix.
 */
function normalizeModelsResponse(body: ModelsApiResponse): FetchedModel[] {
  if (Array.isArray(body.data)) {
    return body.data.map((m) => ({ id: m.id, ownedBy: m.owned_by }));
  }
  if (Array.isArray(body.models)) {
    const normalized: FetchedModel[] = [];
    for (const model of body.models) {
      const name = typeof model?.name === 'string' ? model.name : '';
      if (!name) continue;
      if (
        Array.isArray(model.supportedGenerationMethods) &&
        !model.supportedGenerationMethods.includes('generateContent')
      ) {
        continue;
      }
      normalized.push({ id: name.replace(/^models\//, '') });
    }
    return normalized;
  }
  return [];
}

/** Auth headers per dialect: Google reads `x-goog-api-key`, OpenAI-compat reads Bearer. */
function authHeaders(apiKey: string, providerType?: string): Record<string, string> {
  if (!apiKey) return {};
  return isGoogleProviderType(providerType)
    ? { 'x-goog-api-key': apiKey }
    : { Authorization: `Bearer ${apiKey}` };
}

/**
 * Fetches the model list by trying each candidate URL in order. A 404/405 means
 * "wrong path" and moves on to the next candidate; any other non-2xx is returned
 * as an error immediately (e.g. 401 = bad key, surfaced to the caller verbatim).
 *
 * Throws on network failure or when all candidates 404. The caller (probe route)
 * is responsible for SSRF validation of `baseUrl` before calling this.
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  opts: ModelFetchOptions = {},
): Promise<FetchedModel[]> {
  const candidates = buildModelsUrlCandidates(baseUrl, opts);

  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  let retried = false;

  for (const url of candidates) {
    let body: ModelsApiResponse | null;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw discoveryTimeout();
      try {
        body = await fetchModelsCandidate(
          url,
          apiKey,
          Math.min(FETCH_TIMEOUT_MS, remaining),
          opts.providerType,
        );
        break;
      } catch (error) {
        // HTTP errors and malformed JSON are terminal. Only a transport failure
        // or our deadline gets one retry, shared across all candidate URLs.
        if (
          retried ||
          Date.now() >= deadline ||
          !(
            error instanceof TypeError ||
            (error instanceof DOMException && error.name === 'TimeoutError')
          )
        ) {
          throw error;
        }
        retried = true;
      }
    }
    if (body === null) continue;
    return normalizeModelsResponse(body).sort((a, b) => a.id.localeCompare(b.id));
  }

  throw new ModelFetchError(404, `No /models endpoint found (tried: ${candidates.join(', ')})`);
}

/** The timer owns the entire finite response, including JSON/error-body reads. */
async function fetchModelsCandidate(
  url: string,
  apiKey: string,
  timeoutMs: number,
  providerType?: string,
): Promise<ModelsApiResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(discoveryTimeout()), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(apiKey, providerType),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new ModelFetchError(res.status, 'Redirects are not allowed');
    }
    if (res.ok) return (await res.json()) as ModelsApiResponse;
    if (res.status === 404 || res.status === 405) return null;

    // A stalled error body must not hide an already-known authentication/HTTP
    // status, or turn a terminal HTTP error into a retryable timeout.
    const text = await res.text().catch(() => '');
    // Google reports an invalid key as 400/INVALID_ARGUMENT, not 401; surface
    // it as the auth status the caller's contract already maps so the UI shows
    // "API key is invalid or expired" instead of a raw HTTP dump.
    if (res.status === 400 && isGoogleProviderType(providerType) && /api[_ -]?key/i.test(text)) {
      throw new ModelFetchError(401, `HTTP ${res.status}: ${text.slice(0, 512)}`);
    }
    throw new ModelFetchError(res.status, `HTTP ${res.status}: ${text.slice(0, 512)}`);
  } catch (error) {
    if (error instanceof ModelFetchError) throw error;
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    // Release unread redirect/404/405 bodies before trying another endpoint.
    controller.abort();
  }
}

/** Error carrying the upstream HTTP status so the route can map it (401 vs 404). */
export class ModelFetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ModelFetchError';
  }
}
