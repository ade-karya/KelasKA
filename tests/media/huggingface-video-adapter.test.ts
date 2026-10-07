/**
 * Hugging Face Video Gen video adapter contract tests.
 *
 * Pins the Gradio 4 queue flow (config → upload → join → SSE), the
 * `/gpu_wrapped_execute_video` data layout, and the source-image requirement.
 * `fetch` is stubbed, so nothing bills and no GPU queue time is spent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkSquareVideoViaSpace,
  clearSpaceFnIndexCache,
  generateWithHuggingFaceVideo,
  headersForInputDownload,
  HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL,
  HUGGINGFACE_LIVEPORTRAIT_MODEL,
  LIVEPORTRAIT_ENDPOINTS,
  readQueueResultEvent,
  resolveSpaceFnIndex,
  resolveVideoOutputRef,
  retargetLivePortraitImage,
  testHuggingFaceVideoConnectivity,
  uploadFilesToSpace,
} from '@/lib/media/adapters/huggingface-video-adapter';
import { mediaFetchFor } from '@/lib/media/media-fetch';
import { resolveGradioFileUrl } from '@/lib/media/adapters/huggingface-common';

const SPACE = 'https://klingteam-liveportrait.hf.space';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
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
    headers: { 'content-type': contentType },
  });
}

afterEach(() => {
  fetchMock.mockReset();
  clearSpaceFnIndexCache();
});

function configResponse(): Response {
  return jsonResponse({
    dependencies: [{ api_name: 'load_example' }, { api_name: '/gpu_wrapped_execute_video' }],
  });
}

/** Full Space flow with an https source image and the default driving clip. */
function mockLivePortraitFlow() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${SPACE}/config`) return configResponse();
    if (url.endsWith('/upload'))
      return jsonResponse(['/tmp/gradio/abc/source.jpg', '/tmp/gradio/abc/d.mp4']);
    if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'evt-9' });
    if (url.includes('/queue/data?session_hash=')) {
      return sseResponse(
        'event: estimation\ndata: {"rank": 3}\n\n' +
          'event: process_completed\ndata: [{"url": "/file=/tmp/gradio/abc/out.mp4", "mime_type": "video/mp4"}, {"url": "/file=/tmp/gradio/abc/out_concat.mp4"}]\n\n',
      );
    }
    if (url === 'https://cdn.example/portrait.jpg') {
      return bytesResponse(new Uint8Array([1, 2, 3]), 'image/jpeg');
    }
    if (url === HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL) {
      return bytesResponse(new Uint8Array([4, 5, 6]), 'video/mp4');
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

describe('resolveSpaceFnIndex', () => {
  it('maps the named endpoint to its dependencies position', async () => {
    fetchMock.mockResolvedValueOnce(configResponse());
    const fnIndex = await resolveSpaceFnIndex(
      mediaFetchFor({}),
      SPACE,
      'gpu_wrapped_execute_video',
      {},
    );
    expect(fnIndex).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${SPACE}/config`,
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('caches the lookup per Space', async () => {
    fetchMock.mockResolvedValue(configResponse());
    await resolveSpaceFnIndex(mediaFetchFor({}), SPACE, 'gpu_wrapped_execute_video', {});
    await resolveSpaceFnIndex(mediaFetchFor({}), SPACE, 'gpu_wrapped_execute_video', {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error for an unknown endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ dependencies: [] }));
    await expect(resolveSpaceFnIndex(mediaFetchFor({}), SPACE, 'nope', {})).rejects.toThrow(
      /has no \/nope endpoint/,
    );
  });

  it('treats the bare and documented slash-prefixed names as one endpoint', async () => {
    fetchMock.mockResolvedValue(configResponse());
    const bare = await resolveSpaceFnIndex(
      mediaFetchFor({}),
      SPACE,
      'gpu_wrapped_execute_video',
      {},
    );
    const slashed = await resolveSpaceFnIndex(
      mediaFetchFor({}),
      SPACE,
      '/gpu_wrapped_execute_video',
      {},
    );
    expect(bare).toBe(1);
    expect(slashed).toBe(1);
    // One shared cache entry: a single /config fetch for both forms.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes the documented endpoint names', () => {
    expect(LIVEPORTRAIT_ENDPOINTS).toEqual({
      EXECUTE_IMAGE: '/gpu_wrapped_execute_image',
      EXECUTE_VIDEO: '/gpu_wrapped_execute_video',
      IS_SQUARE_VIDEO: '/is_square_video',
    });
  });
});

describe('uploadFilesToSpace', () => {
  it('posts multipart files and returns server paths in order', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(['/tmp/a.png', '/tmp/b.mp4']));
    const paths = await uploadFilesToSpace(
      mediaFetchFor({}),
      SPACE,
      [
        { bytes: new Uint8Array([1]), filename: 'source.jpg', mime: 'image/jpeg' },
        { bytes: new Uint8Array([2]), filename: 'driving.mp4', mime: 'video/mp4' },
      ],
      { Authorization: 'Bearer hf-test' },
    );
    expect(paths).toEqual(['/tmp/a.png', '/tmp/b.mp4']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SPACE}/upload`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hf-test');
    const files = (init.body as FormData).getAll('files') as File[];
    expect(files.map((f) => f.name)).toEqual(['source.jpg', 'driving.mp4']);
  });

  it('rejects an unexpected upload response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ wrong: 'shape' }));
    await expect(
      uploadFilesToSpace(
        mediaFetchFor({}),
        SPACE,
        [{ bytes: new Uint8Array([1]), filename: 'source.jpg', mime: 'image/jpeg' }],
        {},
      ),
    ).rejects.toThrow(/unexpected response/);
  });
});

describe('readQueueResultEvent', () => {
  it('skips heartbeats and returns the completed output array', async () => {
    const outputs = await readQueueResultEvent(
      sseResponse(
        'event: estimation\ndata: {"rank": 1}\n\nevent: process_completed\ndata: [[{"url": "https://x/v.mp4"}]]\n\n',
      ),
      'X',
    );
    expect(outputs).toEqual([[{ url: 'https://x/v.mp4' }]]);
  });

  it('throws a readable error for queue error events', async () => {
    await expect(
      readQueueResultEvent(sseResponse('event: error\ndata: "GPU quota exceeded"\n\n'), 'X'),
    ).rejects.toThrow(/GPU quota exceeded/);
  });

  it('throws when the stream closes without a result', async () => {
    await expect(readQueueResultEvent(sseResponse(''), 'X')).rejects.toThrow(/without a result/);
  });
});

describe('testHuggingFaceVideoConnectivity (login probe)', () => {
  it('shares the Hugging Face login check', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'octocat' }));
    const result = await testHuggingFaceVideoConnectivity({
      providerId: 'huggingface-video',
      apiKey: 'hf-test',
      model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
    });
    expect(result).toEqual({
      success: true,
      message: 'Connected to Hugging Face (@octocat)',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://huggingface.co/api/whoami-v2',
      expect.objectContaining({ headers: { Authorization: 'Bearer hf-test' } }),
    );
  });

  it('refuses an empty token without any request', async () => {
    const result = await testHuggingFaceVideoConnectivity({
      providerId: 'huggingface-video',
      apiKey: '',
      model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
    });
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('generateWithHuggingFaceVideo', () => {
  it('animates the source image with the default driving clip', async () => {
    mockLivePortraitFlow();
    const result = await generateWithHuggingFaceVideo(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
      },
      { prompt: 'portrait smiles', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
    );

    expect(result.url).toBe(`${SPACE}/file=/tmp/gradio/abc/out.mp4`);
    expect(result.poster).toBe('https://cdn.example/portrait.jpg');
    expect(result.duration).toBe(3);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);

    const joinCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith('/queue/join'),
    ) as unknown as [string, RequestInit];
    expect(joinCall).toBeDefined();
    const joinBody = JSON.parse(joinCall[1].body as string);
    expect(joinBody.fn_index).toBe(1);
    expect(typeof joinBody.session_hash).toBe('string');
    // Data layout follows /gpu_wrapped_execute_video: source, driving, flags.
    expect(joinBody.data[0]).toMatchObject({
      path: '/tmp/gradio/abc/source.jpg',
      meta: { _type: 'gradio.FileData' },
    });
    expect(joinBody.data[1]).toMatchObject({
      video: { path: '/tmp/gradio/abc/d.mp4' },
      subtitles: null,
    });
    expect(joinBody.data.slice(2)).toEqual([true, true, true]);
    expect((joinCall[1].headers as Record<string, string>).Authorization).toBe('Bearer hf-test');

    const pollCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).includes('/queue/data?session_hash='),
    ) as unknown as [string, RequestInit];
    expect(pollCall).toBeDefined();
    expect(pollCall[0]).toContain(joinBody.session_hash);
  });

  it('accepts a data: URL source image without a download', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('data:')) {
        const b64 = url.split(',')[1] ?? '';
        return bytesResponse(new Uint8Array(Buffer.from(b64, 'base64')), 'image/png');
      }
      if (url === `${SPACE}/config`) return configResponse();
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/s.png', '/tmp/d.mp4']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'e' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse('event: process_completed\ndata: [{"url": "/file=/tmp/o.mp4"}]\n\n');
      }
      if (url === HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL) {
        return bytesResponse(new Uint8Array([9]), 'video/mp4');
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await generateWithHuggingFaceVideo(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
      },
      {
        prompt: 'x',
        aspectRatio: '1:1',
        sourceImageUrl: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
      },
    );
    expect(result.url).toBe(`${SPACE}/file=/tmp/o.mp4`);
    // A data: source is not reused as poster (persist layers expect URLs).
    expect(result.poster).toBeUndefined();
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it('honors a custom driving video and echoes the requested duration', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`) return configResponse();
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/s.jpg', '/tmp/custom.mp4']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'e' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse('event: process_completed\ndata: [{"url": "/file=/tmp/o.mp4"}]\n\n');
      }
      if (url === 'https://cdn.example/portrait.jpg') {
        return bytesResponse(new Uint8Array([1]), 'image/jpeg');
      }
      if (url === 'https://cdn.example/motion.mp4') {
        return bytesResponse(new Uint8Array([2]), 'video/mp4');
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await generateWithHuggingFaceVideo(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
      },
      {
        prompt: 'x',
        duration: 8,
        sourceImageUrl: 'https://cdn.example/portrait.jpg',
        drivingVideoUrl: 'https://cdn.example/motion.mp4',
      },
    );
    expect(result.duration).toBe(8);
    const uploadCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith('/upload'),
    ) as unknown as [string, RequestInit];
    const files = (uploadCall[1].body as FormData).getAll('files') as File[];
    expect(files.map((f) => f.name)).toEqual(['source.jpg', 'driving.mp4']);
  });

  it('forwards LivePortrait motion flags (docs defaults stay true)', async () => {
    mockLivePortraitFlow();
    await generateWithHuggingFaceVideo(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
      },
      {
        prompt: 'x',
        sourceImageUrl: 'https://cdn.example/portrait.jpg',
        relativeMotion: false,
        doCrop: false,
        pasteBack: false,
      },
    );
    const joinCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith('/queue/join'),
    ) as unknown as [string, RequestInit];
    const joinBody = JSON.parse(joinCall[1].body as string);
    // param_2..param_4 per the API docs: relative motion, do crop, paste-back.
    expect(joinBody.data.slice(2)).toEqual([false, false, false]);
  });

  it('fails loud without a source image', async () => {
    await expect(
      generateWithHuggingFaceVideo(
        {
          providerId: 'huggingface-video',
          apiKey: 'hf-test',
          model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        },
        { prompt: 'a smile' },
      ),
    ).rejects.toThrow(/animates a source image/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an explicit model', async () => {
    await expect(
      generateWithHuggingFaceVideo(
        { providerId: 'huggingface-video', apiKey: 'hf-test' },
        { prompt: 'x', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
      ),
    ).rejects.toThrow(/requires a model/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a rejected token with its status', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`) return configResponse();
      if (url.endsWith('/upload')) {
        return new Response('unauthorized', { status: 401 });
      }
      if (url === 'https://cdn.example/portrait.jpg') {
        return bytesResponse(new Uint8Array([1]), 'image/jpeg');
      }
      if (url === HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL) {
        return bytesResponse(new Uint8Array([2]), 'video/mp4');
      }
      throw new Error(`unexpected request: ${url}`);
    });
    await expect(
      generateWithHuggingFaceVideo(
        {
          providerId: 'huggingface-video',
          apiKey: 'hf-bad',
          model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        },
        { prompt: 'x', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
      ),
    ).rejects.toThrow(/\(401\)/);
  });

  it('throws when the Space returns no video data', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`) return configResponse();
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/s.jpg', '/tmp/d.mp4']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'e' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse('event: process_completed\ndata: [null]\n\n');
      }
      if (url.startsWith('https://')) {
        return bytesResponse(
          new Uint8Array([1]),
          url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    await expect(
      generateWithHuggingFaceVideo(
        {
          providerId: 'huggingface-video',
          apiKey: 'hf-test',
          model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        },
        { prompt: 'x', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
      ),
    ).rejects.toThrow(/no video data/i);
  });

  it('refuses a redirected download on the strict transport', async () => {
    // No downloadFetchImpl: the bundled driving clip lives behind a redirect
    // and must fail with the redirect message rather than silently following
    // it with credentials.
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://cdn.example/portrait.jpg') {
        return bytesResponse(new Uint8Array([1]), 'image/jpeg');
      }
      if (url === HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL) {
        return new Response('redirect', {
          status: 302,
          headers: { Location: 'https://cdn.example/d0.mp4' },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    await expect(
      generateWithHuggingFaceVideo(
        {
          providerId: 'huggingface-video',
          apiKey: 'hf-test',
          model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        },
        { prompt: 'x', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
      ),
    ).rejects.toThrow(/Redirects are not allowed/);
  });

  it('downloads inputs through downloadFetchImpl when injected', async () => {
    // Server callers inject the redirect-following download transport, which
    // is what fetches the redirect-backed default driving clip.
    const downloadMock = vi.fn(async (url: string) => {
      if (url === 'https://cdn.example/portrait.jpg') {
        return bytesResponse(new Uint8Array([1]), 'image/jpeg');
      }
      if (url === HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL) {
        return bytesResponse(new Uint8Array([2]), 'video/mp4');
      }
      throw new Error(`unexpected download: ${url}`);
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`) return configResponse();
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/s.jpg', '/tmp/d.mp4']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'e' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse('event: process_completed\ndata: [{"url": "/file=/tmp/o.mp4"}]\n\n');
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await generateWithHuggingFaceVideo(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        downloadFetchImpl: downloadMock,
      },
      { prompt: 'x', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
    );

    expect(result.url).toBe(`${SPACE}/file=/tmp/o.mp4`);
    expect(downloadMock).toHaveBeenCalledWith(
      'https://cdn.example/portrait.jpg',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(downloadMock).toHaveBeenCalledWith(
      HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL,
      expect.objectContaining({ method: 'GET' }),
    );
    // The strict transport never touches the redirect-backed inputs.
    const strictUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(strictUrls).not.toContain('https://cdn.example/portrait.jpg');
    expect(strictUrls).not.toContain(HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL);
  });

  it('resolves the live VideoData output shape ({video: FileData})', async () => {
    // The live Space answers /gpu_wrapped_execute_video with VideoData
    // objects, not bare file refs (verified against its /info).
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`) return configResponse();
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/s.jpg', '/tmp/d.mp4']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'e' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse(
          'event: process_completed\ndata: [' +
            '{"video": {"url": "/file=/tmp/gradio/abc/out.mp4", "mime_type": "video/mp4"}, "subtitles": null}, ' +
            '{"video": {"url": "/file=/tmp/gradio/abc/out_concat.mp4"}, "subtitles": null}]\n\n',
        );
      }
      if (url.startsWith('https://')) {
        return bytesResponse(
          new Uint8Array([1]),
          url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await generateWithHuggingFaceVideo(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        downloadFetchImpl: async (dlUrl: string) =>
          bytesResponse(
            new Uint8Array([1]),
            dlUrl.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
          ),
      },
      { prompt: 'x', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
    );
    expect(result.url).toBe(`${SPACE}/file=/tmp/gradio/abc/out.mp4`);
  });

  it('keeps the HF token off third-party input hosts', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const downloadMock = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
      return bytesResponse(
        new Uint8Array([1]),
        url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
      );
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`) return configResponse();
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/s.jpg', '/tmp/d.mp4']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'e' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse('event: process_completed\ndata: [{"url": "/file=/tmp/o.mp4"}]\n\n');
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await generateWithHuggingFaceVideo(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        downloadFetchImpl: downloadMock,
      },
      { prompt: 'x', sourceImageUrl: 'https://cdn.example/portrait.jpg' },
    );

    const portrait = seen.find((s) => s.url === 'https://cdn.example/portrait.jpg');
    const driving = seen.find((s) => s.url === HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL);
    expect(portrait).toBeDefined();
    expect(portrait?.headers.Authorization).toBeUndefined();
    // The bundled driving clip lives on huggingface.co: same issuer, token kept.
    expect(driving?.headers.Authorization).toBe('Bearer hf-test');
  });

  it('answers an empty queue error with a busy message, not "null"', async () => {
    await expect(
      readQueueResultEvent(sseResponse('event: error\ndata: null\n\n'), 'X'),
    ).rejects.toThrow(/busy or out of GPU quota/);
  });
});

describe('retargetLivePortraitImage (/gpu_wrapped_execute_image)', () => {
  function mockImageFlow() {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`)
        return jsonResponse({
          dependencies: [{ api_name: 'gpu_wrapped_execute_image' }],
        });
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/gradio/abc/source.jpg']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'evt-img' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse(
          'event: process_completed\ndata: [{"url": "/file=/tmp/gradio/abc/retarget.jpg"}, {"url": "/file=/tmp/gradio/abc/retarget_crop.jpg"}]\n\n',
        );
      }
      if (url === 'https://cdn.example/portrait.jpg') {
        return bytesResponse(new Uint8Array([1, 2, 3]), 'image/jpeg');
      }
      throw new Error(`unexpected request: ${url}`);
    });
  }

  it('sends the documented param_0..param_3 layout and returns both images', async () => {
    mockImageFlow();
    const result = await retargetLivePortraitImage(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
      },
      {
        imageUrl: 'https://cdn.example/portrait.jpg',
        eyesOpenRatio: 0.2,
        lipOpenRatio: 0.4,
        doCrop: true,
      },
    );
    expect(result.url).toBe(`${SPACE}/file=/tmp/gradio/abc/retarget.jpg`);
    expect(result.previewUrl).toBe(`${SPACE}/file=/tmp/gradio/abc/retarget_crop.jpg`);

    const joinCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith('/queue/join'),
    ) as unknown as [string, RequestInit];
    const joinBody = JSON.parse(joinCall[1].body as string);
    expect(joinBody.fn_index).toBe(0);
    // param_0 eyes ratio, param_1 lip ratio, param_2 FileData image, param_3 do crop.
    expect(joinBody.data[0]).toBe(0.2);
    expect(joinBody.data[1]).toBe(0.4);
    expect(joinBody.data[2]).toMatchObject({
      path: '/tmp/gradio/abc/source.jpg',
      meta: { _type: 'gradio.FileData' },
    });
    expect(joinBody.data[3]).toBe(true);
  });

  it('rejects ratios outside the documented 0..0.8 Slider range', async () => {
    await expect(
      retargetLivePortraitImage(
        {
          providerId: 'huggingface-video',
          apiKey: 'hf-test',
          model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
        },
        { imageUrl: 'https://cdn.example/portrait.jpg', eyesOpenRatio: 0.9 },
      ),
    ).rejects.toThrow(/between 0 and 0\.8/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('checkSquareVideoViaSpace (/is_square_video)', () => {
  it('submits a single VideoData param and resolves the video output', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${SPACE}/config`)
        return jsonResponse({ dependencies: [{ api_name: 'is_square_video' }] });
      if (url.endsWith('/upload')) return jsonResponse(['/tmp/gradio/abc/d.mp4']);
      if (url.endsWith('/queue/join')) return jsonResponse({ event_id: 'evt-sq' });
      if (url.includes('/queue/data?session_hash=')) {
        return sseResponse(
          'event: process_completed\ndata: [{"video": {"url": "/file=/tmp/gradio/abc/square.mp4"}, "subtitles": null}]\n\n',
        );
      }
      if (url === 'https://cdn.example/motion.mp4') {
        return bytesResponse(new Uint8Array([7, 8]), 'video/mp4');
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const result = await checkSquareVideoViaSpace(
      {
        providerId: 'huggingface-video',
        apiKey: 'hf-test',
        model: HUGGINGFACE_LIVEPORTRAIT_MODEL,
      },
      'https://cdn.example/motion.mp4',
    );
    expect(result.url).toBe(`${SPACE}/file=/tmp/gradio/abc/square.mp4`);
    const joinCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith('/queue/join'),
    ) as unknown as [string, RequestInit];
    const joinBody = JSON.parse(joinCall[1].body as string);
    expect(joinBody.fn_index).toBe(0);
    expect(joinBody.data).toHaveLength(1);
    expect(joinBody.data[0]).toMatchObject({
      video: { path: '/tmp/gradio/abc/d.mp4' },
      subtitles: null,
    });
  });
});

describe('resolveVideoOutputRef', () => {
  it('unwraps VideoData ({video: FileData})', () => {
    const inner = { url: '/file=/tmp/o.mp4' };
    expect(resolveVideoOutputRef({ video: inner, subtitles: null })).toBe(inner);
  });

  it('passes bare file refs through', () => {
    const ref = { url: '/file=/tmp/o.mp4' };
    expect(resolveVideoOutputRef(ref)).toBe(ref);
    expect(resolveVideoOutputRef(null)).toBeNull();
  });
});

describe('headersForInputDownload', () => {
  const auth = { Authorization: 'Bearer hf-test' };

  it('keeps the token on Hugging Face hosts', () => {
    expect(
      headersForInputDownload('https://huggingface.co/spaces/x/resolve/main/d0.mp4', auth),
    ).toEqual(auth);
    expect(
      headersForInputDownload('https://klingteam-liveportrait.hf.space/file=/tmp/x.mp4', auth),
    ).toEqual(auth);
  });

  it('drops the token on third-party hosts', () => {
    expect(headersForInputDownload('https://cdn.example/portrait.jpg', auth)).toEqual({});
    expect(headersForInputDownload('not a url', auth)).toEqual({});
  });
});

describe('resolveGradioFileUrl file routes', () => {
  it('resolves path-only refs against the Gradio 4 /file= route for LivePortrait', () => {
    expect(resolveGradioFileUrl(SPACE, { path: '/tmp/gradio/abc/out.mp4' }, 'file=')).toEqual({
      url: `${SPACE}/file=/tmp/gradio/abc/out.mp4`,
      mimeType: undefined,
    });
  });

  it('keeps the Gradio 5 default route for FLUX-style Spaces', () => {
    const flux = 'https://black-forest-labs-flux-1-dev.hf.space';
    expect(resolveGradioFileUrl(flux, { path: '/tmp/gradio/abc/out.png' })).toEqual({
      url: `${flux}/gradio_api/file=/tmp/gradio/abc/out.png`,
      mimeType: undefined,
    });
  });
});
