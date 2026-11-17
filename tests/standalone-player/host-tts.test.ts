// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PauseGate, type StepControl } from '@/lib/standalone-player/playback/pause-gate';
import { speakTextWithHost, splitSpeechChunks } from '@/lib/standalone-player/playback/host-tts';
import { HOST_SPEECH_EVENT } from '@/lib/standalone-player/host';

type HostWindow = Window & {
  KelasKaHost?: {
    speak?: (text: string, requestId: string) => string;
    pauseSpeech?: () => void;
    resumeSpeech?: () => void;
    stopSpeech?: () => void;
  };
};

function fakeHost() {
  const calls: Array<{ text: string; id: string }> = [];
  const host = {
    speak: vi.fn((text: string, id: string) => {
      calls.push({ text, id });
      return 'ok';
    }),
    pauseSpeech: vi.fn(),
    resumeSpeech: vi.fn(),
    stopSpeech: vi.fn(),
  };
  (window as HostWindow).KelasKaHost = host;
  return { host, calls };
}

function controlFor(gate = new PauseGate()) {
  const abort = new AbortController();
  const control: StepControl = { signal: abort.signal, gate };
  return { control, abort, gate };
}

function finishChunk(id: string, type: 'end' | 'error') {
  window.dispatchEvent(new CustomEvent(HOST_SPEECH_EVENT, { detail: { id, type } }));
}

/** Let the chunk loop reach the host (its first `await` suspends once). */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as HostWindow).KelasKaHost;
});

describe('splitSpeechChunks', () => {
  it('splits a narration line on sentence punctuation', () => {
    expect(splitSpeechChunks('Satu. Dua! Tiga? Empat')).toEqual([
      'Satu.',
      'Dua!',
      'Tiga?',
      'Empat',
    ]);
  });

  it('keeps an unpunctuated line whole and drops blank text', () => {
    expect(splitSpeechChunks('  Satu baris panjang  ')).toEqual(['Satu baris panjang']);
    expect(splitSpeechChunks('   \n  ')).toEqual([]);
  });
});

describe('speakTextWithHost', () => {
  it('speaks sentence chunks in order and resolves after the last one', async () => {
    const { calls } = fakeHost();
    const { control } = controlFor();
    let result: boolean | undefined;
    void speakTextWithHost('Satu. Dua!', control).then((r) => (result = r));

    await flush();
    expect(calls.map((call) => call.text)).toEqual(['Satu.']);
    finishChunk(calls[0].id, 'end');
    await flush();
    expect(calls.map((call) => call.text)).toEqual(['Satu.', 'Dua!']);
    expect(result).toBeUndefined();

    finishChunk(calls[1].id, 'end');
    await flush();
    expect(result).toBe(true);
  });

  it('skips a rejected chunk and speaks the rest, as the web player does', async () => {
    const { calls } = fakeHost();
    const { control } = controlFor();
    let result: boolean | undefined;
    void speakTextWithHost('Satu. Dua.', control).then((r) => (result = r));

    await flush();
    finishChunk(calls[0].id, 'error');
    await flush();
    expect(calls.map((call) => call.text)).toEqual(['Satu.', 'Dua.']);
    finishChunk(calls[1].id, 'end');
    await flush();
    expect(result).toBe(true);
  });

  it('resolves false when every chunk is rejected, so the reading timer paces', async () => {
    const { calls } = fakeHost();
    const { control } = controlFor();
    let result: boolean | undefined;
    void speakTextWithHost('Satu. Dua.', control).then((r) => (result = r));

    await flush();
    finishChunk(calls[0].id, 'error');
    await flush();
    finishChunk(calls[1].id, 'error');
    await flush();
    expect(result).toBe(false);
  });

  it('holds the line while playback is paused and resumes it', async () => {
    const { host, calls } = fakeHost();
    const { control, gate } = controlFor();
    let result: boolean | undefined;
    void speakTextWithHost('Satu. Dua.', control).then((r) => (result = r));

    await flush();
    gate.set(true);
    expect(host.pauseSpeech).toHaveBeenCalled();
    gate.set(false);
    expect(host.resumeSpeech).toHaveBeenCalled();
    finishChunk(calls[0].id, 'end');
    await flush();
    expect(calls).toHaveLength(2);
    finishChunk(calls[1].id, 'end');
    await flush();
    expect(result).toBe(true);
  });

  it('does not start the next chunk before the pause is lifted', async () => {
    const { calls } = fakeHost();
    const { control, gate } = controlFor();
    void speakTextWithHost('Satu. Dua.', control);

    await flush();
    gate.set(true);
    finishChunk(calls[0].id, 'end');
    await flush();
    expect(calls).toHaveLength(1);
    gate.set(false);
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('holds the safety cap while paused, so a long pause does not skip the line', async () => {
    const { host, calls } = fakeHost();
    const { control, gate } = controlFor();
    let result: boolean | undefined;
    void speakTextWithHost('Satu. Dua.', control).then((r) => (result = r));

    await flush();
    gate.set(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.stopSpeech).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);

    gate.set(false);
    await flush();
    finishChunk(calls[0].id, 'end');
    await flush();
    expect(calls.map((call) => call.text)).toEqual(['Satu.', 'Dua.']);
    finishChunk(calls[1].id, 'end');
    await flush();
    expect(result).toBe(true);
  });

  it('stops the host engine when the step is cancelled', async () => {
    const { host } = fakeHost();
    const { control, abort } = controlFor();
    let result: boolean | undefined;
    void speakTextWithHost('Satu.', control).then((r) => (result = r));

    await flush();
    abort.abort();
    await flush();
    expect(host.stopSpeech).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('declines without a host, without text, or once cancelled', async () => {
    const { control } = controlFor();
    await expect(speakTextWithHost('Halo.', control)).resolves.toBe(false);

    fakeHost();
    await expect(speakTextWithHost('   ', control)).resolves.toBe(false);

    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      speakTextWithHost('Halo.', { signal: cancelled.signal, gate: new PauseGate() }),
    ).resolves.toBe(false);
  });
});
