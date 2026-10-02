/**
 * Hugging Face LivePortrait Video Generation Adapter
 *
 * Animates a previously generated image through the `KlingTeam/LivePortrait`
 * Gradio Space (Gradio 4.37, verified against the live Space's `/config` and
 * `/info`). The Space exposes three named endpoints (leading-slash form, as
 * in the API docs):
 *
 * - `/gpu_wrapped_execute_video`
 *   `[source FileData, driving VideoData, relativeMotion bool=true,
 *    doCrop bool=true, pasteBack bool=true]`
 *   → `[VideoData, VideoData]` (`{video: FileData, subtitles: null}` each;
 *   the first is the animation, the second the side-by-side concat preview).
 * - `/gpu_wrapped_execute_image`
 *   `[eyesOpenRatio number 0..0.8 = 0, lipOpenRatio number 0..0.8 = 0,
 *    source FileData, doCrop bool=true]`
 *   → `[FileData, FileData]` (retargeted portrait + crop preview).
 * - `/is_square_video`
 *   `[driving VideoData]` → `[VideoData]`
 *   (the Space requires a 1:1 driving clip — validate a custom
 *   `drivingVideoUrl` through this before animating).
 *
 * Protocol (plain `fetch`, no `gradio_client` dependency):
 * - Resolve:  GET  {space}/config → dependencies[].api_name →
 *             endpoint fn_index (config stores the bare form
 *             `gpu_wrapped_execute_video`; the docs use the `/`-prefixed
 *             form — both are accepted)
 * - Upload:   POST {space}/upload (multipart `files`) → [path, ...]
 * - Submit:   POST {space}/queue/join
 *             { data, event_data: null, fn_index, session_hash } → { event_id }
 * - Poll:     GET  {space}/queue/data?session_hash=... (SSE)
 *             → `process_completed` + `data: [...]`
 *
 * The source image (`options.sourceImageUrl`, an `https:` or `data:` URL of a
 * generated image) is REQUIRED — this provider cannot dream motion from text
 * alone. The driving video defaults to the Space's own bundled `d0.mp4`
 * example (512×512, ~3s) and can be overridden via `options.drivingVideoUrl`.
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

export const HUGGINGFACE_LIVEPORTRAIT_MODEL = 'KlingTeam/LivePortrait';
/**
 * Named Space endpoints in their documented (leading-slash) form.
 * `resolveSpaceFnIndex` also accepts the bare form stored in `/config`.
 */
export const LIVEPORTRAIT_ENDPOINTS = {
  EXECUTE_IMAGE: '/gpu_wrapped_execute_image',
  EXECUTE_VIDEO: '/gpu_wrapped_execute_video',
  IS_SQUARE_VIDEO: '/is_square_video',
} as const;
/** Default Gradio Space host for the LivePortrait model. */
export const HUGGINGFACE_LIVEPORTRAIT_DEFAULT_SPACE_URL =
  'https://klingteam-liveportrait.hf.space';
/** Bundled motion example of the Space (512×512, ~3s, square as required). */
export const HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL =
  'https://huggingface.co/spaces/KlingTeam/LivePortrait/resolve/main/assets/examples/driving/d0.mp4';
/** Length of the default driving clip, reported as the result duration. */
const DEFAULT_DRIVING_DURATION_S = 3;
/** Refuse to buffer more than this per upload (source + driving are small). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const PROVIDER_LABEL = 'Hugging Face LivePortrait';

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

function extensionFor(mime: string, kind: 'image' | 'video'): string {
  const table: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
  };
  return table[mime] ?? (kind === 'image' ? 'jpg' : 'mp4');
}

interface FetchedBytes {
  bytes: Uint8Array;
  mime: string;
}

/**
 * The Hugging Face token authenticates against Hugging Face origins only.
 * Input media (`sourceImageUrl`, `drivingVideoUrl`) may live on any host —
 * sending the caller's `Authorization` there on the first hop would leak it
 * to an unrelated origin (the redirect-following download transport only
 * strips credentials on cross-origin *redirect* hops, not on the initial
 * request). Same-origin and huggingface-owned hosts keep the token.
 */
export function headersForInputDownload(
  ref: string,
  headers: Record<string, string>,
): Record<string, string> {
  let hostname = '';
  try {
    hostname = new URL(ref).hostname.toLowerCase();
  } catch {
    return {};
  }
  if (
    hostname === 'huggingface.co' ||
    hostname.endsWith('.huggingface.co') ||
    hostname.endsWith('.hf.space')
  ) {
    return headers;
  }
  return {};
}

/**
 * Materialize an `https:`/`data:` reference into bytes for `/upload`.
 * `data:` URLs decode locally; remote URLs go through the redirect-following
 * download transport when the caller injected one (`downloadFetchImpl`
 * follows storage redirects with every hop re-validated and the token
 * dropped cross-origin — the Space's bundled driving clip lives behind a
 * `huggingface.co/resolve` redirect, so the strict no-redirect transport
 * cannot fetch it), else the strict provider transport.
 */
async function fetchBytesForUpload(
  config: VideoGenerationConfig,
  ref: string,
  kind: 'image' | 'video',
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<FetchedBytes> {
  const family = kind === 'image' ? 'image/' : 'video/';
  if (ref.startsWith('data:')) {
    // `fetch` serves `data:` URLs locally in browsers and in Node — no
    // network, no SSRF surface, no base64 decoder needed.
    const response = await fetch(ref);
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
    if (!mime.startsWith(family)) {
      throw new Error(
        `${PROVIDER_LABEL} needs a ${kind} data URL, got content type "${mime || 'unknown'}"`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(`${PROVIDER_LABEL} input exceeds the upload limit`);
    }
    return { bytes, mime };
  }
  if (!/^https?:\/\//i.test(ref)) {
    throw new Error(`${PROVIDER_LABEL} needs an https: or data: URL for the ${kind} input`);
  }
  const downloader = config.downloadFetchImpl ?? mediaFetchFor(config);
  const response = await downloader(ref, {
    method: 'GET',
    // Only the strict transport pins `manual`: the download transport is
    // built to follow redirects (re-validating every hop).
    ...(config.downloadFetchImpl ? {} : { redirect: 'manual' as const }),
    // The token is scoped to Hugging Face hosts (see headersForInputDownload).
    headers: headersForInputDownload(ref, headers),
    ...(signal ? { signal } : {}),
  });
  if (!config.downloadFetchImpl) {
    assertNotRedirected(response, PROVIDER_LABEL);
  }
  if (!response.ok) {
    throw new Error(`${PROVIDER_LABEL} could not download the ${kind} input (${response.status})`);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_UPLOAD_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${PROVIDER_LABEL} input exceeds the upload limit`);
  }
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || `${family}${kind}`;
  if (mime && !mime.startsWith(family)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${PROVIDER_LABEL} needs a ${kind} URL, got content type "${mime}"`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(`${PROVIDER_LABEL} input is empty or exceeds the upload limit`);
  }
  return { bytes, mime: mime || `${family}${kind}` };
}

interface UploadFile {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

/** Upload files to the Space; resolves to server-side paths in order. */
export async function uploadFilesToSpace(
  fetchImpl: MediaProviderFetch,
  spaceUrl: string,
  files: UploadFile[],
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string[]> {
  const form = new FormData();
  for (const file of files) {
    form.append(
      'files',
      new Blob([file.bytes.buffer as ArrayBuffer], { type: file.mime }),
      file.filename,
    );
  }
  const response = await fetchImpl(`${spaceUrl}/upload`, {
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
  if (paths.length !== files.length || paths.some((p) => typeof p !== 'string' || !p)) {
    throw new Error(`${PROVIDER_LABEL} upload returned an unexpected response`);
  }
  return paths as string[];
}

const fnIndexCache = new Map<string, Map<string, number>>();

/**
 * Resolve a named Gradio endpoint to its queue `fn_index` via the Space's
 * `/config` (dependencies array position). Cached per Space URL.
 *
 * The name is normalized to the documented leading-slash form, so the bare
 * form stored in `/config` (`gpu_wrapped_execute_video`) and the documented
 * form (`/gpu_wrapped_execute_video`) share one cache entry.
 */
export async function resolveSpaceFnIndex(
  fetchImpl: MediaProviderFetch,
  spaceUrl: string,
  apiName: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<number> {
  const normalized = apiName.startsWith('/') ? apiName : `/${apiName}`;
  const cached = fnIndexCache.get(spaceUrl)?.get(normalized);
  if (cached !== undefined) return cached;
  const response = await fetchImpl(`${spaceUrl}/config`, {
    method: 'GET',
    redirect: 'manual',
    headers,
    ...(signal ? { signal } : {}),
  });
  assertNotRedirected(response, PROVIDER_LABEL);
  if (!response.ok) {
    throw new Error(`${PROVIDER_LABEL} config lookup failed (${response.status})`);
  }
  const config = (await response.json().catch(() => null)) as {
    dependencies?: Array<{ api_name?: unknown }>;
  } | null;
  const dependencies = Array.isArray(config?.dependencies) ? config.dependencies : [];
  const fnIndex = dependencies.findIndex(
    (dep) => dep?.api_name === normalized || dep?.api_name === normalized.slice(1),
  );
  if (fnIndex < 0) {
    throw new Error(`${PROVIDER_LABEL} has no ${normalized} endpoint`);
  }
  let bySpace = fnIndexCache.get(spaceUrl);
  if (!bySpace) {
    bySpace = new Map();
    fnIndexCache.set(spaceUrl, bySpace);
  }
  bySpace.set(normalized, fnIndex);
  return fnIndex;
}

/** Clear the fn-index cache (tests). */
export function clearSpaceFnIndexCache(): void {
  fnIndexCache.clear();
}

function randomSessionHash(): string {
  return Array.from({ length: 11 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

interface QueueSseEvent {
  event: string;
  data: string[];
}

/**
 * Read Gradio 4 queue SSE events until `process_completed` (or an error).
 * Estimation/progress heartbeats are skipped; the completed output array is
 * returned parsed.
 */
export async function readQueueResultEvent(
  response: Response,
  providerLabel: string,
): Promise<unknown[]> {
  const body = response.body;
  if (!body) {
    throw new Error(`${providerLabel} returned an empty event stream`);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let current: QueueSseEvent = { event: '', data: [] };

  const dispatch = (): { done: boolean; payload?: unknown[] } => {
    const event = current.event;
    const raw = current.data.join('\n');
    current = { event: '', data: [] };
    if (event === 'process_completed' || event === 'complete') {
      try {
        const payload = JSON.parse(raw) as unknown;
        if (!Array.isArray(payload)) {
          throw new Error('not an array');
        }
        return { done: true, payload };
      } catch {
        throw new Error(`${providerLabel} returned an unreadable result payload`);
      }
    }
    if (event === 'error' || event === 'unexpected_error') {
      const detail = raw.trim();
      // Gradio answers queue pressure (busy Space, exhausted ZeroGPU quota)
      // with an empty payload (`data: null`) — surface that as a retryable
      // busy message instead of echoing "null".
      if (!detail || detail === 'null' || detail === '""' || detail === '[]') {
        throw new Error(
          `${providerLabel} reported an error with no details (the Space is likely busy or out of GPU quota — wait a moment and retry)`,
        );
      }
      throw new Error(`${providerLabel} reported an error: ${raw.slice(0, 300)}`);
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
          if (line.startsWith('event:')) {
            current.event = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            current.data.push(line.slice('data:'.length).trimStart());
          }
        }
        const terminal = dispatch();
        if (terminal.done) {
          await reader.cancel().catch(() => undefined);
          return terminal.payload ?? [];
        }
        boundary = buffer.indexOf('\n\n');
      }
      if (done) {
        if (current.event || current.data.length > 0) {
          const terminal = dispatch();
          if (terminal.done) return terminal.payload ?? [];
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
 * spending any GPU queue time.
 */
export async function testHuggingFaceVideoConnectivity(
  config: VideoGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  return testHuggingFaceLogin(config);
}

/**
 * Unwrap a Gradio video output into its downloadable file reference.
 *
 * The LivePortrait Space returns `VideoData` objects
 * (`{video: FileData, subtitles: null}` — see its `/info`), not bare
 * `FileData`. Accept both shapes so older mocks and future Spaces keep
 * working.
 */
export function resolveVideoOutputRef(output: unknown): unknown {
  if (output && typeof output === 'object' && 'video' in output) {
    const video = (output as { video?: unknown }).video;
    if (video && typeof video === 'object') return video;
  }
  return output;
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

/** Wrap an uploaded driving clip as the `VideoData` the Space expects. */
function gradioVideoData(path: string, filename: string, mime: string, size: number) {
  return {
    video: gradioFileData(path, filename, mime, size),
    subtitles: null,
  };
}

/**
 * Submit one Gradio 4 queue job and wait for its completed output array.
 * Shared by the three LivePortrait endpoints (video, image, square-check).
 */
async function submitQueueJob(
  fetchImpl: MediaProviderFetch,
  spaceUrl: string,
  fnIndex: number,
  data: unknown[],
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const sessionHash = randomSessionHash();
  const joinResponse = await fetchImpl(`${spaceUrl}/queue/join`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ data, event_data: null, fn_index: fnIndex, session_hash: sessionHash }),
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

  const streamResponse = await fetchImpl(`${spaceUrl}/queue/data?session_hash=${sessionHash}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'text/event-stream', ...headers },
    ...(signal ? { signal } : {}),
  });
  assertNotRedirected(streamResponse, PROVIDER_LABEL);
  if (!streamResponse.ok) {
    throw new Error(`${PROVIDER_LABEL} event stream failed (${streamResponse.status})`);
  }

  return readQueueResultEvent(streamResponse, PROVIDER_LABEL);
}

/** Resolve Space URL + auth for a LivePortrait call. */
function livePortraitRequest(
  config: VideoGenerationConfig,
  options?: { signal?: AbortSignal },
): {
  spaceUrl: string;
  fetchImpl: MediaProviderFetch;
  headers: Record<string, string>;
  signal?: AbortSignal;
} {
  const model = requireModel(config.model, 'Hugging Face LivePortrait');
  const spaceUrl = resolveSpaceUrl(
    config.baseUrl,
    model,
    HUGGINGFACE_LIVEPORTRAIT_DEFAULT_SPACE_URL,
  );
  return {
    spaceUrl,
    fetchImpl: mediaFetchFor(config),
    headers: huggingFaceAuthHeaders(config.apiKey),
    ...(options?.signal ? { signal: options.signal } : {}),
  };
}

export async function generateWithHuggingFaceVideo(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
): Promise<VideoGenerationResult> {
  const model = requireModel(config.model, 'Hugging Face LivePortrait');
  const spaceUrl = resolveSpaceUrl(
    config.baseUrl,
    model,
    HUGGINGFACE_LIVEPORTRAIT_DEFAULT_SPACE_URL,
  );
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
  const drivingVideoUrl =
    options.drivingVideoUrl?.trim() || HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL;
  const usingDefaultDriving = !options.drivingVideoUrl?.trim();

  const [source, driving] = await Promise.all([
    fetchBytesForUpload(config, sourceImageUrl, 'image', headers, signal),
    fetchBytesForUpload(config, drivingVideoUrl, 'video', headers, signal),
  ]);
  const sourceFilename = `source.${extensionFor(source.mime, 'image')}`;
  const drivingFilename = `driving.${extensionFor(driving.mime, 'video')}`;

  const [sourcePath, drivingPath] = await uploadFilesToSpace(
    fetchImpl,
    spaceUrl,
    [
      { bytes: source.bytes, filename: sourceFilename, mime: source.mime },
      { bytes: driving.bytes, filename: drivingFilename, mime: driving.mime },
    ],
    headers,
    signal,
  );

  // Parameter order follows the Space's `/gpu_wrapped_execute_video`
  // signature (param_0..param_4): source image FileData, driving video
  // VideoData, relative motion, do crop, paste-back. Flags default to true
  // per the API docs and are overridable via the generation options.
  const data = [
    gradioFileData(sourcePath, sourceFilename, source.mime, source.bytes.length),
    gradioVideoData(drivingPath, drivingFilename, driving.mime, driving.bytes.length),
    options.relativeMotion ?? true,
    options.doCrop ?? true,
    options.pasteBack ?? true,
  ];

  const fnIndex = await resolveSpaceFnIndex(
    fetchImpl,
    spaceUrl,
    LIVEPORTRAIT_ENDPOINTS.EXECUTE_VIDEO,
    headers,
    signal,
  );
  const outputs = await submitQueueJob(fetchImpl, spaceUrl, fnIndex, data, headers, signal);
  // The Space answers with `VideoData` (`{video: FileData, subtitles}`),
  // not a bare file ref — unwrap first, then resolve against the Gradio 4
  // `/file=` route (live payloads carry an absolute `url`, so the route
  // only matters for path-only fallbacks).
  const resolved = resolveGradioFileUrl(spaceUrl, resolveVideoOutputRef(outputs[0]), 'file=');
  if (!resolved) {
    throw new Error(`${PROVIDER_LABEL} returned no video data`);
  }

  return {
    url: resolved.url,
    // The source portrait doubles as the poster frame.
    poster: /^https?:\/\//i.test(sourceImageUrl) ? sourceImageUrl : undefined,
    width,
    height,
    // The bundled driving clip is ~3s; a custom driving video's length is
    // unknown until it plays, so the requested duration stands in for it.
    duration: usingDefaultDriving ? DEFAULT_DRIVING_DURATION_S : (options.duration ?? 5),
  };
}

export interface LivePortraitImageRetargetOptions {
  /** Source portrait (`https:` or `data:` URL) to retarget. */
  imageUrl: string;
  /**
   * Target eyes-open ratio (API docs Slider, numeric value between 0 and
   * 0.8). Defaults to 0 (no change).
   */
  eyesOpenRatio?: number;
  /**
   * Target lip-open ratio (API docs Slider, numeric value between 0 and
   * 0.8). Defaults to 0 (no change).
   */
  lipOpenRatio?: number;
  /** Crop the face before retargeting (API docs default: true). */
  doCrop?: boolean;
  /** Cancel server-side provider I/O. */
  signal?: AbortSignal;
}

export interface LivePortraitImageResult {
  /** Retargeted portrait (docs `value_3`). */
  url: string;
  /** Second output image (docs `value_4`, crop/debug preview). */
  previewUrl?: string;
}

function requireExpressionRatio(value: number | undefined, label: string): number {
  const ratio = value ?? 0;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 0.8) {
    throw new Error(
      `${PROVIDER_LABEL} needs ${label} between 0 and 0.8 (API docs Slider range), got ${String(value)}`,
    );
  }
  return ratio;
}

/**
 * Still-image expression retargeting via `/gpu_wrapped_execute_image`.
 *
 * Parameter order follows the API docs (param_0..param_3): target
 * eyes-open ratio, target lip-open ratio, source image FileData, do crop —
 * returning two images (`value_3`, `value_4`).
 */
export async function retargetLivePortraitImage(
  config: VideoGenerationConfig,
  options: LivePortraitImageRetargetOptions,
): Promise<LivePortraitImageResult> {
  const eyesOpenRatio = requireExpressionRatio(options.eyesOpenRatio, 'eyesOpenRatio');
  const lipOpenRatio = requireExpressionRatio(options.lipOpenRatio, 'lipOpenRatio');
  const imageUrl = options.imageUrl?.trim();
  if (!imageUrl) {
    throw new Error(`${PROVIDER_LABEL} needs an https: or data: URL image to retarget`);
  }
  const { spaceUrl, fetchImpl, headers, signal } = livePortraitRequest(config, options);
  const source = await fetchBytesForUpload(config, imageUrl, 'image', headers, signal);
  const filename = `source.${extensionFor(source.mime, 'image')}`;
  const [sourcePath] = await uploadFilesToSpace(
    fetchImpl,
    spaceUrl,
    [{ bytes: source.bytes, filename, mime: source.mime }],
    headers,
    signal,
  );
  const data = [
    eyesOpenRatio,
    lipOpenRatio,
    gradioFileData(sourcePath, filename, source.mime, source.bytes.length),
    options.doCrop ?? true,
  ];
  const fnIndex = await resolveSpaceFnIndex(
    fetchImpl,
    spaceUrl,
    LIVEPORTRAIT_ENDPOINTS.EXECUTE_IMAGE,
    headers,
    signal,
  );
  const outputs = await submitQueueJob(fetchImpl, spaceUrl, fnIndex, data, headers, signal);
  // Both outputs are bare FileData images (no VideoData unwrap needed).
  const first = resolveGradioFileUrl(spaceUrl, outputs[0], 'file=');
  if (!first) {
    throw new Error(`${PROVIDER_LABEL} returned no image data`);
  }
  const second = resolveGradioFileUrl(spaceUrl, outputs[1], 'file=');
  return { url: first.url, ...(second ? { previewUrl: second.url } : {}) };
}

/**
 * Driving-clip check via `/is_square_video`.
 *
 * Parameter follows the API docs: a single driving `VideoData`
 * (`video_path`) returning one video (`value_15`). The Space requires a 1:1
 * driving clip, so run a custom `drivingVideoUrl` through this before
 * animating to fail fast with the Space's own verdict instead of a cryptic
 * queue error from `/gpu_wrapped_execute_video`.
 */
export async function checkSquareVideoViaSpace(
  config: VideoGenerationConfig,
  videoUrl: string,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  const ref = videoUrl?.trim();
  if (!ref) {
    throw new Error(`${PROVIDER_LABEL} needs an https: or data: URL video to check`);
  }
  const { spaceUrl, fetchImpl, headers, signal: reqSignal } = livePortraitRequest(config, {
    ...(signal ? { signal } : {}),
  });
  const driving = await fetchBytesForUpload(config, ref, 'video', headers, reqSignal);
  const filename = `driving.${extensionFor(driving.mime, 'video')}`;
  const [drivingPath] = await uploadFilesToSpace(
    fetchImpl,
    spaceUrl,
    [{ bytes: driving.bytes, filename, mime: driving.mime }],
    headers,
    reqSignal,
  );
  const fnIndex = await resolveSpaceFnIndex(
    fetchImpl,
    spaceUrl,
    LIVEPORTRAIT_ENDPOINTS.IS_SQUARE_VIDEO,
    headers,
    reqSignal,
  );
  const outputs = await submitQueueJob(
    fetchImpl,
    spaceUrl,
    fnIndex,
    [gradioVideoData(drivingPath, filename, driving.mime, driving.bytes.length)],
    headers,
    reqSignal,
  );
  const resolved = resolveGradioFileUrl(spaceUrl, resolveVideoOutputRef(outputs[0]), 'file=');
  if (!resolved) {
    throw new Error(`${PROVIDER_LABEL} returned no video data`);
  }
  return { url: resolved.url };
}
