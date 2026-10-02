/**
 * Hugging Face LivePortrait video adapter contract tests.
 *
 * Pins the Gradio 4 queue flow (config → upload → join → SSE), the
 * `/gpu_wrapped_execute_video` data layout, and the source-image requirement.
 * `fetch` is stubbed, so nothing bills and no GPU queue time is spent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSpaceFnIndexCache,
  generateWithHuggingFaceVideo,
  HUGGINGFACE_LIVEPORTRAIT_DEFAULT_DRIVING_URL,
  HUGGINGFACE_LIVEPORTRAIT_MODEL,
  readQueueResultEvent,
  resolveSpaceFnIndex,
  testHuggingFaceVideoConnectivity,
  uploadFilesToSpace,
} from '@/lib/media/adapters/huggingface-video-adapter';
import { mediaFetchFor } from '@/lib/media/media-fetch';

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
});
