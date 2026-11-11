/**
 * Server-side timbre pinning for VoxCPM narration.
 *
 * The auto voice synthesizes a fresh vocal identity for every synthesis call
 * unless the caller pins it, so a five-clip narration batch arrives as five
 * different teachers. The python-api backend has no server-side voice registry
 * (the `POST /v1/audio/voices` flow is vllm-omni only), but it does accept
 * `reference_audio` on every request, and VoxCPM clones the timbre of a
 * reference clip with zero-shot cloning. So the run synthesizes one short
 * bootstrap clip from the narrator's own design and threads it inline into
 * every later call. The reference clip is cached per voice prompt, so a course
 * gets one stable narrator from the first line of the first scene to the last.
 *
 * The bootstrap clip is intentionally cached in-process: it costs one extra
 * synthesis (a couple of seconds) per unique voice prompt, it is tiny, and the
 * engine narration path runs in this process. A cache miss after a restart is
 * a new clip, not a different identity — still one narrator per run.
 */

import { createHash } from 'node:crypto';

import type { AgentConfig } from '@/lib/orchestration/registry/types';

import { generateTTS } from '@/lib/audio/tts-providers';
import { effectiveVoiceDesign } from '@/lib/audio/agent-voice-options';
import {
  buildAutoVoxCPMVoicePrompt,
  VOXCPM_AUTO_VOICE_ID,
  VOXCPM_TTS_PROVIDER_ID,
} from '@/lib/audio/voxcpm';
import { createLogger } from '@/lib/logger';
import type { MediaConnection } from '@/lib/server/model-config/media';

const log = createLogger('NarratorVoice');

/** The reference clip is small; this bound is about uncontrolled agent counts. */
const MAX_CACHED_CLIPS = 64;

const SAMPLE_BY_NUMBER = {
  id: 'Halo, selamat datang di pelajaran hari ini. Mari kita mulai.',
  en: "Hello, welcome to today's lesson. Let us begin.",
} as const;

/** A volatile process-lifetime clip store. See the header comment. */
const clipCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export interface NarratorReference {
  referenceAudioBase64: string;
  referenceAudioMimeType: 'audio/wav';
  referenceAudioName: 'narrator.wav';
}

/** True when the directive points at Indonesian; cloning works across languages. */
function indonesianHint(language: string | undefined): boolean {
  if (!language) return false;
  return /indones|bahasa\s*indonesia|id[-_]id/i.test(language);
}

function cacheKey(backend: string, language: string, voicePrompt: string): string {
  return createHash('sha256').update([backend, language, voicePrompt].join(' ')).digest('hex');
}

/**
 * The narrator's reference clip for the inline `reference_audio` upload, or
 * `null` when the provider is not VoxCPM or the bootstrap failed (the caller
 * then keeps the previous behaviour instead of failing the narration).
 */
export async function narratorReferenceAudio(
  agent: AgentConfig | undefined,
  connection: MediaConnection,
  language: string | undefined,
  signal?: AbortSignal,
): Promise<NarratorReference | null> {
  if (connection.providerId !== VOXCPM_TTS_PROVIDER_ID) return null;

  const backend =
    typeof connection.options?.backend === 'string' ? connection.options.backend : 'vllm-omni';
  const context = {
    agentName: agent?.name,
    role: agent?.role ?? 'teacher',
    persona: agent?.persona,
    voiceDesign: effectiveVoiceDesign(agent),
    language,
    backend: backend as 'vllm-omni' | 'python-api' | 'nano-vllm',
  };
  const voicePrompt = buildAutoVoxCPMVoicePrompt(context);
  const languageKey = indonesianHint(language) ? 'id' : 'en';
  const key = cacheKey(backend, languageKey, voicePrompt);

  const cached = clipCache.get(key);
  if (cached) return toReference(cached);

  // One concurrent bootstrap per voice; the rest wait for the same clip.
  const running = inflight.get(key);
  if (running) {
    const clip = await running;
    return clip ? toReference(clip) : null;
  }

  const bootstrap = (async (): Promise<string | null> => {
    const sample = SAMPLE_BY_NUMBER[languageKey];
    try {
      const result = await generateTTS(
        {
          providerId: VOXCPM_TTS_PROVIDER_ID,
          modelId: connection.modelId,
          apiKey: connection.apiKey,
          baseUrl: connection.baseUrl,
          voice: VOXCPM_AUTO_VOICE_ID,
          providerOptions: {
            backend,
            voicePrompt,
            cfgValue: 2.0,
            inferenceTimesteps: 10,
          },
          ...(signal ? { signal } : {}),
        },
        sample,
      );
      return Buffer.from(result.audio).toString('base64');
    } catch (error) {
      log.warn('narrator reference clip bootstrap failed:', error);
      return null;
    }
  })();

  inflight.set(key, bootstrap);
  try {
    const clip = await bootstrap;
    if (!clip) return null;
    if (clipCache.size >= MAX_CACHED_CLIPS) {
      clipCache.delete(clipCache.keys().next().value as string);
    }
    clipCache.set(key, clip);
    return toReference(clip);
  } finally {
    inflight.delete(key);
  }
}

function toReference(clip: string): NarratorReference {
  return {
    referenceAudioBase64: clip,
    referenceAudioMimeType: 'audio/wav',
    referenceAudioName: 'narrator.wav',
  };
}
