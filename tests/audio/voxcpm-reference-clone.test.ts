import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { generateTTS } from '@/lib/audio/tts-providers';

const mockFetch = vi.hoisted(() => vi.fn() as Mock);
// The adapters issue requests through undici's fetch with a pinned dispatcher.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const REFERENCE_WAV = (() => {
  const buf = Buffer.alloc(16);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(8, 4);
  buf.write('WAVE', 8, 'ascii');
  return buf;
})();
const SAMPLE = REFERENCE_WAV.toString('base64');

function fakeWavResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'audio/wav' }),
    arrayBuffer: async () => REFERENCE_WAV.buffer.slice(0),
    text: async () => '',
  };
}

describe('VoxCPM reference-clone narration', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends the raw text, not the gender description, when a reference clip is pinned', async () => {
    mockFetch.mockResolvedValueOnce(fakeWavResponse());

    await generateTTS(
      {
        providerId: 'voxcpm-tts',
        baseUrl: 'https://voxcpm.example.test',
        voice: 'voxcpm:auto',
        providerOptions: {
          backend: 'python-api',
          voicePrompt: 'middle-aged male teacher, warm low voice',
          referenceAudioBase64: SAMPLE,
          referenceAudioMimeType: 'audio/wav',
          referenceAudioName: 'narrator.wav',
        },
      },
      'Halo, mari kita mulai belajar fotosintesis.',
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://voxcpm.example.test/tts/upload');
    const form = init.body as FormData;
    expect(form.get('text')).toBe('Halo, mari kita mulai belajar fotosintesis.');
    expect(String(form.get('text'))).not.toContain('middle-aged');
    expect(form.get('reference_audio')).toBeInstanceOf(Blob);
    expect(form.get('prompt_text')).toBeNull();
  });

  it('still prefixes the voice prompt when no reference clip is pinned', async () => {
    mockFetch.mockResolvedValueOnce(fakeWavResponse());

    await generateTTS(
      {
        providerId: 'voxcpm-tts',
        baseUrl: 'https://voxcpm.example.test',
        voice: 'voxcpm:auto',
        providerOptions: {
          backend: 'python-api',
          voicePrompt: 'middle-aged male teacher, warm low voice',
        },
      },
      'Halo.',
    );

    const form = mockFetch.mock.calls[0][1].body as FormData;
    expect(String(form.get('text'))).toContain('(middle-aged male teacher, warm low voice)Halo.');
    expect(form.get('reference_audio')).toBeNull();
  });

  it('keeps the prompt-continuation path when a prompt text is supplied', async () => {
    mockFetch.mockResolvedValueOnce(fakeWavResponse());

    await generateTTS(
      {
        providerId: 'voxcpm-tts',
        baseUrl: 'https://voxcpm.example.test',
        voice: 'voxcpm:auto',
        providerOptions: {
          backend: 'python-api',
          voicePrompt: 'warm Indonesian teacher',
          referenceAudioBase64: SAMPLE,
          referenceAudioMimeType: 'audio/wav',
          promptText: 'exact reference sentence',
        },
      },
      'Halo.',
    );

    const form = mockFetch.mock.calls[0][1].body as FormData;
    expect(form.get('text')).toBe('Halo.');
    expect(form.get('prompt_text')).toBe('exact reference sentence');
    expect(form.get('prompt_audio')).toBeInstanceOf(Blob);
  });
});
