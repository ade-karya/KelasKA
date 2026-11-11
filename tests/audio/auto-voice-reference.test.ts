/**
 * Inline timbre pinning for VoxCPM discussion agents (python-api has no server
 * voice registry). The first line for a voice design synthesizes one short
 * reference clip; every later line for the same design threads it inline, so
 * a discussion stays one narrator per agent instead of a fresh random voice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/device-storage/database', () => ({
  db: { voiceProfiles: { get: vi.fn(async () => undefined) } },
}));

import {
  getVoxCPMProviderOptions,
  resetAutoVoiceReferenceForTests,
} from '@/lib/audio/voxcpm-voices';
import { VOXCPM_AUTO_VOICE_ID } from '@/lib/audio/voxcpm';

const WAV_B64 = Buffer.from('fake-reference-audio-bytes').toString('base64');

const ID_CTX = {
  voiceDesign: {
    identity: 'middle-aged male teacher',
    texture: 'warm low voice',
    delivery: 'calm',
  },
  backend: 'python-api' as const,
  language: 'id',
};

function mockFetchOk() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, format: 'wav', base64: WAV_B64 }),
  })) as unknown as typeof fetch;
}

describe('auto-voice reference pinning', () => {
  afterEach(() => {
    resetAutoVoiceReferenceForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('synthesizes a reference clip once per voice design and pins it inline', async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal('fetch', fetchMock);

    const first = await getVoxCPMProviderOptions(VOXCPM_AUTO_VOICE_ID, ID_CTX);
    const second = await getVoxCPMProviderOptions(VOXCPM_AUTO_VOICE_ID, ID_CTX);

    expect(first.voiceMode).toBe('auto');
    expect(first.referenceAudioBase64).toBe(WAV_B64);
    expect(second.referenceAudioBase64).toBe(WAV_B64);
    // One bootstrap, not one per line.
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const body = JSON.parse(
      ((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
        .body as string,
    );
    expect(body.text).toBe('Halo, selamat datang di pelajaran hari ini.');
    expect(body.ttsVoice).toBe(VOXCPM_AUTO_VOICE_ID);
    expect(body.ttsProviderOptions.voicePrompt).toContain('middle-aged male teacher');
  });

  it('keeps separate reference clips for separate voice designs', async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal('fetch', fetchMock);

    await getVoxCPMProviderOptions(VOXCPM_AUTO_VOICE_ID, ID_CTX);
    await getVoxCPMProviderOptions(VOXCPM_AUTO_VOICE_ID, {
      ...ID_CTX,
      voiceDesign: { identity: 'young female student', texture: 'bright', delivery: 'energetic' },
    });

    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('falls back to the inline prompt when the bootstrap fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const options = await getVoxCPMProviderOptions(VOXCPM_AUTO_VOICE_ID, ID_CTX);

    expect(options.voiceMode).toBe('auto');
    expect(options.voicePrompt).toContain('middle-aged male teacher');
    expect(options.referenceAudioBase64).toBeUndefined();
  });
});
