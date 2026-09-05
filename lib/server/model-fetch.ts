/**
 * Model-list fetching for OpenAI-compatible providers + Google Gemini.
 *
 * Ported from cc-switch `src-tauri/src/services/model_fetch.rs`. The core value
 * is `buildModelsUrlCandidates`: token-plan / aggregator base URLs come in many
 * shapes, so we generate an ordered candidate list (with an Anthropic-compat
 * suffix-strip fallback) and try each until one returns a model list.
 *
 * Gemini-native path (`GET /v1beta/models`, https://ai.google.dev/api/models):
 * the OpenAI-compatible `{base}/v1/models` + `Bearer` shape does NOT apply —
 * Gemini's default base URL already ends in `/v1beta`, authentication is
 * `?key=` / `x-goog-api-key`, and the payload is `{ models: [...] }` with a
 * `thinking` boolean per model plus pagination via `nextPageToken`.
 */

import { fetchWithTimeout } from './fetch-with-timeout';

/** A model id discovered from a provider's /models endpoint. */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
  /** Gemini `displayName` (e.g. "Gemini 2.5 Flash"). Absent for OpenAI-compatible probes. */
  displayName?: string;
  /**
   * Gemini `thinking` flag — whether the model supports thinking
   * (https://ai.google.dev/api/models#Model). Absent for OpenAI-compatible probes.
   */
  thinking?: boolean;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  /**
   * OpenRouter per-model reasoning descriptor (`GET /api/v1/models` → each
   * entry's `reasoning` object, https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
   * Absent for other providers.
   */
  reasoning?: OpenRouterReasoningMeta;
  /** OpenRouter `context_length`. Absent for other providers. */
  contextLength?: number;
}

/**
 * OpenRouter per-model reasoning descriptor from `GET /api/v1/models`.
 * - `supported_efforts`: effort selector values (descending). `null` = all
 *   gateway efforts accepted; omitted = no effort selection exposed.
 * - `default_effort: "none"` = reasoning off by default.
 * - `mandatory: true` = cannot be disabled, never send `effort: "none"`.
 */
export interface OpenRouterReasoningMeta {
  supported_efforts?: string[] | null;
  default_effort?: string | null;
  default_enabled?: boolean | null;
  mandatory?: boolean | null;
  supports_max_tokens?: boolean | null;
}

export interface FetchModelsOptions {
  modelsUrlOverride?: string;
  /** When set (e.g. `'google'`), selects the Gemini-native list path. */
  providerId?: string;
  providerType?: string;
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
 * 2. `{base}/v1/models`; or `{base}/models` when base ends in a version segment
 *    (`/v1`, `.../paas/v4`), plus `{base}/v1/models` fallback when that segment
 *    is not `/v1`
 * 3. If base hits a known Anthropic-compat suffix, the stripped root +
 *    `/v1/models` and `/models`
 *
 * Deduped, order-preserving. Throws on an empty base URL.
 */
export function buildModelsUrlCandidates(
  baseUrl: string,
  opts: { modelsUrlOverride?: string } = {},
): string[] {
  const override = opts.modelsUrlOverride?.trim();
  if (override) return [override];

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL is empty');

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
    name?: string;
    context_length?: number;
    reasoning?: OpenRouterReasoningMeta;
  }>;
  // Gemini-native list shape (GET /v1beta/models).
  models?: Array<{
    name?: string;
    baseModelId?: string;
    version?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
    thinking?: boolean;
  }>;
  nextPageToken?: string;
  next_page_token?: string;
}

/** True when this probe should use the Gemini-native list path. */
export function isGeminiModelsRequest(
  baseUrl: string,
  opts: FetchModelsOptions = {},
): boolean {
  if (opts.providerId === 'google' || opts.providerType === 'google') return true;
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

/**
 * Builds the Gemini-native list URL (`GET /v1beta/models`).
 *
 * Normalizes the many base-URL shapes callers use:
 * - `https://generativelanguage.googleapis.com/v1beta` → `…/v1beta/models`
 * - `https://generativelanguage.googleapis.com` → `…/v1beta/models`
 * - `…/v1beta/openai` (OpenAI-compat override) → `…/v1beta/models`
 * - already ending in `/models` → used as-is
 */
export function buildGeminiModelsUrl(
  baseUrl: string,
  opts: Pick<FetchModelsOptions, 'modelsUrlOverride'> = {},
): string {
  const override = opts.modelsUrlOverride?.trim();
  if (override) return override;

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Base URL is empty');

  if (/\/models\/?$/.test(trimmed)) return trimmed;
  if (trimmed.includes('/v1beta')) {
    return `${trimmed.replace(/\/openai\/?$/, '')}/models`;
  }
  return `${trimmed}/v1beta/models`;
}

/** Strip the `models/` resource prefix; prefer `baseModelId` when present. */
function geminiModelId(m: NonNullable<ModelsApiResponse['models']>[number]): string | null {
  const base = m.baseModelId?.trim();
  if (base) return base;
  const name = m.name?.trim();
  if (!name) return null;
  if (name.startsWith('tunedModels/')) return null;
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

async function fetchGeminiModels(
  baseUrl: string,
  apiKey: string,
  opts: FetchModelsOptions,
): Promise<FetchedModel[]> {
  const listUrl = buildGeminiModelsUrl(baseUrl, opts);
  const out: FetchedModel[] = [];
  let pageToken: string | undefined;
  // The API caps at 1000/page; 100 keeps payloads small while paginating.
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(listUrl);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    // Direct Google auth is `?key=`; many proxies accept `x-goog-api-key`.
    // Send both in one request so direct + proxied bases work without a retry.
    if (apiKey && !url.searchParams.has('key')) url.searchParams.set('key', apiKey);

    const res = await fetchWithTimeout(
      url.toString(),
      {
        method: 'GET',
        headers: apiKey ? { 'x-goog-api-key': apiKey } : {},
        redirect: 'manual',
      },
      FETCH_TIMEOUT_MS,
    );

    if (res.status >= 300 && res.status < 400) {
      throw new ModelFetchError(res.status, 'Redirects are not allowed');
    }

    if (!res.ok) {
      // Wrong native path on a proxy → let the caller fall back to the
      // OpenAI-compatible candidates instead of hard-failing (unless the
      // caller pinned an explicit override URL, which must surface as 404).
      if (res.status === 404 || res.status === 405) {
        throw new ModelFetchError(404, `No Gemini /models endpoint at ${listUrl}`);
      }
      const text = await res.text().catch(() => '');
      throw new ModelFetchError(res.status, `HTTP ${res.status}: ${text.slice(0, 512)}`);
    }

    const body = (await res.json()) as ModelsApiResponse;

    // Some proxies serve the OpenAI-compatible shape even under a Google host.
    if (Array.isArray(body.data)) {
      return body.data
        .map((m) => ({
          id: m.id,
          ownedBy: m.owned_by,
          displayName: m.name || undefined,
          reasoning: m.reasoning,
          contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }

    for (const m of body.models ?? []) {
      const id = geminiModelId(m);
      if (!id) continue;
      // Keep only generative (chat) models — embedding/tts/image models expose
      // other methods (e.g. `embedContent`) and are filtered here per the
      // `supportedGenerationMethods` contract. Entries without the field
      // (older proxies) are kept; the route's NON_CHAT_PATTERN still applies.
      if (
        Array.isArray(m.supportedGenerationMethods) &&
        !m.supportedGenerationMethods.includes('generateContent')
      ) {
        continue;
      }
      out.push({
        id,
        ownedBy: m.version ? `v${m.version}` : undefined,
        displayName: m.displayName || undefined,
        thinking: typeof m.thinking === 'boolean' ? m.thinking : undefined,
        inputTokenLimit: typeof m.inputTokenLimit === 'number' ? m.inputTokenLimit : undefined,
        outputTokenLimit:
          typeof m.outputTokenLimit === 'number' ? m.outputTokenLimit : undefined,
        supportedGenerationMethods: m.supportedGenerationMethods,
      });
    }

    pageToken = body.nextPageToken ?? body.next_page_token ?? undefined;
    if (!pageToken) break;
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Fetches the model list by trying each candidate URL in order. A 404/405 means
 * "wrong path" and moves on to the next candidate; any other non-2xx is returned
 * as an error immediately (e.g. 401 = bad key, surfaced to the caller verbatim).
 *
 * Gemini-native bases (`providerId/Type === 'google'` or a
 * `generativelanguage.googleapis.com` host) use `GET /v1beta/models`
 * (auth via `?key=` + `x-goog-api-key`, paginated) and fall back to the
 * OpenAI-compatible candidates only when the native path 404s (proxy without
 * a native list endpoint).
 *
 * Throws on network failure or when all candidates 404. The caller (probe route)
 * is responsible for SSRF validation of `baseUrl` before calling this.
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  opts: FetchModelsOptions = {},
): Promise<FetchedModel[]> {
  if (isGeminiModelsRequest(baseUrl, opts)) {
    try {
      return await fetchGeminiModels(baseUrl, apiKey, opts);
    } catch (error) {
      // Native path missing on this host (proxy) → fall through to the
      // OpenAI-compatible candidates below. Auth/redirect errors propagate.
      if (!(error instanceof ModelFetchError && error.status === 404)) throw error;
      if (opts.modelsUrlOverride) throw error;
    }
  }

  const candidates = buildModelsUrlCandidates(baseUrl, opts);

  for (const url of candidates) {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        redirect: 'manual',
      },
      FETCH_TIMEOUT_MS,
    );

    if (res.status >= 300 && res.status < 400) {
      throw new ModelFetchError(res.status, 'Redirects are not allowed');
    }

    if (res.ok) {
      const body = (await res.json()) as ModelsApiResponse;
      return (body.data ?? [])
        .map((m) => ({
          id: m.id,
          ownedBy: m.owned_by,
          displayName: m.name || undefined,
          reasoning: m.reasoning,
          contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }

    if (res.status === 404 || res.status === 405) {
      continue;
    }

    // Other statuses (401/403/5xx) are terminal — surface the body for context.
    const text = await res.text().catch(() => '');
    throw new ModelFetchError(res.status, `HTTP ${res.status}: ${text.slice(0, 512)}`);
  }

  throw new ModelFetchError(404, `No /models endpoint found (tried: ${candidates.join(', ')})`);
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
