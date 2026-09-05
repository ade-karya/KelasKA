import type {
  ProviderId,
  ProviderType,
  ModelInfo,
  ThinkingCapability,
} from '@/lib/types/provider';
import type { ProviderSettings } from '@/lib/types/settings';
import { getCatalogThinkingCapability, openRouterReasoningCapability } from '@/lib/ai/model-metadata';
import type { OpenRouterReasoningMeta } from '@/lib/ai/model-metadata';

/** Heuristic: model ids matching this are treated as vision-capable. */
const VISION_MODEL_PATTERN = /vision|vl|omni|4o|gpt-5|gemini|claude/i;

/** Extra metadata a model probe may return (Gemini `GET /v1beta/models`). */
export interface ProbedModelDetails {
  displayName?: string;
  thinking?: boolean;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  /** OpenRouter `context_length` (preferred over `inputTokenLimit` when set). */
  contextLength?: number;
  /** OpenRouter per-model `reasoning` descriptor (`GET /api/v1/models`). */
  reasoning?: OpenRouterReasoningMeta | null;
}

/**
 * Default thinking-level capability for Gemini models unknown to the catalog.
 * Mirrors the Gemini 3 `thinkingLevel` contract (`minimal/low/medium/high`,
 * https://ai.google.dev/api/models + thinking docs) so freshly fetched models
 * always expose the level control instead of silently losing it.
 */
const DEFAULT_GEMINI_LEVEL_THINKING: ThinkingCapability = {
  control: 'level',
  requestAdapter: 'google',
  levelValues: ['minimal', 'low', 'medium', 'high'],
  defaultLevel: 'medium',
  defaultMode: 'enabled',
  toggleable: false,
  budgetAdjustable: true,
  defaultEnabled: true,
};

/**
 * Builds a default ModelInfo from a probed model id. Vision capability is
 * inferred from the id via {@link VISION_MODEL_PATTERN}. Shared by the provider
 * panel and the token-plan apply flow so the heuristic stays in one place.
 *
 * When `providerId` is given, the built-in thinking capability for that
 * (provider, model) pair is overlaid — so a model that supports configurable
 * thinking keeps its `capabilities.thinking` instead of silently losing it
 * (which would hide InlineThinkingControl). Unknown pairs are unaffected,
 * except Gemini (`google`): unless the list API explicitly reports
 * `thinking: false`, a freshly fetched model gets the default thinking-*level*
 * capability so the level selector is available immediately.
 */
export function modelInfoFromId(
  id: string,
  providerId?: string,
  details?: ProbedModelDetails,
): ModelInfo {
  const catalogThinking = providerId
    ? getCatalogThinkingCapability(providerId, id)
    : undefined;
  // OpenRouter fallback: build an effort control from the probe's per-model
  // `reasoning` descriptor so freshly fetched models expose the effort
  // selector immediately. Catalog entries always win when present.
  const probedThinking =
    !catalogThinking && providerId === 'openrouter'
      ? openRouterReasoningCapability(details?.reasoning)
      : undefined;
  // Gemini fallback: every fetched model that isn't explicitly non-thinking
  // gets a thinking-*level* control (Gemini 3 `thinkingLevel`). Catalog entries
  // (e.g. 2.5 budget variants) always win when present.
  const thinking =
    catalogThinking ??
    probedThinking ??
    (providerId === 'google' && details?.thinking !== false
      ? DEFAULT_GEMINI_LEVEL_THINKING
      : undefined);
  return {
    id,
    name: details?.displayName || id,
    contextWindow: details?.contextLength ?? details?.inputTokenLimit,
    outputWindow: details?.outputTokenLimit,
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
