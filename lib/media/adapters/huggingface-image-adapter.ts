/**
 * Hugging Face FLUX Image Generation Adapter
 *
 * Generates images through the `black-forest-labs/FLUX.1-dev` Gradio Space via
 * its `/infer` API endpoint, using the caller's Hugging Face access token
 * (`hf_...`) as the credential:
 *
 * - Config: GET {space}/config → dependencies[].api_name === 'infer' →
 *           fn_index (2 on this Space), api_prefix ('/gradio_api')
 * - Join:  POST {space}/gradio_api/queue/join
 *          { data: [prompt, seed, randomize_seed, width, height,
 *                    guidance_scale, num_inference_steps],
 *            event_data: null, fn_index, trigger_id: null, session_hash }
 *          → { event_id }
 * - Poll:  GET  {space}/gradio_api/queue/data?session_hash=... (SSE)
 *          → `process_completed` + `output.data: [{url|path,...}, seed]`;
 *           an error is `process_completed` with `success:false` and
 *           `output.error` (e.g. the ZeroGPU quota refusal)
 *
 * This mirrors what `@gradio/client`'s `client.predict("/infer", {...})` does
 * (see the Space's API docs), issued here with plain `fetch` so no extra
 * dependency is needed. The legacy `/call/infer` route is deliberately
 * avoided: it discards the provider's real error message and answers with
 * `data: null`, hiding e.g. "You have exceeded your ZeroGPU runs limit".
 *
 * FLUX.1-dev is a gated model: the Hugging Face account behind the token must
 * accept the model license (https://huggingface.co/black-forest-labs/FLUX.1-dev)
 * before the Space serves it, otherwise calls fail with 401/403.
 *
 * Authentication: Authorization: Bearer <hf token>
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
  MediaProviderFetch,
} from '../types';
import { mediaFetchFor } from '../media-fetch';
import { assertNotRedirected } from '../redirect-guard';
import { requireModel } from '../require-model';
import {
  huggingFaceAuthHeaders,
  huggingFaceSpaceUrl as resolveSpaceUrl,
  resolveGradioFileUrl,
  testHuggingFaceLogin,
} from './huggingface-common';

export const HUGGINGFACE_DEFAULT_SPACE_URL = 'https://black-forest-labs-flux-1-dev.hf.space';
export const HUGGINGFACE_DEFAULT_MODEL = 'black-forest-labs/FLUX.1-dev';

export { resolveGradioFileUrl };

/** FLUX.1-dev `/infer` defaults (match the Space's API docs). */
export const HUGGINGFACE_FLUX_DEFAULTS = {
  seed: 0,
  randomizeSeed: true,
  width: 1024,
  height: 1024,
  guidanceScale: 3.5,
  numInferenceSteps: 28,
} as const;
const DEFAULT_GUIDANCE_SCALE = HUGGINGFACE_FLUX_DEFAULTS.guidanceScale;
const DEFAULT_NUM_INFERENCE_STEPS = HUGGINGFACE_FLUX_DEFAULTS.numInferenceSteps;

/** Dimension defaults per aspect ratio, mirroring the other image adapters. */
function getDimensions(aspectRatio?: string): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16':
      return { width: 720, height: 1280 };
    case '1:1':
      return { width: 1024, height: 1024 };
    case '4:3':
      return { width: 1024, height: 768 };
    default:
      return { width: 1280, height: 720 }; // 16:9
  }
}

function authHeaders(apiKey: string): Record<string, string> {
  return huggingFaceAuthHeaders(apiKey);
}

/**
 * Resolve the Gradio Space URL for a request: an explicit Base URL override
 * wins (a pasted `.../gradio_api[/call/infer]` suffix is trimmed), otherwise a
 * `owner/repo` model id maps to its `*.hf.space` host.
 */
export function huggingFaceSpaceUrl(baseUrl?: string, model?: string): string {
  return resolveSpaceUrl(
    baseUrl,
    model || HUGGINGFACE_DEFAULT_MODEL,
    HUGGINGFACE_DEFAULT_SPACE_URL,
  );
}

interface SseEvent {
  event: string;
  data: string[];
}

/**
 * Read Gradio SSE events until `complete` (or `error`). Partial `generating`
 * events are skipped; the payload of the terminal event is returned parsed.
 */
export async function readGradioResultEvent(
  response: Response,
  providerLabel: string,
): Promise<unknown> {
  const body = response.body;
  if (!body) {
    throw new Error(`${providerLabel} returned an empty event stream`);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let current: SseEvent = { event: '', data: [] };

  const dispatch = (): { done: boolean; payload?: unknown } => {
    if (current.event === 'complete') {
      const raw = current.data.join('\n');
      current = { event: '', data: [] };
      try {
        return { done: true, payload: JSON.parse(raw) as unknown };
      } catch {
        throw new Error(`${providerLabel} returned an unreadable result payload`);
      }
    }
    if (current.event === 'error') {
      const raw = current.data.join('\n');
      current = { event: '', data: [] };
      const detail = raw.trim();
      // The Space answers queue pressure (busy Space, exhausted ZeroGPU
      // quota, gated-model refusal without a message) with an empty payload
      // (`data: null`) — surface that as a retryable busy message instead of
      // echoing "null".
      if (!detail || detail === 'null' || detail === '""' || detail === '[]') {
        throw new Error(
          `${providerLabel} reported an error with no details (the Space is likely busy or out of GPU quota — wait a moment and retry)`,
        );
      }
      throw new Error(`${providerLabel} reported an error: ${raw.slice(0, 300)}`);
    }
    // `generating` and other interim events carry no terminal payload.
    current = { event: '', data: [] };
    return { done: false };
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) {
            current.event = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            current.data.push(line.slice('data:'.length).trimStart());
          }
        }
        const terminal = dispatch();
        if (terminal.done) {
          await reader.cancel().catch(() => undefined);
          return terminal.payload;
        }
        boundary = buffer.indexOf('\n\n');
      }
      if (done) {
        // Flush a final event not terminated by a blank line.
        if (current.event || current.data.length > 0) {
          const terminal = dispatch();
          if (terminal.done) return terminal.payload;
        }
        throw new Error(`${providerLabel} closed the event stream without a result`);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read Gradio 5 sse_v3 queue events (`{space}/gradio_api/queue/data`)
 * until `process_completed` / `close_stream`. Unlike the legacy
 * `/call/infer` SSE (see `readGradioResultEvent`), each `data:` line is a
 * JSON envelope (`{msg, event_id, output?, success?, ...}`) — errors carry
 * the provider's real message in `output.error` (e.g. the ZeroGPU quota
 * refusal), which the bare `/call/infer` route delivers as `data: null`.
 */
export async function readFluxQueueResultEvent(
  response: Response,
  providerLabel: string,
): Promise<unknown> {
  const body = response.body;
  if (!body) {
    throw new Error(`${providerLabel} returned an empty event stream`);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  /** Returns done with the completed payload when this message terminates. */
  const handleMessage = (raw: string): { done: boolean; payload?: unknown } => {
    const detail = raw.trim();
    if (!detail || detail === 'null' || detail === '""' || detail === '[]') {
      return { done: false };
    }
    let message: {
      msg?: unknown;
      success?: unknown;
      message?: unknown;
      title?: unknown;
      output?: { error?: unknown; title?: unknown; data?: unknown } | null;
    };
    try {
      message = JSON.parse(detail);
    } catch {
      return { done: false };
    }
    const msg = typeof message.msg === 'string' ? message.msg : '';
    if (msg === 'process_completed') {
      if (message.success === false) {
        const detail =
          (typeof message.output?.error === 'string' && message.output.error) ||
          (typeof message.output?.title === 'string' && message.output.title) ||
          (typeof message.title === 'string' && message.title) ||
          'unknown error';
        throw new Error(`${providerLabel} reported an error: ${String(detail).slice(0, 300)}`);
      }
      if (message.output && typeof message.output === 'object' && 'data' in message.output) {
        return { done: true, payload: message.output.data };
      }
      throw new Error(`${providerLabel} returned an unreadable result payload`);
    }
    if (msg === 'process_generating' && message.success === false) {
      const detail =
        (typeof message.output?.error === 'string' && message.output.error) ||
        (typeof message.title === 'string' && message.title) ||
        'unknown error';
      throw new Error(`${providerLabel} reported an error: ${String(detail).slice(0, 300)}`);
    }
    if (msg === 'unexpected_error') {
      const detail =
        (typeof message.message === 'string' && message.message) ||
        (typeof message.title === 'string' && message.title) ||
        'unknown error';
      throw new Error(`${providerLabel} reported an error: ${String(detail).slice(0, 300)}`);
    }
    if (msg === 'close_stream') {
      return { done: true, payload: undefined };
    }
    return { done: false };
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) {
            const outcome = handleMessage(line.slice('data:'.length).trimStart());
            if (outcome.done) {
              await reader.cancel().catch(() => undefined);
              if (outcome.payload === undefined) {
                throw new Error(`${providerLabel} closed the event stream without a result`);
              }
              return outcome.payload;
            }
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
      if (done) {
        if (buffer.trim()) {
          for (const line of buffer.split('\n')) {
            if (line.startsWith('data:')) {
              const outcome = handleMessage(line.slice('data:'.length).trimStart());
              if (outcome.done && outcome.payload !== undefined) return outcome.payload;
            }
          }
        }
        throw new Error(`${providerLabel} closed the event stream without a result`);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Lightweight connectivity test — validates the Hugging Face login without
 * generating anything. `GET /api/whoami-v2` is the cheapest endpoint that
 * actually rejects a bad or missing token (a gated Space would otherwise burn
 * queue time before failing).
 */
export async function testHuggingFaceImageConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  return testHuggingFaceLogin(config);
}

/**
 * Resolve the `/infer` endpoint's fn_index from the Space's `/config`
 * (dependencies[].api_name === 'infer'), cached per Space URL. Falls back
 * to the literal index 2 — the only documented dependency slot on the
 * FLUX.1-dev Space — when the config lookup is unavailable.
 */
interface SpaceConfig {
  api_prefix?: unknown;
  dependencies?: Array<{ api_name?: unknown }>;
}

interface SpaceCallInfo {
  apiPrefix: string;
  fnIndex: number;
}

const spaceCallInfoCache = new Map<string, Promise<SpaceCallInfo>>();

function fetchSpaceCallInfo(
  fetchImpl: MediaProviderFetch,
  spaceUrl: string,
  headers: Record<string, string>,
): Promise<SpaceCallInfo> {
  let cached = spaceCallInfoCache.get(spaceUrl);
  if (!cached) {
    cached = (async (): Promise<SpaceCallInfo> => {
      try {
        const response = await fetchImpl(`${spaceUrl}/config`, {
          method: 'GET',
          redirect: 'manual',
          headers,
        });
        if (!response.ok) throw new Error(`config ${response.status}`);
        const config = (await response.json().catch(() => null)) as SpaceConfig | null;
        const apiPrefix =
          typeof config?.api_prefix === 'string' && config.api_prefix.startsWith('/')
            ? config.api_prefix
            : '/gradio_api';
        const deps = Array.isArray(config?.dependencies) ? config!.dependencies : [];
        const fnIndex = deps.findIndex((dep) => dep?.api_name === 'infer' || dep?.api_name === '/infer');
        return { apiPrefix, fnIndex: fnIndex >= 0 ? fnIndex : 2 };
      } catch {
        return { apiPrefix: '/gradio_api', fnIndex: 2 };
      }
    })();
    spaceCallInfoCache.set(spaceUrl, cached);
  }
  return cached;
}

/** Clear the /config cache (tests). */
export function clearFluxSpaceCallInfoCache(): void {
  spaceCallInfoCache.clear();
}

function randomSessionHash(): string {
  return Array.from({ length: 11 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

export async function generateWithHuggingFaceImage(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const model = requireModel(config.model, 'Hugging Face Image');
  const spaceUrl = huggingFaceSpaceUrl(config.baseUrl, model);
  const fetchImpl = mediaFetchFor(config);
  const headers = authHeaders(config.apiKey);
  const { width, height } = getDimensions(options.aspectRatio);
  const targetWidth = options.width || width;
  const targetHeight = options.height || height;

  // Parameter order follows the Space's `/infer` signature:
  // prompt, seed, randomize_seed, width, height, guidance_scale,
  // num_inference_steps. Callers may override seed / sampling through
  // ImageGenerationOptions (the Settings panel exposes the same fields);
  // unset fields fall back to the API defaults (seed 0 + randomize keeps
  // every call fresh).
  const seed = Number.isFinite(options.seed) ? Math.max(0, Math.floor(options.seed as number)) : HUGGINGFACE_FLUX_DEFAULTS.seed;
  const randomizeSeed = options.randomizeSeed ?? HUGGINGFACE_FLUX_DEFAULTS.randomizeSeed;
  const guidanceScale =
    Number.isFinite(options.guidanceScale) && (options.guidanceScale as number) > 0
      ? (options.guidanceScale as number)
      : DEFAULT_GUIDANCE_SCALE;
  const numInferenceSteps =
    Number.isFinite(options.numInferenceSteps) && (options.numInferenceSteps as number) > 0
      ? Math.floor(options.numInferenceSteps as number)
      : DEFAULT_NUM_INFERENCE_STEPS;

  // The Space runs on Gradio 5's sse_v3 queue protocol (verified live):
  // POST {space}/gradio_api/queue/join → { event_id }, then GET
  // {space}/gradio_api/queue/data?session_hash=... (SSE). The legacy
  // /call/infer route answers queue errors as an empty `data: null`,
  // losing the real message (e.g. "You have exceeded your ZeroGPU runs
  // limit..."), so the queue route is the one that echoes it.
  const { apiPrefix, fnIndex } = await fetchSpaceCallInfo(fetchImpl, spaceUrl, headers);
  const sessionHash = randomSessionHash();
  const joinResponse = await fetchImpl(`${spaceUrl}${apiPrefix}/queue/join`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'x-gradio-user': 'api', ...headers },
    body: JSON.stringify({
      data: [
        options.prompt,
        seed,
        randomizeSeed,
        targetWidth,
        targetHeight,
        guidanceScale,
        numInferenceSteps,
      ],
      event_data: null,
      fn_index: fnIndex,
      trigger_id: null,
      session_hash: sessionHash,
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  assertNotRedirected(joinResponse, 'Hugging Face Image');

  if (!joinResponse.ok) {
    const text = await joinResponse.text().catch(() => joinResponse.statusText);
    throw new Error(
      `Hugging Face image generation failed (${joinResponse.status}): ${text.slice(0, 300)}`,
    );
  }

  const joinData = (await joinResponse.json().catch(() => null)) as {
    event_id?: unknown;
  } | null;
  const eventId = typeof joinData?.event_id === 'string' ? joinData.event_id : '';
  if (!eventId) {
    throw new Error('Hugging Face image generation failed: the Space returned no event id');
  }

  const streamResponse = await fetchImpl(
    `${spaceUrl}${apiPrefix}/queue/data?session_hash=${encodeURIComponent(sessionHash)}`,
    {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/event-stream', 'x-gradio-user': 'api', ...headers },
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  assertNotRedirected(streamResponse, 'Hugging Face Image');

  if (!streamResponse.ok) {
    const text = await streamResponse.text().catch(() => streamResponse.statusText);
    throw new Error(
      `Hugging Face image generation failed (${streamResponse.status}): ${text.slice(0, 300)}`,
    );
  }

  const payload = await readFluxQueueResultEvent(streamResponse, 'Hugging Face Image');
  const fileRef = Array.isArray(payload) ? payload[0] : null;
  const resolved = resolveGradioFileUrl(spaceUrl, fileRef);
  if (!resolved) {
    throw new Error('Hugging Face returned no image data');
  }

  return {
    url: resolved.url,
    mimeType: resolved.mimeType,
    width: targetWidth,
    height: targetHeight,
  };
}
