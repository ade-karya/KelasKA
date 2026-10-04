/**
 * Model-list fetching for OpenAI-compatible providers, plus native Gemini
 * discovery.
 *
 * Ported from cc-switch `src-tauri/src/services/model_fetch.rs`. The core value
 * is `buildModelsUrlCandidates`: token-plan / aggregator base URLs come in many
 * shapes, so we generate an ordered candidate list (with an Anthropic-compat
 * suffix-strip fallback) and try each until one returns a model list.
 *
 * Gemini contract (per https://ai.google.dev/gemini-api/docs/text-generation,
 * https://ai.google.dev/gemini-api/docs/openai and
 * https://ai.google.dev/api/models):
 * - Native list: `GET {base}/models` (e.g.
 *   `https://generativelanguage.googleapis.com/v1beta/models`), auth via
 *   `x-goog-api-key` header or `?key=` query, schema
 *   `{ models: [{ name: "models/..." }] }`, paged via `pageSize`/`pageToken` →
 *   `nextPageToken`. Text-generation models are those whose
 *   `supportedGenerationMethods` includes `generateContent`.
 * - OpenAI-compat list: `GET {base}/openai/models` (base
 *   `.../v1beta/openai/`), auth via `Authorization: Bearer`, schema
 *   `{ data: [{ id }] }`.
 */

import { appAttributionHeaders } from '@/lib/config/app-attribution';
import { createProviderFetch, isRejectedRedirectError } from '@/lib/server/provider-fetch';

/** The `fetch`-shaped transport one candidate request is issued with. */
export type ModelFetchTransport = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Default transport: the strict provider fetch under the operator address
 * policy (the one the probe route validated the URL against:
 * `allowLocalNetworks` unset falls back to ALLOW_LOCAL_NETWORKS). The connect
 * address is pinned to the vetted DNS answers and a 3xx is refused.
 */
const pinnedModelsFetch: ModelFetchTransport = createProviderFetch({
  allowLocalNetworks: undefined,
  rejectRedirects: true,
});

/** A model id discovered from a provider's /models endpoint. */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
  /** Human-readable label from the provider (native Gemini `displayName`, OpenRouter `name`). */
  displayName?: string;
  /**
   * Raw OpenRouter `pricing` object (`{ prompt, completion, request, ... }`
   * as decimal USD strings per https://openrouter.ai/docs/api_reference/overview
   * → list-models). Present only when the upstream returns it; used by the
   * probe route to keep $0/free models. Never surfaced to the client verbatim.
   */
  pricing?: Record<string, string | number | null | undefined>;
  /** OpenRouter `context_length` in tokens, when provided. */
  contextLength?: number;
  /** OpenRouter `architecture.output_modalities` (e.g. `["text"]`), when provided. */
  outputModalities?: string[];
}

/**
 * Whether this discovery targets Google's Generative Language API (native
 * Gemini protocol). Triggered by an explicit `providerType: 'google'` or by
 * the well-known `generativelanguage.googleapis.com` host. Gemini's native
 * list endpoint (`GET {base}/models`) uses `x-goog-api-key` / `?key=` auth
 * and a `{ models: [{ name: "models/..." }] }` schema — not the
 * OpenAI-compatible `Bearer` + `{ data: [{ id }] }` contract.
 */
export function isGeminiTarget(baseUrl: string, providerType?: string): boolean {
  if (providerType === 'google') return true;
  return baseUrl.toLowerCase().includes('generativelanguage.googleapis.com');
}

function isGeminiCandidate(url: string, providerType?: string): boolean {
  if (providerType === 'google') return true;
  return url.toLowerCase().includes('generativelanguage.googleapis.com');
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
 * 2. Gemini native (`providerType: 'google'` or a
 *    `generativelanguage.googleapis.com` base): `{base}/models` then
 *    `{base}/openai/models` (or the mirrored pair when the base already ends
 *    in `/openai`). The default Gemini base (`.../v1beta`) is NOT an
 *    OpenAI-style `/v{N}` version segment, so without this branch the generic
 *    rule below would probe the non-existent `.../v1beta/v1/models`.
 * 3. `{base}/v1/models`; or `{base}/models` when base ends in a version segment
 *    (`/v1`, `.../paas/v4`), plus `{base}/v1/models` fallback when that segment
 *    is not `/v1`
 * 4. If base hits a known Anthropic-compat suffix, the stripped root +
 *    `/v1/models` and `/models`
 *
 * Deduped, order-preserving. Throws on an empty base URL.
 */
export function buildModelsUrlCandidates(
  baseUrl: string,
  opts: { modelsUrlOverride?: string; providerType?: string } = {},
): string[] {
  const override = opts.modelsUrlOverride?.trim();
  if (override) return [override];

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL is empty');

  if (isGeminiTarget(trimmed, opts.providerType)) {
    const withoutOpenai = trimmed.replace(/\/openai$/, '');
    const isOpenaiCompatBase = /\/openai$/.test(trimmed);
    const candidates = isOpenaiCompatBase
      ? [`${trimmed}/models`, `${withoutOpenai}/models`]
      : [`${trimmed}/models`, `${trimmed}/openai/models`];
    return candidates.filter((url, i) => candidates.indexOf(url) === i);
  }

  const candidates: string[] = [];

  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith('/v1')) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else {
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
  data?: Array<{
    id: string;
    owned_by?: string;
    display_name?: string;
    // OpenRouter catalog shape per
    // https://openrouter.ai/docs/api_reference/overview (list-models):
    // `{ id, name, pricing: { prompt, completion, ... }, context_length,
    // architecture: { output_modalities } }`. `name` is the human label
    // ("Qwen: Qwen3.8 27B (free)") while `display_name` stays the
    // OpenAI-compatible label. Both are accepted; `display_name` wins.
    name?: string;
    pricing?: Record<string, string | number | null | undefined>;
    context_length?: number;
    architecture?: { output_modalities?: string[] };
  }>;
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
}

/**
 * Whether an OpenRouter `pricing` object means $0 (free).
 * Per the list-models schema every price is a decimal USD string ("0" for
 * free). `discount`/`overrides` are not costs and are ignored. Missing pricing
 * (custom gateways, mocks) returns true so non-OpenRouter shapes keep working.
 */
export function isZeroCostPricing(
  pricing?: Record<string, string | number | null | undefined> | null,
): boolean {
  if (!pricing) return true;
  const entries = Object.entries(pricing).filter(([k]) => k !== 'discount' && k !== 'overrides');
  if (entries.length === 0) return true;
  return entries.every(([, v]) => {
    if (v === null || v === undefined || v === '') return true;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) && n === 0;
  });
}

/** Max Gemini list pages followed per candidate (pageSize=100 → ample). */
const GEMINI_MAX_PAGES = 5;

/**
 * Numeric version embedded in a `gemini-*` model id (`3.8` for
 * `gemini-3.8-flash`, `3.0` for `gemini-3-flash-preview`). Non-Gemini ids
 * (Gemma, `*-latest` aliases) return null and sort after versioned models.
 */
function geminiVersion(id: string): [number, number] | null {
  if (!id.startsWith('gemini-')) return null;
  const dotted = id.match(/(\d+)\.(\d+)/);
  if (dotted) return [Number(dotted[1]), Number(dotted[2])];
  const major = id.match(/(\d+)/);
  if (major) return [Number(major[1]), 0];
  return null;
}

/** Newest Gemini version first; ties and versionless ids fall back to id order. */
function compareGeminiNewestFirst(a: FetchedModel, b: FetchedModel): number {
  const va = geminiVersion(a.id);
  const vb = geminiVersion(b.id);
  if (va && vb) {
    if (va[0] !== vb[0]) return vb[0] - va[0];
    if (va[1] !== vb[1]) return vb[1] - va[1];
    return a.id.localeCompare(b.id);
  }
  if (va) return -1;
  if (vb) return 1;
  return a.id.localeCompare(b.id);
}

/**
 * Fetches the model list by trying each candidate URL in order. A 404/405 means
 * "wrong path" and moves on to the next candidate; any other non-2xx is returned
 * as a {@link ModelFetchError} immediately (e.g. 401 = bad key), carrying the
 * status but never the provider's body.
 *
 * Gemini targets (`providerType: 'google'` or a `generativelanguage` base URL)
 * are fetched with the native auth contract (`x-goog-api-key` + `?key=`) and
 * both response schemas (`{ data }` for the OpenAI-compat endpoint and
 * `{ models: [{ name: "models/..." }] }` for the native endpoint) are
 * accepted. A native Gemini 400 means "API key not valid" and is surfaced as
 * a 401 so the caller maps it to the auth-error contract.
 *
 * Throws on network failure or when all candidates 404. The caller (probe route)
 * is responsible for SSRF validation of `baseUrl` before calling this.
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  opts: { modelsUrlOverride?: string; fetchImpl?: ModelFetchTransport; providerType?: string } = {},
): Promise<FetchedModel[]> {
  const candidates = buildModelsUrlCandidates(baseUrl, opts);
  const fetchImpl = opts.fetchImpl ?? pinnedModelsFetch;
  const providerType = opts.providerType;

  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  let retried = false;

  for (const url of candidates) {
    const gemini = isGeminiCandidate(opts.modelsUrlOverride?.trim() || url, providerType);
    let body: ModelsApiResponse | null;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw discoveryTimeout();
      try {
        body = await fetchModelsCandidate(
          fetchImpl,
          url,
          apiKey,
          Math.min(FETCH_TIMEOUT_MS, remaining),
          gemini,
          deadline,
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
    // Native Gemini payloads are normalized to `data` inside the candidate
    // fetch, so every success shape converges here. Gemini lists newest
    // version first (the fetch button shows latest models on top); every
    // other provider keeps id order.
    // OpenRouter note: the catalog's human label lives in `name`
    // (e.g. "Qwen: Qwen3.8 27B (free)"), not `display_name`. Accept both so
    // the settings panel shows the proper name instead of a prettified id.
    const found: FetchedModel[] = (body.data ?? []).map((m) => {
      const rawDisplay = m.display_name?.trim() || m.name?.trim() || undefined;
      const displayName = rawDisplay && rawDisplay !== m.id ? rawDisplay : rawDisplay || undefined;
      const entry: FetchedModel = {
        id: m.id,
        ownedBy: m.owned_by,
        displayName,
      };
      if (m.pricing) entry.pricing = m.pricing;
      if (typeof m.context_length === 'number' && Number.isFinite(m.context_length)) {
        entry.contextLength = m.context_length;
      }
      if (Array.isArray(m.architecture?.output_modalities)) {
        entry.outputModalities = m.architecture.output_modalities;
      }
      return entry;
    });
    return gemini ? found.sort(compareGeminiNewestFirst) : found.sort((a, b) => a.id.localeCompare(b.id));
  }

  throw new ModelFetchError(404, `No /models endpoint found (tried: ${candidates.join(', ')})`);
}

/**
 * The timer owns the entire finite response, including the JSON read. Errors
 * carry the status only: the provider's body is never read on failure, so it
 * cannot reach the caller. The API key is appended as `?key=` only at request
 * time — it never enters the candidate list or error messages.
 */
async function fetchModelsCandidate(
  fetchImpl: ModelFetchTransport,
  url: string,
  apiKey: string,
  timeoutMs: number,
  isGemini = false,
  deadline: number = Date.now() + DISCOVERY_TIMEOUT_MS,
): Promise<ModelsApiResponse | null> {
  if (!isGemini) {
    return fetchOpenAIModelsCandidate(fetchImpl, url, apiKey, timeoutMs);
  }
  return fetchGeminiModelsCandidate(fetchImpl, url, apiKey, timeoutMs, deadline);
}

/** OpenAI-compatible `{ data: [{ id }] }` candidate fetch. */
async function fetchOpenAIModelsCandidate(
  fetchImpl: ModelFetchTransport,
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<ModelsApiResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(discoveryTimeout()), timeoutMs);
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
      // The strict transport refuses a 3xx instead of returning it; the hop's
      // status is not reported, so any 3xx code maps to the same contract.
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
        return (await res.json()) as ModelsApiResponse;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // A SyntaxError quotes a snippet of the body; report the status only.
        throw new ModelFetchError(res.status, 'The model list response is not valid JSON');
      }
    }
    if (res.status === 404 || res.status === 405) return null;
    throw new ModelFetchError(res.status, `HTTP ${res.status}`);
  } catch (error) {
    if (error instanceof ModelFetchError) throw error;
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    // Release unread redirect/error bodies before trying another endpoint.
    controller.abort();
  }
}

/**
 * Gemini candidate fetch. Follows the official contracts:
 * - Native (`{base}/models`): `x-goog-api-key` header and/or `?key=` query
 *   (both documented — header in text-generation, query in models.list),
 *   paged with `pageSize`/`pageToken`. Accepts the native schema
 *   (`{ models: [{ name: "models/x", supportedGenerationMethods }] }`):
 *   `models/` prefix stripped, non-`generateContent` entries (embedding,
 *   `generateAnswer`, `predict`) dropped, pages followed via `nextPageToken`.
 * - OpenAI-compat (`.../openai/models`): `Authorization: Bearer` only, schema
 *   `{ data: [{ id }] }`, no pagination params.
 */
async function fetchGeminiModelsCandidate(
  fetchImpl: ModelFetchTransport,
  url: string,
  apiKey: string,
  timeoutMs: number,
  deadline: number,
): Promise<ModelsApiResponse | null> {
  const accumulated: Array<{ id: string; displayName?: string }> = [];
  let pageToken: string | undefined;
  const isOpenaiCompat = url.endsWith('/openai/models');
  // Per-endpoint auth, exactly as documented: native uses x-goog-api-key /
  // ?key=, OpenAI-compat uses Bearer.
  const headers: Record<string, string> = {
    ...(apiKey
      ? isOpenaiCompat
        ? { Authorization: `Bearer ${apiKey}` }
        : { 'x-goog-api-key': apiKey }
      : {}),
    ...appAttributionHeaders(url),
  };

  for (let page = 0; page < GEMINI_MAX_PAGES; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw discoveryTimeout();
    const pageTimeout = Math.min(FETCH_TIMEOUT_MS, remaining, timeoutMs);
    let pageUrl = url;
    if (!isOpenaiCompat) {
      const separator = pageUrl.includes('?') ? '&' : '?';
      if (apiKey) pageUrl += `${separator}key=${encodeURIComponent(apiKey)}`;
      pageUrl += `${pageUrl.includes('?') ? '&' : '?'}pageSize=100`;
      if (pageToken) pageUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(discoveryTimeout()), pageTimeout);
    try {
      let res: Response;
      try {
        res = await fetchImpl(pageUrl, {
          method: 'GET',
          headers,
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
      if (!res.ok) {
        // Native Gemini reports an invalid key as 400 ("API key not valid").
        if (res.status === 400) {
          throw new ModelFetchError(401, 'API key is invalid or expired');
        }
        if ((res.status === 404 || res.status === 405) && page === 0) return null;
        throw new ModelFetchError(res.status, `HTTP ${res.status}`);
      }
      let body: ModelsApiResponse;
      try {
        body = (await res.json()) as ModelsApiResponse;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new ModelFetchError(res.status, 'The model list response is not valid JSON');
      }
      if (Array.isArray(body.data)) return body;
      for (const m of body.models ?? []) {
        const raw = m.name?.trim();
        if (!raw) continue;
        const id = raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
        if (!id) continue;
        // Keep only text-generation models; embedding (`embedContent`),
        // attributed QA (`generateAnswer`) and image (`predict`) entries have
        // no `generateContent` method. Entries without the field (older API
        // shapes) are kept and filtered downstream by the chat-model pattern.
        if (
          m.supportedGenerationMethods &&
          !m.supportedGenerationMethods.includes('generateContent')
        ) {
          continue;
        }
        if (!accumulated.some((a) => a.id === id)) {
          const displayName = m.displayName?.trim() || undefined;
          accumulated.push(displayName ? { id, displayName } : { id });
        }
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    } catch (error) {
      if (error instanceof ModelFetchError) throw error;
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  return { data: accumulated.map((a) => ({ id: a.id, display_name: a.displayName })) };
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
