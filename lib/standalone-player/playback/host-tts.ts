/**
 * Narration through the host's own speech engine, following the web player's
 * browser-native TTS path (`lib/playback/engine.ts#playBrowserTTS`):
 *
 * - a line is split into sentence-level chunks and spoken in order;
 * - a chunk the engine cannot speak is skipped, and the next one still plays;
 * - pausing playback holds the line, resuming continues it;
 * - when nothing could be spoken (no engine, empty text, every chunk failed)
 *   the sequencer falls back to the reading timer, exactly as the classroom
 *   does when browser TTS is unavailable.
 *
 * The Android app exposes `window.KelasKaHost.speak(text, id)`: it synthesizes
 * the chunk with `TextToSpeech`, plays it through a `MediaPlayer` and reports
 * its end through {@link HOST_SPEECH_EVENT}. A browser has no such host, so
 * this resolves `false` and the reading timer paces the line.
 */
import { estimateSpeechDurationMs } from '@/lib/choreography/timing';
import { HOST_SPEECH_EVENT, nativePlayerHost, type HostSpeechEvent } from '../host';
import type { StepControl } from './pause-gate';

let requestSerial = 0;

/**
 * Split a line on sentence-ending punctuation, as the classroom's browser TTS
 * does. Short utterances also keep a stuck synthesis from blocking the whole
 * line (only that chunk is lost) and make pause/resume land close to the
 * learner's tap.
 */
export function splitSpeechChunks(text: string): string[] {
  const chunks = text
    .split(/(?<=[.!?。！？\n])\s*/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  // No sentence punctuation at all: the line is one chunk. Blank text has no
  // chunk, so nothing is spoken and the reading timer dwells on the slide.
  return chunks.length > 0 ? chunks : text.trim() ? [text.trim()] : [];
}

/**
 * A chunk the host accepted but never finished (a stuck engine, a device that
 * lost audio focus for good) must not freeze playback. The estimate is the
 * spoken length, so the cap has to be several times it.
 */
function speechCapMs(text: string): number {
  return Math.max(15_000, estimateSpeechDurationMs(text) * 4);
}

/**
 * Speak a line with the host engine. Resolves `true` once at least one chunk
 * was spoken, `false` when the host cannot speak any of it, in which case the
 * reading timer paces the line.
 */
export function speakTextWithHost(text: string, control: StepControl): Promise<boolean> {
  const host = nativePlayerHost();
  const chunks = splitSpeechChunks(text);
  if (!host?.speak || chunks.length === 0 || control.signal.aborted) {
    return Promise.resolve(false);
  }
  const speak = host.speak.bind(host);

  return new Promise<boolean>((resolve) => {
    let index = 0;
    let spokenChunks = 0;
    let currentId: string | null = null;
    let cap: ReturnType<typeof setTimeout> | undefined;
    let capRemaining = 0;
    let capStartedAt = 0;
    let settled = false;
    let unsubscribe = () => {};

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearCap();
      window.removeEventListener(HOST_SPEECH_EVENT, onEvent);
      control.signal.removeEventListener('abort', onAbort);
      unsubscribe();
      resolve(result);
    };
    const clearCap = () => {
      if (cap !== undefined) clearTimeout(cap);
      cap = undefined;
      capRemaining = 0;
    };
    /** Freeze the safety cap while playback is paused. */
    const holdCap = () => {
      if (cap === undefined) return;
      capRemaining = Math.max(0, capRemaining - (Date.now() - capStartedAt));
      clearTimeout(cap);
      cap = undefined;
    };
    const resumeCap = () => {
      if (cap !== undefined || currentId === null || capRemaining <= 0) return;
      capStartedAt = Date.now();
      cap = setTimeout(onCap, capRemaining);
    };
    const next = async () => {
      if (settled) return;
      // A pause between chunks must hold the line where it is; the gate opens
      // again on resume (or aborts when the run is cancelled).
      await control.gate.whenOpen(control.signal);
      if (settled) return;
      if (control.signal.aborted || index >= chunks.length) {
        finish(spokenChunks > 0);
        return;
      }
      // Skipping a chunk the engine rejects mirrors `playBrowserTTSChunk`:
      // the line continues, and only an all-failed line falls back.
      speakChunk(chunks[index++]);
    };
    const speakChunk = (chunk: string) => {
      const id = `line-${++requestSerial}`;
      currentId = id;
      let accepted = false;
      try {
        accepted = speak(chunk, id) === 'ok';
      } catch {
        accepted = false;
      }
      if (!accepted) {
        currentId = null;
        void next();
        return;
      }
      capRemaining = speechCapMs(chunk);
      capStartedAt = Date.now();
      cap = setTimeout(onCap, capRemaining);
      // A pause that landed while the host was still synthesizing must hold
      // the clip at its start, not speak over the paused player.
      if (control.gate.paused) {
        holdCap();
        host.pauseSpeech?.();
      }
    };
    const onCap = () => {
      // The engine never reported this chunk: stop it and move on.
      cap = undefined;
      capRemaining = 0;
      currentId = null;
      host.stopSpeech?.();
      spokenChunks++;
      void next();
    };
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<HostSpeechEvent>).detail;
      if (!detail || detail.id !== currentId) return;
      clearCap();
      currentId = null;
      if (detail.type === 'end') spokenChunks++;
      void next();
    };
    const onAbort = () => {
      host.stopSpeech?.();
      finish(spokenChunks > 0);
    };

    window.addEventListener(HOST_SPEECH_EVENT, onEvent);
    control.signal.addEventListener('abort', onAbort, { once: true });
    unsubscribe = control.gate.subscribe((paused) => {
      if (paused) {
        holdCap();
        host.pauseSpeech?.();
      } else {
        host.resumeSpeech?.();
        resumeCap();
      }
    });
    void next();
  });
}
