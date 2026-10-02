/**
 * Hugging Face FLUX Image Generation Adapter
 *
 * Generates images through the `black-forest-labs/FLUX.1-dev` Gradio Space via
 * its `/infer` API endpoint, using the caller's Hugging Face access token
 * (`hf_...`) as the credential:
 *
 * - Call:    POST {space}/gradio_api/call/infer
 *            { data: [prompt, seed, randomize_seed, width, height,
 *                     guidance_scale, num_inference_steps] }
 *            → { event_id }
 * - Poll:    GET  {space}/gradio_api/call/infer/{event_id} (SSE)
 *            → `event: complete` + `data: [{url|path,...}, seed]`
 *
 * This mirrors what `@gradio/client`'s `client.predict("/infer", {...})` does
 * (see the Space's API docs), issued here with plain `fetch` so no extra
 * dependency is needed.
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
const DEFAULT_GUIDANCE_SCALE = 3.5;
const DEFAULT_NUM_INFERENCE_STEPS = 28;

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
  // num_inference_steps. Seed 0 + randomize keeps every call fresh.
  const callResponse = await fetchImpl(`${spaceUrl}/gradio_api/call/infer`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      data: [
        options.prompt,
        0,
        true,
        targetWidth,
        targetHeight,
        DEFAULT_GUIDANCE_SCALE,
        DEFAULT_NUM_INFERENCE_STEPS,
      ],
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  assertNotRedirected(callResponse, 'Hugging Face Image');

  if (!callResponse.ok) {
    const text = await callResponse.text().catch(() => callResponse.statusText);
    throw new Error(
      `Hugging Face image generation failed (${callResponse.status}): ${text.slice(0, 300)}`,
    );
  }

  const callData = (await callResponse.json().catch(() => null)) as {
    event_id?: unknown;
  } | null;
  const eventId = typeof callData?.event_id === 'string' ? callData.event_id : '';
  if (!eventId) {
    throw new Error('Hugging Face image generation failed: the Space returned no event id');
  }

  const streamResponse = await fetchImpl(`${spaceUrl}/gradio_api/call/infer/${eventId}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'text/event-stream', ...headers },
    ...(options.signal ? { signal: options.signal } : {}),
  });

  assertNotRedirected(streamResponse, 'Hugging Face Image');

  if (!streamResponse.ok) {
    const text = await streamResponse.text().catch(() => streamResponse.statusText);
    throw new Error(
      `Hugging Face image generation failed (${streamResponse.status}): ${text.slice(0, 300)}`,
    );
  }

  const payload = await readGradioResultEvent(streamResponse, 'Hugging Face Image');
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
