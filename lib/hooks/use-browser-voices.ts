'use client';

import { useState, useEffect } from 'react';

export interface BrowserVoiceInfo {
  id: string; // voiceURI — the identifier used by use-browser-tts.ts
  name: string; // Display name
  language: string; // e.g., 'id-ID', 'en-US'
  gender: 'neutral';
}

/**
 * Dynamically load browser TTS voices from the Web Speech API.
 *
 * Returns voices sorted with Indonesian (id-ID) voices first,
 * followed by all other available voices. Includes a static
 * "Default" fallback so the dropdown is never empty.
 *
 * Uses addEventListener (not the onvoiceschanged property) to
 * avoid overwriting handlers set by other hooks.
 */
export function useBrowserVoices(): BrowserVoiceInfo[] {
  const [voices, setVoices] = useState<BrowserVoiceInfo[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let synth: SpeechSynthesis;
    try {
      if (!window.speechSynthesis) return;
      synth = window.speechSynthesis;
    } catch {
      // Edge InPrivate mode may deny access
      return;
    }

    const loadVoices = () => {
      try {
        const allVoices = synth.getVoices();
        if (allVoices.length === 0) return;

        const mapped: BrowserVoiceInfo[] = allVoices.map((v) => ({
          id: v.voiceURI,
          name: v.name,
          language: v.lang,
          gender: 'neutral' as const,
        }));

        // Sort: Indonesian voices first, then alphabetically by name
        mapped.sort((a, b) => {
          const aIsId = a.language.startsWith('id') ? 0 : 1;
          const bIsId = b.language.startsWith('id') ? 0 : 1;
          if (aIsId !== bIsId) return aIsId - bIsId;
          return a.name.localeCompare(b.name);
        });

        setVoices(mapped);
      } catch {
        /* Edge may throw in restricted contexts */
      }
    };

    // Try loading immediately (some browsers have voices ready synchronously)
    loadVoices();

    // Chrome and others load voices asynchronously
    try {
      synth.addEventListener('voiceschanged', loadVoices);
    } catch {
      /* ignore — some engines don't support this event */
    }

    return () => {
      try {
        synth.removeEventListener('voiceschanged', loadVoices);
      } catch {
        /* ignore */
      }
    };
  }, []);

  return voices;
}
