/**
 * Hugging Face FLUX image adapter contract tests.
 *
 * Pins the Gradio `/infer` request shape (parameter order matters), the SSE
 * result parsing, and the login probe. `fetch` is stubbed, so nothing bills
 * and no queue time is spent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearFluxSpaceCallInfoCache,
  generateWithHuggingFaceImage,
  huggingFaceSpaceUrl,
  readGradioResultEvent,
  resolveGradioFileUrl,
  testHuggingFaceImageConnectivity,
} from '@/lib/media/adapters/huggingface-image-adapter';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
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

afterEach(() => {
  fetchMock.mockReset();
  clearFluxSpaceCallInfoCache();
});

describe('huggingFaceSpaceUrl', () => {
  it('derives the Space host from the default model id', () => {
    expect(huggingFaceSpaceUrl(undefined, 'black-forest-labs/FLUX.1-dev')).toBe(
      'https://black-forest-labs-flux-1-dev.hf.space',
    );
  });

  it('prefers an explicit Base URL and trims a pasted API suffix', () => {
    expect(
      huggingFaceSpaceUrl(
        'https://black-forest-labs-flux-1-dev.hf.space/gradio_api/call/infer',
        'black-forest-labs/FLUX.1-dev',
      ),
    ).toBe('https://black-forest-labs-flux-1-dev.hf.space');
  });
});

describe('resolveGradioFileUrl', () => {
  const space = 'https://black-forest-labs-flux-1-dev.hf.space';

  it('keeps absolute string refs as-is', () => {
    expect(resolveGradioFileUrl(space, 'https://cdn.example/img.png')).toEqual({
      url: 'https://cdn.example/img.png',
    });
  });

  it('resolves relative object urls against the Space', () => {
    expect(
      resolveGradioFileUrl(space, {
        url: '/gradio_api/file=/tmp/gradio/abc/image.png',
        mime_type: 'image/png',
      }),
    ).toEqual({
      url: 'https://black-forest-labs-flux-1-dev.hf.space/gradio_api/file=/tmp/gradio/abc/image.png',
      mimeType: 'image/png',
    });
  });

  it('falls back to path when no url is reported', () => {
    expect(resolveGradioFileUrl(space, { path: '/tmp/gradio/abc/image.png' })).toEqual({
      url: 'https://black-forest-labs-flux-1-dev.hf.space/gradio_api/file=/tmp/gradio/abc/image.png',
      mimeType: undefined,
    });
  });

  it('returns null for unusable refs', () => {
    expect(resolveGradioFileUrl(space, null)).toBeNull();
    expect(resolveGradioFileUrl(space, {})).toBeNull();
  });
});

describe('readGradioResultEvent', () => {
  it('skips interim generating events and returns the complete payload', async () => {
    const payload = await readGradioResultEvent(
      sseResponse(
        'event: generating\ndata: [null]\n\n' +
          'event: complete\ndata: [[{"url": "https://x/img.png"}], 7]\n\n',
      ),
      'Hugging Face Image',
    );
    expect(payload).toEqual([[{ url: 'https://x/img.png' }], 7]);
  });

  it('throws a readable error for error events without leaking internals', async () => {
    await expect(
      readGradioResultEvent(sseResponse('event: error\ndata: ["queue full"]\n\n'), 'X'),
    ).rejects.toThrow(/queue full/);
  });

  it('answers an empty error payload with a busy message, not "null"', async () => {
    await expect(
      readGradioResultEvent(sseResponse('event: error\ndata: null\n\n'), 'Hugging Face Image'),
    ).rejects.toThrow(/busy or out of GPU quota/);
  });

  it('throws when the stream closes without a result', async () => {
    await expect(readGradioResultEvent(sseResponse(''), 'Hugging Face Image')).rejects.toThrow(
      /without a result/,
    );
  });
});

describe('testHuggingFaceImageConnectivity (login probe)', () => {
  it('refuses an empty token without any request', async () => {
    const result = await testHuggingFaceImageConnectivity({
      providerId: 'huggingface-image',
      apiKey: '',
      model: 'black-forest-labs/FLUX.1-dev',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/token is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the logged-in account on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'octocat' }));
    const result = await testHuggingFaceImageConnectivity({
      providerId: 'huggingface-image',
      apiKey: 'hf-test',
      model: 'black-forest-labs/FLUX.1-dev',
    });
    expect(result).toEqual({
      success: true,
      message: 'Connected to Hugging Face (@octocat)',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://huggingface.co/api/whoami-v2',
      expect.objectContaining({
        headers: { Authorization: 'Bearer hf-test' },
      }),
    );
  });

  it('answers a 401 with a fixed login message, never the body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad token', { status: 401 }));
    const result = await testHuggingFaceImageConnectivity({
      providerId: 'huggingface-image',
      apiKey: 'hf-bad',
      model: 'black-forest-labs/FLUX.1-dev',
    });
    expect(result).toEqual({
      success: false,
      message:
        'Invalid Hugging Face token (401). Log in with Hugging Face and paste a fresh access token (hf_...).',
    });
  });

  it('answers a network error with a fixed message', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const result = await testHuggingFaceImageConnectivity({
      providerId: 'huggingface-image',
      apiKey: 'hf-test',
      model: 'black-forest-labs/FLUX.1-dev',
    });
    expect(result).toEqual({
      success: false,
      message:
        'Hugging Face connectivity error: cannot reach the provider, please check the Base URL',
    });
  });
});

describe('generateWithHuggingFaceImage', () => {
  function mockGradioFlow() {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/config')) {
        return jsonResponse({ dependencies: [{ api_name: 'infer' }] });
      }
      if (url.endsWith('/gradio_api/queue/join')) {
        return jsonResponse({ event_id: 'evt-1' });
      }
      if (url.includes('/gradio_api/queue/data?session_hash=')) {
        return sseResponse(
          'data: {"msg":"estimation","event_id":"evt-1","rank":0,"queue_size":1}\n\n' +
            'data: {"msg":"process_starts","event_id":"evt-1"}\n\n' +
            'data: {"msg":"process_completed","event_id":"evt-1","output":{"data":[{"url": "/gradio_api/file=/tmp/gradio/abc/out.png", "mime_type": "image/png"}, 123]},"success":true}\n\n' +
            'data: {"msg":"close_stream","event_id":null}\n\n',
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
  }

  it('posts the /infer parameters in order and returns the Space file URL', async () => {
    mockGradioFlow();
    const result = await generateWithHuggingFaceImage(
      {
        providerId: 'huggingface-image',
        apiKey: 'hf-test',
        model: 'black-forest-labs/FLUX.1-dev',
      },
      { prompt: 'a fox', aspectRatio: '16:9' },
    );

    expect(result.url).toBe(
      'https://black-forest-labs-flux-1-dev.hf.space/gradio_api/file=/tmp/gradio/abc/out.png',
    );
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);

    const [joinUrl, joinInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(joinUrl).toBe('https://black-forest-labs-flux-1-dev.hf.space/gradio_api/queue/join');
    expect((joinInit.headers as Record<string, string>).Authorization).toBe('Bearer hf-test');
    // Parameter order follows the Space's /infer signature.
    expect(JSON.parse(joinInit.body as string)).toMatchObject({
      data: ['a fox', 0, true, 1280, 720, 3.5, 28],
    });

    const [dataUrl, dataInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(String(dataUrl)).toContain('https://black-forest-labs-flux-1-dev.hf.space/gradio_api/queue/data?session_hash=');
    expect((dataInit.headers as Record<string, string>).Authorization).toBe('Bearer hf-test');
  });

  it('forwards caller /infer overrides keeping the parameter order', async () => {
    mockGradioFlow();
    const result = await generateWithHuggingFaceImage(
      {
        providerId: 'huggingface-image',
        apiKey: 'hf-test',
        model: 'black-forest-labs/FLUX.1-dev',
      },
      {
        prompt: 'a fox',
        width: 512,
        height: 512,
        seed: 42,
        randomizeSeed: false,
        guidanceScale: 7,
        numInferenceSteps: 10,
      },
    );

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    // Parameter order follows the Space's /infer signature:
    // prompt, seed, randomize_seed, width, height, guidance_scale,
    // num_inference_steps.
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: ['a fox', 42, false, 512, 512, 7, 10],
    });
  });

  it('requires an explicit model', async () => {
    await expect(
      generateWithHuggingFaceImage(
        { providerId: 'huggingface-image', apiKey: 'hf-test' },
        { prompt: 'a fox' },
      ),
    ).rejects.toThrow(/requires a model/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a rejected token with its status for the route categorizer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ dependencies: [{ api_name: 'infer' }] }));
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    await expect(
      generateWithHuggingFaceImage(
        {
          providerId: 'huggingface-image',
          apiKey: 'hf-bad',
          model: 'black-forest-labs/FLUX.1-dev',
        },
        { prompt: 'a fox' },
      ),
    ).rejects.toThrow(/\(401\)/);
  });

  it('throws when the Space returns no image data', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/config')) {
        return jsonResponse({ dependencies: [{ api_name: 'infer' }] });
      }
      if (url.endsWith('/gradio_api/queue/join')) {
        return jsonResponse({ event_id: 'evt-2' });
      }
      return sseResponse(
        'data: {"msg":"process_completed","event_id":"evt-2","output":{"data":[[null], 1]},"success":true}\n\n',
      );
    });
    await expect(
      generateWithHuggingFaceImage(
        {
          providerId: 'huggingface-image',
          apiKey: 'hf-test',
          model: 'black-forest-labs/FLUX.1-dev',
        },
        { prompt: 'a fox' },
      ),
    ).rejects.toThrow(/no image data/i);
  });

  it('surfaces the provider error message from the queue stream', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/config')) {
        return jsonResponse({ dependencies: [{ api_name: 'infer' }] });
      }
      if (url.endsWith('/gradio_api/queue/join')) {
        return jsonResponse({ event_id: 'evt-3' });
      }
      return sseResponse(
        'data: {"msg":"process_completed","event_id":"evt-3","output":{"error":"You have exceeded your ZeroGPU runs limit","title":"ZeroGPU quota exceeded"},"success":false,"title":"ZeroGPU quota exceeded"}\n\n',
      );
    });
    await expect(
      generateWithHuggingFaceImage(
        {
          providerId: 'huggingface-image',
          apiKey: 'hf-test',
          model: 'black-forest-labs/FLUX.1-dev',
        },
        { prompt: 'a fox' },
      ),
    ).rejects.toThrow(/ZeroGPU runs limit/);
  });
});
