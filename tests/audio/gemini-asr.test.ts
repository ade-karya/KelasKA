import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { transcribeAudio } from '@/lib/audio/asr-providers';
import { ASR_PROVIDERS } from '@/lib/audio/constants';

const mockFetch = vi.hoisted(() => vi.fn() as Mock);
// The provider adapters issue requests through undici's fetch with a pinned
// dispatcher, so the double lives here (same pattern as funasr-asr.test.ts).
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

function wavBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(8, 4);
  buf.write('WAVE', 8, 'ascii');
  return buf;
}

describe('Gemini ASR', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('supports Indonesian and defaults to the dedicated transcribe model', () => {
    expect(ASR_PROVIDERS['google-asr'].supportedLanguages).toContain('id');
    expect(ASR_PROVIDERS['google-asr'].defaultModelId).toBe('gemini-3.1-flash-lite');
    expect(ASR_PROVIDERS['google-asr'].supportedFormats).toEqual(['wav']);
  });

  it('posts inline WAV audio to generateContent with the key in a header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ audioTranscription: { text: 'Selamat pagi.' } }] } }],
      }),
    });

    const result = await transcribeAudio(
      {
        providerId: 'google-asr',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
        apiKey: ' test-key ',
        modelId: 'gemini-3.5-transcribe',
      },
      wavBuffer(),
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent',
    );
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(url).not.toContain('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe('audio/wav');
    expect(result).toEqual({ text: 'Selamat pagi.' });
  });

  it('reads plain text parts from the Flash fallbacks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Halo dunia' }] }, finishReason: 'STOP' }],
      }),
    });

    const result = await transcribeAudio(
      { providerId: 'google-asr', apiKey: 'k', modelId: 'gemini-3.1-flash-lite' },
      wavBuffer(),
    );

    expect(mockFetch.mock.calls[0][0]).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect(result).toEqual({ text: 'Halo dunia' });
  });

  it('falls back to the default model when the config names none', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Halo' }] } }] }),
    });

    await transcribeAudio({ providerId: 'google-asr', apiKey: 'k' }, wavBuffer());

    expect(mockFetch.mock.calls[0][0]).toContain('/models/gemini-3.1-flash-lite:generateContent');
  });

  it('rejects non-WAV audio before calling the API', async () => {
    const notWav = Buffer.from('IDXX' + '\0'.repeat(12));

    await expect(
      transcribeAudio({ providerId: 'google-asr', apiKey: 'k' }, notWav),
    ).rejects.toThrow(/WAV input only/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces provider errors without the key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => '{"error":{"status":"RESOURCE_EXHAUSTED"}}',
    });

    await expect(
      transcribeAudio({ providerId: 'google-asr', apiKey: 'secret-key' }, wavBuffer()),
    ).rejects.toThrow(/Gemini ASR API error.*RESOURCE_EXHAUSTED/);
  });

  it('requires an API key', async () => {
    await expect(transcribeAudio({ providerId: 'google-asr' }, wavBuffer())).rejects.toThrow(
      /API key required/,
    );
  });
});
