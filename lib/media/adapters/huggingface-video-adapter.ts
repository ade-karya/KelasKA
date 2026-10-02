/**
 * Hugging Face LivePortrait Video Generation Adapter
 *
 * Animates a previously generated image through the `KlingTeam/LivePortrait`
 * Gradio Space (Gradio 4.37, verified against the live Space's `/config` and
 * `app.py`): the `/gpu_wrapped_execute_video` endpoint takes a source
 * portrait plus a driving-motion video and returns animated videos.
 *
 * Protocol (plain `fetch`, no `gradio_client` dependency):
 * - Resolve:  GET  {space}/config → dependencies[].api_name →
 *             `gpu_wrapped_execute_video` fn_index
 * - Upload:   POST {space}/upload (multipart `files`) → [path, ...]
 * - Submit:   POST {space}/queue/join
 *             { data, event_data: null, fn_index, session_hash } → { event_id }
 * - Poll:     GET  {space}/queue/data?session_hash=... (SSE)
 *             → `process_completed` + `data: [videoFile, videoFileConcat]`
 *
 * Data layout follows the Space's API docs:
 *   [sourceImageFile, {video: drivingFile, subtitles: null},
 *    relative=true, crop=true, pasteBack=true]
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
 * Materialize an `https:`/`data:` reference into bytes for `/upload`.
 * `data:` URLs decode locally; remote URLs go through the pinned provider
 * transport (same SSRF posture as every other adapter download).
 */
async function fetchBytesForUpload(
  fetchImpl: MediaProviderFetch,
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
  const response = await fetchImpl(ref, {
    method: 'GET',
    redirect: 'manual',
    headers,
    ...(signal ? { signal } : {}),
  });
  assertNotRedirected(response, PROVIDER_LABEL);
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
 */
export async function resolveSpaceFnIndex(
  fetchImpl: MediaProviderFetch,
  spaceUrl: string,
  apiName: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<number> {
  const cached = fnIndexCache.get(spaceUrl)?.get(apiName);
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
    (dep) => dep?.api_name === apiName || dep?.api_name === `/${apiName}`,
  );
  if (fnIndex < 0) {
    throw new Error(`${PROVIDER_LABEL} has no /${apiName} endpoint`);
  }
  let bySpace = fnIndexCache.get(spaceUrl);
  if (!bySpace) {
    bySpace = new Map();
    fnIndexCache.set(spaceUrl, bySpace);
  }
  bySpace.set(apiName, fnIndex);
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

export async function generateWithHuggingFaceVideo(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
): Promise<VideoGenerationResult> {
  const model = requireModel(config.model, 'Hugging Face LivePortrait');
  const spaceUrl = resolveSpaceUrl(config.baseUrl, model, '');
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
    fetchBytesForUpload(fetchImpl, sourceImageUrl, 'image', headers, signal),
    fetchBytesForUpload(fetchImpl, drivingVideoUrl, 'video', headers, signal),
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
  // signature: source image, driving video, relative motion, crop,
  // paste-back.
  const data = [
    gradioFileData(sourcePath, sourceFilename, source.mime, source.bytes.length),
    {
      video: gradioFileData(drivingPath, drivingFilename, driving.mime, driving.bytes.length),
      subtitles: null,
    },
    true,
    true,
    true,
  ];

  const fnIndex = await resolveSpaceFnIndex(
    fetchImpl,
    spaceUrl,
    'gpu_wrapped_execute_video',
    headers,
    signal,
  );
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

  const outputs = await readQueueResultEvent(streamResponse, PROVIDER_LABEL);
  const resolved = resolveGradioFileUrl(spaceUrl, outputs[0]);
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
