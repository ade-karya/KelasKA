/**
 * Bridge between the standalone player page and a native host app that embeds
 * it (the Kelas KA Android WebView).
 *
 * The browser build has no host: every member is optional, and the player
 * keeps its web behaviour (`document.fullscreenElement`, HTML audio, the
 * reading timer). The Android app installs `window.KelasKaHost` before loading
 * the document, so the same bundle can drive the host's own fullscreen mode
 * and its TextToSpeech engine instead.
 */

/** Methods the Android app exposes as `window.KelasKaHost`. */
export interface StandalonePlayerHost {
  /**
   * Enter or leave the host's fullscreen mode. The page cannot use the HTML
   * Fullscreen API there: WebView turns it into a custom view on top of the
   * activity, which drops out of fullscreen when the device rotates.
   */
  setFullscreen?(enabled: boolean): void;
  /**
   * Speak a narration line. Returns `'ok'` when the host accepted the line and
   * will report its end through {@link HOST_SPEECH_EVENT}, anything else when
   * it cannot speak it (the player then falls back to the reading timer).
   */
  speak?(text: string, requestId: string): string;
  pauseSpeech?(): void;
  resumeSpeech?(): void;
  stopSpeech?(): void;
}

/** Host -> page: fullscreen was entered or left (the Back button included). */
export const HOST_FULLSCREEN_EVENT = 'kelaska:fullscreen';
/** Host -> page: a spoken line reached its end (`end`) or failed (`error`). */
export const HOST_SPEECH_EVENT = 'kelaska:speech';

export interface HostSpeechEvent {
  id: string;
  type: 'end' | 'error';
}

/** The host bridge, when this document runs inside the Android app. */
export function nativePlayerHost(): StandalonePlayerHost | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = (window as Window & { KelasKaHost?: StandalonePlayerHost }).KelasKaHost;
  return host ?? undefined;
}
