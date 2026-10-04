/**
 * Hugging Face Wan 2.2 Video Generation Adapter
 *
 * Animates a previously generated image through the
 * `zerogpu-aoti/wan2-2-fp8da-aoti-faster` Gradio Space (Gradio 6, `sse_v3`
 * protocol — verified against the live Space's `/config` and
 * `/gradio_api/info`). The Space exposes one public named endpoint:
 *
 * - `/generate_video`
 *   `[input_image FileData, prompt string, steps number = 6,
 *    negative_prompt string, duration_seconds number = 3.5,
 *    guidance_scale number = 1, guidance_scale_2 number = 1,
 *    seed number = 42, randomize_seed bool = true]`
 *   → `[VideoData FileData, seed number]`
 *
 * Protocol (plain `fetch`, no `gradio_client` dependency) — the Gradio 5+
 * queue shape shared with the FLUX image adapter:
 * - Config: GET {space}/config → dependencies[].api_name === 'generate_video'
 *           → fn_index (0 on this Space), api_prefix ('/gradio_api')
 * - Upload: POST {space}/gradio_api/upload (multipart `files`) → [path, ...]
 * - Join:   POST {space}/gradio_api/queue/join
 *           { data, event_data: null, fn_index, trigger_id: null,
 *             session_hash } → { event_id }
 * - Poll:   GET  {space}/gradio_api/queue/data?session_hash=... (SSE, sse_v3
 *           envelopes) → `process_completed` + `output.data: [video, seed]`;
 *           an error is `process_completed` with `success:false` and
 *           `output.error` (e.g. the ZeroGPU quota refusal)
 *
 * The model is Wan 2.2 14B image-to-video (FP8 quantized, Lightning LoRA for
 * fast 4–8 step generation). Like LivePortrait it animates a source still, so
 * the source image (`options.sourceImageUrl`, an `https:` or `data:` URL of a
 * generated image) is REQUIRED — this provider cannot dream motion from text
 * alone. Unlike LivePortrait it also takes the text prompt, so the animation
 * follows the scene description instead of a fixed driving clip.
 *
 * Authentication: Authorization: Bearer <hf token>
 */

import type {
  MediaProviderFetch,
  VideoGenerationConfig,
  VideoGenerationOptions,
  VideoGenerationResult,
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
import { readFluxQueueResultEvent } from './huggingface-image-adapter';

export const HUGGINGFACE_WAN_MODEL = 'zerogpu-aoti/wan2-2-fp8da-aoti-faster';
/** Named Space endpoint in its documented (leading-slash) form. */
export const WAN_GENERATE_VIDEO_ENDPOINT = '/generate_video';
/** Default Gradio Space host for the Wan 2.2 model. */
export const HUGGINGFACE_WAN_DEFAULT_SPACE_URL =
  'https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space';
/** Refuse to buffer more than this for the source upload. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const PROVIDER_LABEL = 'Hugging Face Wan 2.2';

/** Space defaults (match `/gradio_api/info` parameter defaults). */
export const HUGGINGFACE_WAN_DEFAULTS = {
  steps: 6,
  negativePrompt:
    '色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走',
  durationSeconds: 3.5,
  guidanceScale: 1,
  guidanceScale2: 1,
  seed: 42,
  randomizeSeed: true,
} as const;

/** Dimension defaults per aspect ratio, mirroring the other video adapters. */
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

function extensionFor(mime: string): string {
  const table: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  };
  return table[mime] ?? 'jpg';
}

interface FetchedBytes {
  bytes: Uint8Array;
  mime: string;
}

/**
 * Materialize an `https:`/`data:` reference into bytes for `/upload`.
 * `data:` URLs decode locally; remote URLs go through the redirect-following
 * download transport when the caller injected one, else the strict provider
 * transport. The Hugging Face token is only sent to Hugging Face hosts.
 */
async function fetchBytesForUpload(
  config: VideoGenerationConfig,
  ref: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<FetchedBytes> {
  if (ref.startsWith('data:')) {
    // `fetch` serves `data:` URLs locally in browsers and in Node — no
    // network, no SSRF surface, no base64 decoder needed.
    const response = await fetch(ref);
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
    if (!mime.startsWith('image/')) {
      throw new Error(
        `${PROVIDER_LABEL} needs an image data URL, got content type "${mime || 'unknown'}"`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(`${PROVIDER_LABEL} input exceeds the upload limit`);
    }
    return { bytes, mime };
  }
  if (!/^https?:\/\//i.test(ref)) {
    throw new Error(`${PROVIDER_LABEL} needs an https: or data: URL for the source image`);
  }
  let hostname = '';
  try {
    hostname = new URL(ref).hostname.toLowerCase();
  } catch {
    throw new Error(`${PROVIDER_LABEL} needs an https: or data: URL for the source image`);
  }
  const scopedHeaders =
    hostname === 'huggingface.co' ||
    hostname.endsWith('.huggingface.co') ||
    hostname.endsWith('.hf.space')
      ? headers
      : {};
  const downloader = config.downloadFetchImpl ?? mediaFetchFor(config);
  const response = await downloader(ref, {
    method: 'GET',
    // Only the strict transport pins `manual`: the download transport is
    // built to follow redirects (re-validating every hop).
    ...(config.downloadFetchImpl ? {} : { redirect: 'manual' as const }),
    headers: scopedHeaders,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`${PROVIDER_LABEL} could not download the source image (${response.status})`);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_UPLOAD_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${PROVIDER_LABEL} input exceeds the upload limit`);
  }
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  if (mime && !mime.startsWith('image/')) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${PROVIDER_LABEL} needs an image URL, got content type "${mime}"`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(`${PROVIDER_LABEL} input is empty or exceeds the upload limit`);
  }
  return { bytes, mime: mime || 'image/jpeg' };
}

function gradioFileData(path: string, filename: string, mime: string, size: number) {
  return {
    path,
    url: null,
    orig_name: filename,
    size,
    mime_type: mime,
    meta: { _type: 'gradio.FileData' },
  };
}

/** Upload the source image to the Space; resolves to the server-side path. */
export async function uploadImageToWanSpace(
  fetchImpl: MediaProviderFetch,
  apiBase: string,
  bytes: Uint8Array,
  filename: string,
  mime: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append('files', new Blob([bytes.buffer as ArrayBuffer], { type: mime }), filename);
  const response = await fetchImpl(`${apiBase}/upload`, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: form,
    ...(signal ? { signal } : {}),
  });
  assertNotRedirected(response, PROVIDER_LABEL);
  if (!response.ok) {
    throw new Error(`${PROVIDER_LABEL} upload failed (${response.status})`);
  }
  const data = (await response.json().catch(() => null)) as unknown;
  const paths = (Array.isArray(data) ? data : []).map((entry) =>
    typeof entry === 'string' ? entry : (entry as { path?: unknown })?.path,
  );
  if (paths.length !== 1 || typeof paths[0] !== 'string' || !paths[0]) {
    throw new Error(`${PROVIDER_LABEL} upload returned an unexpected response`);
  }
  return paths[0] as string;
}

interface SpaceCallInfo {
  apiPrefix: string;
  fnIndex: number;
}

const spaceCallInfoCache = new Map<string, Promise<SpaceCallInfo>>();

/**
 * Resolve the `/generate_video` endpoint's fn_index from the Space's
 * `/config` (dependencies[].api_name), cached per Space URL. The api_prefix
 * comes from the same document (`/gradio_api` on this Space).
 */
function fetchWanSpaceCallInfo(
  fetchImpl: MediaProviderFetch,
  spaceUrl: string,
  headers: Record<string, string>,
): Promise<SpaceCallInfo> {
  let cached = spaceCallInfoCache.get(spaceUrl);
  if (!cached) {
    cached = (async (): Promise<SpaceCallInfo> => {
      const response = await fetchImpl(`${spaceUrl}/config`, {
        method: 'GET',
        redirect: 'manual',
        headers,
      });
      assertNotRedirected(response, PROVIDER_LABEL);
      if (!response.ok) {
        throw new Error(`${PROVIDER_LABEL} config lookup failed (${response.status})`);
      }
      const config = (await response.json().catch(() => null)) as {
        api_prefix?: unknown;
        dependencies?: Array<{ api_name?: unknown }>;
      } | null;
      const apiPrefix =
        typeof config?.api_prefix === 'string' && config.api_prefix.startsWith('/')
          ? config.api_prefix
          : '/gradio_api';
      const deps = Array.isArray(config?.dependencies) ? config!.dependencies : [];
      const fnIndex = deps.findIndex(
        (dep) =>
          dep?.api_name === WAN_GENERATE_VIDEO_ENDPOINT ||
          dep?.api_name === WAN_GENERATE_VIDEO_ENDPOINT.slice(1),
      );
      if (fnIndex < 0) {
        throw new Error(`${PROVIDER_LABEL} has no ${WAN_GENERATE_VIDEO_ENDPOINT} endpoint`);
      }
      return { apiPrefix, fnIndex };
    })();
    spaceCallInfoCache.set(spaceUrl, cached);
  }
  return cached;
}

/** Clear the /config cache (tests). */
export function clearWanSpaceCallInfoCache(): void {
  spaceCallInfoCache.clear();
}

function randomSessionHash(): string {
  return Array.from({ length: 11 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * Lightweight connectivity test — validates the Hugging Face login without
 * spending any GPU queue time.
 */
export async function testHuggingFaceWanVideoConnectivity(
  config: VideoGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  return testHuggingFaceLogin(config);
}

export async function generateWithHuggingFaceWanVideo(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
): Promise<VideoGenerationResult> {
  const model = requireModel(config.model, 'Hugging Face Wan 2.2');
  const spaceUrl = resolveSpaceUrl(config.baseUrl, model, HUGGINGFACE_WAN_DEFAULT_SPACE_URL);
  const fetchImpl = mediaFetchFor(config);
  const headers = huggingFaceAuthHeaders(config.apiKey);
  const signal = options.signal;
  const { width, height } = getDimensions(options.aspectRatio);

  const sourceImageUrl = options.sourceImageUrl?.trim();
  if (!sourceImageUrl) {
    throw new Error(
      `${PROVIDER_LABEL} animates a source image: generate an image first, then pass its URL as sourceImageUrl.`,
    );
  }

  // Parameter order follows the Space's `/generate_video` signature
  // (dependencies[0].inputs): input image, prompt, steps, negative prompt,
  // duration, guidance scale, guidance scale 2, seed, randomize seed.
  // Unset fields fall back to the Space defaults (steps 6, 3.5s, guidance 1).
  const steps = Math.floor(
    clampNumber(options.steps ?? HUGGINGFACE_WAN_DEFAULTS.steps, 1, 30, HUGGINGFACE_WAN_DEFAULTS.steps),
  );
  const durationSeconds =
    Math.round(
      clampNumber(
        options.duration ?? HUGGINGFACE_WAN_DEFAULTS.durationSeconds,
        0.5,
        5,
        HUGGINGFACE_WAN_DEFAULTS.durationSeconds,
      ) * 10,
    ) / 10;
  const guidanceScale = clampNumber(
    options.guidanceScale ?? HUGGINGFACE_WAN_DEFAULTS.guidanceScale,
    0,
    10,
    HUGGINGFACE_WAN_DEFAULTS.guidanceScale,
  );
  const guidanceScale2 = clampNumber(
    options.guidanceScale2 ?? HUGGINGFACE_WAN_DEFAULTS.guidanceScale2,
    0,
    10,
    HUGGINGFACE_WAN_DEFAULTS.guidanceScale2,
  );
  const seed =
    Number.isFinite(options.seed) && (options.seed as number) >= 0
      ? Math.floor(options.seed as number)
      : HUGGINGFACE_WAN_DEFAULTS.seed;
  const randomizeSeed = options.randomizeSeed ?? HUGGINGFACE_WAN_DEFAULTS.randomizeSeed;

  const source = await fetchBytesForUpload(config, sourceImageUrl, headers, signal);
  const filename = `source.${extensionFor(source.mime)}`;

  const { apiPrefix, fnIndex } = await fetchWanSpaceCallInfo(fetchImpl, spaceUrl, headers);
  const apiBase = `${spaceUrl}${apiPrefix}`;
  const sourcePath = await uploadImageToWanSpace(
    fetchImpl,
    apiBase,
    source.bytes,
    filename,
    source.mime,
    headers,
    signal,
  );

  const sessionHash = randomSessionHash();
  const joinResponse = await fetchImpl(`${apiBase}/queue/join`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      data: [
        gradioFileData(sourcePath, filename, source.mime, source.bytes.length),
        options.prompt,
        steps,
        options.negativePrompt ?? HUGGINGFACE_WAN_DEFAULTS.negativePrompt,
        durationSeconds,
        guidanceScale,
        guidanceScale2,
        seed,
        randomizeSeed,
      ],
      event_data: null,
      fn_index: fnIndex,
      trigger_id: null,
      session_hash: sessionHash,
    }),
    ...(signal ? { signal } : {}),
  });
  assertNotRedirected(joinResponse, PROVIDER_LABEL);
  if (!joinResponse.ok) {
    throw new Error(`${PROVIDER_LABEL} queue submit failed (${joinResponse.status})`);
  }
  const joinData = (await joinResponse.json().catch(() => null)) as {
    event_id?: unknown;
  } | null;
  if (!joinData || typeof joinData.event_id !== 'string' || !joinData.event_id) {
    throw new Error(`${PROVIDER_LABEL} queue submit returned no event id`);
  }

  const streamResponse = await fetchImpl(
    `${apiBase}/queue/data?session_hash=${encodeURIComponent(sessionHash)}`,
    {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/event-stream', ...headers },
      ...(signal ? { signal } : {}),
    },
  );
  assertNotRedirected(streamResponse, PROVIDER_LABEL);
  if (!streamResponse.ok) {
    throw new Error(`${PROVIDER_LABEL} event stream failed (${streamResponse.status})`);
  }

  // sse_v3 envelopes, same shape as the FLUX image Space: `process_completed`
  // carries `output.data`, and quota refusals arrive as `success:false` with
  // `output.error` (e.g. "You have exceeded your ZeroGPU runs limit").
  const payload = await readFluxQueueResultEvent(streamResponse, PROVIDER_LABEL);
  const fileRef = Array.isArray(payload) ? payload[0] : null;
  const resolved = resolveGradioFileUrl(spaceUrl, fileRef);
  if (!resolved) {
    throw new Error(`${PROVIDER_LABEL} returned no video data`);
  }

  return {
    url: resolved.url,
    // The source portrait doubles as the poster frame.
    poster: /^https?:\/\//i.test(sourceImageUrl) ? sourceImageUrl : undefined,
    width,
    height,
    duration: durationSeconds,
  };
}
