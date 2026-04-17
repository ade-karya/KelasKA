/**
 * Browser Native TTS (Text-to-Speech) Hook
 * Uses Web Speech API for client-side text-to-speech
 * Completely free, no API key required
 *
 * Hardened for Microsoft Edge compatibility:
 * - All speechSynthesis calls wrapped in try-catch
 * - Safety timeout for onend (Edge may not always fire it)
 * - Graceful handling of cancel() on empty queue
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// Note: Window.SpeechSynthesis declaration is already in the global scope

/** Edge-safe wrapper for speechSynthesis access */
function getSpeechSynthesis(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

export interface UseBrowserTTSOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  rate?: number; // 0.1 to 10
  pitch?: number; // 0 to 2
  volume?: number; // 0 to 1
  lang?: string; // e.g., 'zh-CN', 'en-US'
}

export function useBrowserTTS(options: UseBrowserTTSOptions = {}) {
  const {
    onStart,
    onEnd,
    onError,
    rate = 1.0,
    pitch = 1.0,
    volume = 1.0,
    lang = 'id-ID',
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Safety timeout: if onend never fires (Edge quirk), auto-cleanup after this duration
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load available voices
  useEffect(() => {
    const synth = getSpeechSynthesis();
    if (!synth) return;

    const loadVoices = () => {
      try {
        const voices = synth.getVoices();
        setAvailableVoices(voices);
      } catch {
        /* Edge may throw in restricted contexts */
      }
    };

    loadVoices();

    // Some browsers load voices asynchronously
    try {
      synth.addEventListener('voiceschanged', loadVoices);
    } catch {
      // Fallback: try the property-based approach
      try {
        if (synth.onvoiceschanged !== undefined) {
          synth.onvoiceschanged = loadVoices;
        }
      } catch {
        /* ignore */
      }
    }

    return () => {
      try {
        synth.removeEventListener('voiceschanged', loadVoices);
      } catch {
        try {
          if (synth.onvoiceschanged !== undefined) {
            synth.onvoiceschanged = null;
          }
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  /** Clear the safety timeout */
  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const speak = useCallback(
    (text: string, voiceURI?: string) => {
      const synth = getSpeechSynthesis();
      if (!synth) {
        onError?.('Browser tidak mendukung Web Speech API');
        return;
      }

      // Cancel any ongoing speech — Edge may throw if queue is empty
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      clearSafetyTimer();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      utterance.lang = lang;

      // Set voice if specified
      if (voiceURI) {
        const voice = availableVoices.find((v) => v.voiceURI === voiceURI);
        if (voice) {
          utterance.voice = voice;
        }
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
        onStart?.();
      };

      const handleEnd = () => {
        clearSafetyTimer();
        setIsSpeaking(false);
        setIsPaused(false);
        utteranceRef.current = null;
        onEnd?.();
      };

      utterance.onend = handleEnd;

      utterance.onerror = (event) => {
        // 'canceled' is expected when cancel() is called — not a real error
        if (event.error === 'canceled') return;
        clearSafetyTimer();
        setIsSpeaking(false);
        setIsPaused(false);
        utteranceRef.current = null;
        onError?.(event.error);
      };

      utterance.onpause = () => {
        setIsPaused(true);
      };

      utterance.onresume = () => {
        setIsPaused(false);
      };

      utteranceRef.current = utterance;

      try {
        synth.speak(utterance);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Speech synthesis failed');
        return;
      }

      // Safety timeout: if onend doesn't fire within a reasonable time,
      // auto-cleanup to prevent the hook from being stuck in isSpeaking state.
      // Estimate: ~60ms per character at rate 1.0, with a minimum of 5s
      const estimatedMs = Math.max(5000, (text.length * 60) / rate);
      safetyTimerRef.current = setTimeout(() => {
        safetyTimerRef.current = null;
        // Only trigger if still speaking this utterance
        if (utteranceRef.current === utterance) {
          handleEnd();
        }
      }, estimatedMs * 2); // 2x margin
    },
    [rate, pitch, volume, lang, availableVoices, onStart, onEnd, onError, clearSafetyTimer],
  );

  const pause = useCallback(() => {
    const synth = getSpeechSynthesis();
    if (synth) {
      try {
        synth.pause();
      } catch {
        /* Edge may throw */
      }
    }
  }, []);

  const resume = useCallback(() => {
    const synth = getSpeechSynthesis();
    if (synth) {
      try {
        synth.resume();
      } catch {
        /* Edge may throw */
      }
    }
  }, []);

  const cancel = useCallback(() => {
    const synth = getSpeechSynthesis();
    if (synth) {
      try {
        synth.cancel();
      } catch {
        /* Edge may throw */
      }
      clearSafetyTimer();
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    }
  }, [clearSafetyTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSafetyTimer();
      const synth = getSpeechSynthesis();
      if (synth) {
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [clearSafetyTimer]);

  return {
    speak,
    pause,
    resume,
    cancel,
    isSpeaking,
    isPaused,
    availableVoices,
  };
}
