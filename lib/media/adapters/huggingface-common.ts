/**
 * Shared Hugging Face helpers for the Gradio-Space media adapters.
 *
 * Both the image adapter (`black-forest-labs/FLUX.1-dev`, Gradio 5-style
 * `/infer` call routes) and the video adapter (`KlingTeam/LivePortrait`,
 * Gradio 4 queue protocol) authenticate with the caller's Hugging Face
 * access token (`hf_...`) and resolve `owner/repo` model ids to their
 * `*.hf.space` host. The login probe is shared so "Test Connection" behaves
 * identically for both.
 */

import type { ImageGenerationConfig } from '../types';
import { mediaFetchFor } from '../media-fetch';
import { connectivityHttpFailure, connectivityTransportFailure } from '../probe-auth';

export const HUGGINGFACE_WHOAMI_URL = 'https://huggingface.co/api/whoami-v2';

export function huggingFaceAuthHeaders(apiKey: string): Record<string, string> {
  const token = apiKey.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Resolve the Gradio Space URL for a request: an explicit Base URL override
 * wins (a pasted API suffix such as `.../gradio_api[/call/infer]` is trimmed),
 * otherwise an `owner/repo` model id maps to its `*.hf.space` host.
 */
export function huggingFaceSpaceUrl(
  baseUrl: string | undefined,
  model: string | undefined,
  defaultSpaceUrl: string,
): string {
  const raw = baseUrl?.trim();
  if (raw) {
    return raw
      .replace(/\/+$/, '')
      .replace(/\/gradio_api\/call\/infer$/, '')
      .replace(/\/gradio_api$/, '');
  }
  const spaceId = (model || '').trim();
  if (/^https?:\/\//i.test(spaceId)) {
    return spaceId.replace(/\/+$/, '');
  }
  if (spaceId) {
    const slug = spaceId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug) return `https://${slug}.hf.space`;
  }
  return defaultSpaceUrl;
}

interface GradioFileRef {
  url?: unknown;
  path?: unknown;
  mime_type?: unknown;
  orig_name?: unknown;
}

/**
 * Normalize a Gradio file payload into an absolute file URL, if any. Accepts
 * a bare URL string or a FileData object (`{url?, path?, mime_type?}`); a
 * relative `url` resolves against the Space, a bare `path` against its
 * `/gradio_api/file=` route.
 */
export function resolveGradioFileUrl(
  spaceUrl: string,
  ref: unknown,
): { url: string; mimeType?: string } | null {
  if (typeof ref === 'string' && ref) {
    const url = /^https?:\/\//i.test(ref) ? ref : new URL(ref, spaceUrl).toString();
    return { url };
  }
  if (ref && typeof ref === 'object') {
    const file = ref as GradioFileRef;
    const mimeType = typeof file.mime_type === 'string' ? file.mime_type : undefined;
    if (typeof file.url === 'string' && file.url) {
      const url = /^https?:\/\//i.test(file.url)
        ? file.url
        : new URL(file.url, spaceUrl).toString();
      return { url, mimeType };
    }
    if (typeof file.path === 'string' && file.path) {
      return { url: `${spaceUrl}/gradio_api/file=${file.path}`, mimeType };
    }
  }
  return null;
}

/**
 * Lightweight login probe shared by the Hugging Face adapters — validates the
 * access token without spending any GPU queue time. `GET /api/whoami-v2` is
 * the cheapest endpoint that actually rejects a bad or missing token.
 */
export async function testHuggingFaceLogin(
  config: Pick<ImageGenerationConfig, 'apiKey' | 'fetchImpl'>,
): Promise<{ success: boolean; message: string }> {
  if (!config.apiKey?.trim()) {
    return {
      success: false,
      message:
        'Hugging Face token is required (401). Log in with Hugging Face and paste an access token (hf_...).',
    };
  }

  let response: Response;
  try {
    response = await mediaFetchFor(config)(HUGGINGFACE_WHOAMI_URL, {
      method: 'GET',
      redirect: 'manual',
      headers: huggingFaceAuthHeaders(config.apiKey),
    });
  } catch (err) {
    return connectivityTransportFailure('Hugging Face', err);
  }
  if (response.ok) {
    const name = await response
      .json()
      .then((data) => (typeof data?.name === 'string' ? (data.name as string) : ''))
      .catch(() => '');
    await response.body?.cancel().catch(() => undefined);
    return {
      success: true,
      message: name ? `Connected to Hugging Face (@${name})` : 'Connected to Hugging Face',
    };
  }
  await response.body?.cancel().catch(() => undefined);

  if (response.status === 401 || response.status === 403) {
    return {
      success: false,
      message: `Invalid Hugging Face token (${response.status}). Log in with Hugging Face and paste a fresh access token (hf_...).`,
    };
  }
  return connectivityHttpFailure('Hugging Face', response.status);
}
