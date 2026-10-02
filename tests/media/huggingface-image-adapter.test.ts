/**
 * Hugging Face FLUX image adapter contract tests.
 *
 * Pins the Gradio `/infer` request shape (parameter order matters), the SSE
 * result parsing, and the login probe. `fetch` is stubbed, so nothing bills
 * and no queue time is spent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
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
      if (url.endsWith('/gradio_api/call/infer')) {
        return jsonResponse({ event_id: 'evt-1' });
      }
      if (url.includes('/gradio_api/call/infer/evt-1')) {
        return sseResponse(
          'event: generating\ndata: [null]\n\n' +
            'event: complete\ndata: [{"url": "/gradio_api/file=/tmp/gradio/abc/out.png", "mime_type": "image/png"}, 123]\n\n',
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

    const [callUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(callUrl).toBe('https://black-forest-labs-flux-1-dev.hf.space/gradio_api/call/infer');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hf-test');
    // Parameter order follows the Space's /infer signature.
    expect(JSON.parse(init.body as string)).toEqual({
      data: ['a fox', 0, true, 1280, 720, 3.5, 28],
    });

    const [pollUrl, pollInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(pollUrl).toBe(
      'https://black-forest-labs-flux-1-dev.hf.space/gradio_api/call/infer/evt-1',
    );
    expect((pollInit.headers as Record<string, string>).Authorization).toBe('Bearer hf-test');
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
      if (url.endsWith('/gradio_api/call/infer')) {
        return jsonResponse({ event_id: 'evt-2' });
      }
      return sseResponse('event: complete\ndata: [[null], 1]\n\n');
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
});
