import type { ProviderId, ProviderType, ModelInfo } from '@/lib/types/provider';
import type { ProviderSettings } from '@/lib/types/settings';
import { getProbedThinkingCapability } from '@/lib/ai/model-metadata';
import { findModelById } from '@/lib/ai/model-aliases';
import { PROVIDERS } from '@/lib/ai/providers';

/** Heuristic: model ids matching this are treated as vision-capable. */
const VISION_MODEL_PATTERN = /vision|vl|omni|4o|gpt-5|gemini|claude/i;

/** Words always uppercased when prettifying a raw model id into a label. */
const PRETTY_ACRONYMS = new Set(['gpt', 'llm', 'vl', 'tts', 'asr', 'ai', 'api', 'pbl']);

/**
 * Turns a raw model id (`gemini-2.5-flash`, `qwen/qwen3.8-27b:free`) into a
 * readable label (`Gemini 2.5 Flash`, `Qwen3.8 27B Free`). Only a fallback —
 * catalog names and provider `displayName`s (OpenRouter `name`) win when
 * available.
 *
 * OpenRouter ids carry a `vendor/` prefix and an optional `:variant` suffix
 * (`:free`); both are split into words instead of leaking `"/"`/`":"` into
 * the label.
 */
export function prettifyModelId(id: string): string {
  return id
    .split(/[/:_\-]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (PRETTY_ACRONYMS.has(lower)) return lower.toUpperCase();
      if (/^[a-z]/.test(word)) return word[0].toUpperCase() + word.slice(1);
      return word;
    })
    .join(' ');
}

/**
 * Builds a default ModelInfo from a probed model id. Name resolution order:
 * built-in catalog name → provider `displayName` (OpenRouter catalog `name`)
 * → prettified id. Vision capability is inferred from the id via
 * {@link VISION_MODEL_PATTERN}. Shared by the provider panel and the
 * token-plan apply flow so the heuristic stays in one place.
 *
 * Thinking comes from {@link getProbedThinkingCapability}: exact catalog
 * entries keep their configured control, and unknown ids of thinking
 * families (e.g. a future `gemini-3.9-flash`) get an inferred control so the
 * thinking UI keeps working for fetched models instead of silently hiding.
 */
export function modelInfoFromId(
  id: string,
  providerId?: string,
  displayName?: string,
  contextLength?: number,
): ModelInfo {
  const catalogModel =
    providerId && PROVIDERS[providerId as ProviderId]
      ? findModelById(providerId, PROVIDERS[providerId as ProviderId].models, id)
      : undefined;
  if (catalogModel) {
    // A catalog twin exists (e.g. re-fetching a known model): reuse its
    // curated name and full capabilities verbatim.
    return {
      id,
      name: catalogModel.name,
      contextWindow: catalogModel.contextWindow,
      outputWindow: catalogModel.outputWindow,
      capabilities: { ...catalogModel.capabilities },
    };
  }
  const thinking = providerId ? getProbedThinkingCapability(providerId, id) : undefined;
  const trimmedDisplayName = displayName?.trim();
  return {
    id,
    name: trimmedDisplayName || prettifyModelId(id),
    ...(typeof contextLength === 'number' && Number.isFinite(contextLength) && contextLength > 0
      ? { contextWindow: contextLength }
      : {}),
    capabilities: {
      streaming: true,
      tools: true,
      vision: VISION_MODEL_PATTERN.test(id),
      ...(thinking ? { thinking } : {}),
    },
  };
}

interface NewCustomProviderConfig {
  name: string;
  type: ProviderType;
  baseUrl: string;
  icon: string;
  requiresApiKey: boolean;
  /** Optional explicit /models URL override (from a preset). */
  modelsUrl?: string;
}

export function formatContextWindow(size?: number): string {
  if (!size) return '-';

  // For M: prefer decimal (use decimal for exact thousands)
  if (size >= 1000000) {
    if (size % 1000000 === 0) {
      return `${size / 1000000}M`;
    }
    return `${(size / 1000000).toFixed(1)}M`;
  }

  // For K: prefer decimal if divisible by 1000, otherwise use binary
  if (size >= 1000) {
    if (size % 1000 === 0) {
      return `${size / 1000}K`;
    }
    return `${Math.floor(size / 1024)}K`;
  }

  return size.toString();
}

export function getProviderTypeLabel(type: string, t: (key: string) => string): string {
  const translationKey = `settings.providerTypes.${type}`;
  const translated = t(translationKey);
  // If translation exists (not equal to key), use it; otherwise fallback to type
  return translated !== translationKey ? translated : type;
}

export function createCustomProviderSettings(
  providerData: NewCustomProviderConfig,
): ProviderSettings {
  return {
    apiKey: '',
    baseUrl: providerData.baseUrl || '',
    models: [],
    name: providerData.name,
    type: providerData.type,
    defaultBaseUrl: providerData.baseUrl || undefined,
    icon: providerData.icon || undefined,
    requiresApiKey: providerData.requiresApiKey,
    isBuiltIn: false,
    modelsUrl: providerData.modelsUrl || undefined,
  };
}

interface VerifyModelRequestConfig {
  providerId: ProviderId;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: ProviderType | string;
  requiresApiKey?: boolean;
}

export function createVerifyModelRequest(config: VerifyModelRequestConfig) {
  return {
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || '',
    model: `${config.providerId}:${config.modelId}`,
    providerType: config.providerType,
    requiresApiKey: config.requiresApiKey,
  };
}
