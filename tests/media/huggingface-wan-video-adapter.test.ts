/**
 * Hugging Face Wan 2.2 video adapter contract tests.
 *
 * Pins the Gradio 5+ sse_v3 flow (config → upload → join → queue/data),
 * the `/generate_video` positional data layout, and the source-image
 * requirement. `fetch` is stubbed, so nothing bills and no GPU queue time
 * is spent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearWanSpaceCallInfoCache,
  generateWithHuggingFaceWanVideo,
  HUGGINGFACE_WAN_DEFAULTS,
  HUGGINGFACE_WAN_MODEL,
  testHuggingFaceWanVideoConnectivity,
  uploadImageToWanSpace,
  WAN_GENERATE_VIDEO_ENDPOINT,
} from '@/lib/media/adapters/huggingface-wan-video-adapter';
import { mediaFetchFor } from '@/lib/media/media-fetch';

const SPACE = 'https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space';
const SOURCE = 'https://cdn.example/frame.jpg';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(payload: string, status = 200): Response {
  return new Response(payload, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function bytesResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
  });
}

function completedSse(videoRef: unknown, seed = 7): string {
  return (
    'data: {"msg":"estimation","rank":0}\n\n' +
    `data: {"msg":"process_completed","event_id":"evt-1","output":{"data":[${JSON.stringify(videoRef)},${seed}]},"success":true}\n\n`
  );
}

afterEach(() => {
  fetchMock.mockReset();
  clearWanSpaceCallInfoCache();
});

function configResponse(): Response {
  return jsonResponse({
    api_prefix: '/gradio_api',
    dependencies: [{ api_name: 'load_example' }, { api_name: 'generate_video' }],
  });
}

/** Full Space flow with an https source image. */
function mockWanFlow(videoRef: unknown): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${SPACE}/config`) return configResponse();
    if (url === SOURCE) return bytesResponse(new Uint8Array([1, 2, 3]), 'image/jpeg');
    if (url === `${SPACE}/gradio_api/upload`) return jsonResponse(['/tmp/gradio/abc/source.jpg']);
    if (url === `${SPACE}/gradio_api/queue/join`) return jsonResponse({ event_id: 'evt-1' });
    if (url.includes('/queue/data?session_hash=')) return sseResponse(completedSse(videoRef));
    throw new Error(`unexpected request: ${url}`);
  });
}

function joinBody(): Record<string, unknown> {
  const joinCall = fetchMock.mock.calls.find(([url]) => url === `${SPACE}/gradio_api/queue/join`);
  expect(joinCall).toBeDefined();
  return JSON.parse((joinCall![1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('generateWithHuggingFaceWanVideo', () => {
  it('resolves an absolute video URL and reports the requested duration', async () => {
    mockWanFlow({ url: `${SPACE}/gradio_api/file=/tmp/gradio/abc/out.mp4` });
    const result = await generateWithHuggingFaceWanVideo(
      { providerId: 'huggingface-video', apiKey: 'hf-test', model: HUGGINGFACE_WAN_MODEL },
      { prompt: 'a cat surfing', sourceImageUrl: SOURCE, duration: 4 },
    );
    expect(result.url).toBe(`${SPACE}/gradio_api/file=/tmp/gradio/abc/out.mp4`);
    expect(result.poster).toBe(SOURCE);
    expect(result.duration).toBe(4);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it('resolves a path-only fallback against the gradio_api file route', async () => {
    mockWanFlow({ path: '/tmp/gradio/abc/out.mp4' });
    const result = await generateWithHuggingFaceWanVideo(
      { providerId: 'huggingface-video', apiKey: 'hf-test', model: HUGGINGFACE_WAN_MODEL },
      { prompt: 'a cat surfing', sourceImageUrl: SOURCE },
    );
    expect(result.url).toBe(`${SPACE}/gradio_api/file=/tmp/gradio/abc/out.mp4`);
    // Unset duration falls back to the Space default.
    expect(result.duration).toBe(HUGGINGFACE_WAN_DEFAULTS.durationSeconds);
  });

  it('submits the /generate_video data in dependency order', async () => {
    mockWanFlow({ url: `${SPACE}/gradio_api/file=/tmp/gradio/abc/out.mp4` });
    await generateWithHuggingFaceWanVideo(
      { providerId: 'huggingface-video', apiKey: 'hf-test', model: HUGGINGFACE_WAN_MODEL },
      { prompt: 'make it move', sourceImageUrl: SOURCE },
    );
    const body = joinBody();
    expect(body.fn_index).toBe(1);
    const data = body.data as unknown[];
    // [image, prompt, steps, negative, duration, guidance, guidance2, seed, randomize]
    expect(data[1]).toBe('make it move');
    expect(data[2]).toBe(HUGGINGFACE_WAN_DEFAULTS.steps);
    expect(data[3]).toBe(HUGGINGFACE_WAN_DEFAULTS.negativePrompt);
    expect(data[4]).toBe(HUGGINGFACE_WAN_DEFAULTS.durationSeconds);
    expect(data[5]).toBe(1);
    expect(data[6]).toBe(1);
    expect(data[8]).toBe(true);
    const image = data[0] as { path?: unknown; meta?: unknown };
    expect(image.path).toBe('/tmp/gradio/abc/source.jpg');
    expect(image.meta).toMatchObject({ _type: 'gradio.FileData' });
  });

  it('clamps the duration to the Space slider range', async () => {
    mockWanFlow({ url: `${SPACE}/gradio_api/file=/tmp/gradio/abc/out.mp4` });
    await generateWithHuggingFaceWanVideo(
      { providerId: 'huggingface-video', apiKey: 'hf-test', model: HUGGINGFACE_WAN_MODEL },
      { prompt: 'a cat surfing', sourceImageUrl: SOURCE, duration: 30 },
    );
    const data = joinBody().data as unknown[];
    expect(data[4]).toBe(5);
  });

  it('requires a source image', async () => {
    await expect(
      generateWithHuggingFaceWanVideo(
        { providerId: 'huggingface-video', apiKey: 'hf-test', model: HUGGINGFACE_WAN_MODEL },
        { prompt: 'a cat surfing' },
      ),
    ).rejects.toThrow(/animates a source image/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the ZeroGPU quota refusal instead of a generic failure', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`) return configResponse();
      if (url === SOURCE) return bytesResponse(new Uint8Array([1, 2, 3]), 'image/jpeg');
      if (url === `${SPACE}/gradio_api/upload`) return jsonResponse(['/tmp/gradio/abc/source.jpg']);
      if (url === `${SPACE}/gradio_api/queue/join`) return jsonResponse({ event_id: 'evt-1' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse(
          'data: {"msg":"process_completed","event_id":"evt-1","output":{"error":"You have exceeded your ZeroGPU runs limit","title":"ZeroGPU quota exceeded"},"success":false}\n\n',
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    await expect(
      generateWithHuggingFaceWanVideo(
        { providerId: 'huggingface-video', apiKey: 'hf-test', model: HUGGINGFACE_WAN_MODEL },
        { prompt: 'a cat surfing', sourceImageUrl: SOURCE },
      ),
    ).rejects.toThrow(/ZeroGPU runs limit/);
  });

  it('throws a clear error for a Space without the endpoint', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`)
        return jsonResponse({ api_prefix: '/gradio_api', dependencies: [] });
      if (url === SOURCE) return bytesResponse(new Uint8Array([1, 2, 3]), 'image/jpeg');
      throw new Error(`unexpected request: ${url}`);
    });
    await expect(
      generateWithHuggingFaceWanVideo(
        { providerId: 'huggingface-video', apiKey: 'hf-test', model: HUGGINGFACE_WAN_MODEL },
        { prompt: 'a cat surfing', sourceImageUrl: SOURCE },
      ),
    ).rejects.toThrow(new RegExp(`has no ${WAN_GENERATE_VIDEO_ENDPOINT} endpoint`));
  });
});

describe('uploadImageToWanSpace', () => {
  it('posts multipart files under the api-prefixed upload route', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(['/tmp/gradio/abc/source.jpg']));
    const path = await uploadImageToWanSpace(
      mediaFetchFor({}),
      `${SPACE}/gradio_api`,
      new Uint8Array([1, 2, 3]),
      'source.jpg',
      'image/jpeg',
      {},
    );
    expect(path).toBe('/tmp/gradio/abc/source.jpg');
    expect(fetchMock).toHaveBeenCalledWith(
      `${SPACE}/gradio_api/upload`,
      expect.objectContaining({ method: 'POST', redirect: 'manual' }),
    );
  });
});

describe('testHuggingFaceWanVideoConnectivity', () => {
  it('validates the login without spending GPU queue time', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'tester' }));
    const result = await testHuggingFaceWanVideoConnectivity({
      providerId: 'huggingface-video',
      apiKey: 'hf-test',
      model: HUGGINGFACE_WAN_MODEL,
    });
    expect(result).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://huggingface.co/api/whoami-v2',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
