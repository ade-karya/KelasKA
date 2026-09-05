import { describe, expect, it } from 'vitest';

import { PROVIDERS } from '@/lib/ai/providers';
import {
  getCatalogThinkingCapability,
  getModelMetadataKey,
  openRouterReasoningCapability,
} from '@/lib/ai/model-metadata';
import type { ProviderConfig, ProviderId } from '@/lib/types/provider';

// These models intentionally do not expose a configurable thinking control.
const MODELS_WITHOUT_CONFIGURABLE_THINKING = new Set<string>([
  // Bedrock models can reason, but this provider intentionally does not expose
  // thinking controls yet. Those require Bedrock-specific request serialization
  // (`providerOptions.bedrock.reasoningConfig`), which is outside this text-provider
  // rebase and belongs in the maintainer's follow-up request-serialization review.
  'bedrock:us.anthropic.claude-sonnet-5',
  'bedrock:us.anthropic.claude-opus-4-8',
  'bedrock:us.anthropic.claude-opus-4-7',
  'bedrock:us.anthropic.claude-sonnet-4-6',
  'bedrock:us.amazon.nova-pro-v1:0',
  'bedrock:us.amazon.nova-lite-v1:0',
  'bedrock:us.amazon.nova-micro-v1:0',
  'bedrock:us.meta.llama3-3-70b-instruct-v1:0',
  'siliconflow:Pro/moonshotai/Kimi-K2.5',
  'grok:grok-4.20',
  'grok:grok-4-1-fast-non-reasoning',
  'grok:grok-code-fast-1',
  'atlascloud:qwen/qwen3.5-flash',
  'ollama:llama3.3',
  'ollama:gemma3',
  'ollama:deepseek-r1',
]);

function findDriftedModels(providers: Record<ProviderId, ProviderConfig>): string[] {
  const driftedModels: string[] = [];

  for (const provider of Object.values(providers)) {
    for (const model of provider.models) {
      const key = getModelMetadataKey(provider.id, model.id);

      if (getCatalogThinkingCapability(provider.id, model.id)) {
        continue;
      }

      if (MODELS_WITHOUT_CONFIGURABLE_THINKING.has(key)) {
        continue;
      }

      driftedModels.push(key);
    }
  }

  return driftedModels;
}

describe('model metadata thinking capabilities', () => {
  it('accounts for every PROVIDERS model with a capability or explicit non-thinking allowlist', () => {
    expect(findDriftedModels(PROVIDERS)).toEqual([]);
  });

  it('catches drift when a provider model has no thinking metadata or allowlist entry', () => {
    const syntheticProviders = {
      siliconflow: {
        ...PROVIDERS.siliconflow,
        models: [
          ...PROVIDERS.siliconflow.models,
          { id: '__synthetic_missing__', name: 'x', capabilities: {} },
        ],
      },
    } as Record<ProviderId, ProviderConfig>;

    expect(findDriftedModels(syntheticProviders)).toContain('siliconflow:__synthetic_missing__');
  });

  it('resolves thinking capabilities for the previously missing explicit models', () => {
    expect(getCatalogThinkingCapability('siliconflow', 'deepseek-ai/DeepSeek-V3.2')).toBeDefined();
    expect(getCatalogThinkingCapability('lemonade', 'Gemma-4-26B-A4B-it-GGUF')).toBeDefined();
  });

  it('resolves GPT-5.6 Sol alias metadata through the canonical model ID', () => {
    expect(getCatalogThinkingCapability('openai', 'gpt-5.6-sol')).toEqual(
      getCatalogThinkingCapability('openai', 'gpt-5.6'),
    );
  });
});

describe('openRouterReasoningCapability', () => {
  it('builds an effort control from supported_efforts + default_effort', () => {
    expect(
      openRouterReasoningCapability({
        supported_efforts: ['high', 'medium', 'low', 'minimal'],
        default_effort: 'medium',
        default_enabled: true,
      }),
    ).toEqual({
      control: 'effort',
      requestAdapter: 'openrouter',
      effortValues: ['high', 'medium', 'low', 'minimal'],
      defaultEffort: 'medium',
      defaultMode: 'enabled',
      toggleable: false,
      budgetAdjustable: true,
      defaultEnabled: true,
    });
  });

  it('treats default_effort "none" as off by default', () => {
    const cap = openRouterReasoningCapability({
      supported_efforts: ['high', 'medium', 'low', 'none'],
      default_effort: 'none',
      default_enabled: false,
    });
    expect(cap).toMatchObject({
      control: 'effort',
      requestAdapter: 'openrouter',
      defaultEffort: 'none',
      defaultMode: 'disabled',
      defaultEnabled: false,
      toggleable: true,
    });
  });

  it('hides the disable toggle for mandatory models', () => {
    const cap = openRouterReasoningCapability({
      supported_efforts: ['high', 'medium', 'low'],
      default_effort: 'medium',
      default_enabled: true,
      mandatory: true,
    });
    expect(cap).toMatchObject({ toggleable: false, defaultEnabled: true });
  });

  it('accepts all gateway efforts when supported_efforts is null', () => {
    const cap = openRouterReasoningCapability({
      supported_efforts: null,
      default_enabled: true,
    });
    expect(cap?.effortValues).toEqual(['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']);
    expect(cap?.defaultEffort).toBe('medium');
  });

  it('returns undefined when the model exposes no effort selection', () => {
    expect(openRouterReasoningCapability(undefined)).toBeUndefined();
    expect(openRouterReasoningCapability(null)).toBeUndefined();
    expect(openRouterReasoningCapability({})).toBeUndefined();
    expect(openRouterReasoningCapability({ supported_efforts: [] })).toBeUndefined();
  });

  it('drops unknown effort values and falls back to a sane default', () => {
    const cap = openRouterReasoningCapability({
      supported_efforts: ['high', 'turbo-9000', 'low'],
      default_effort: 'turbo-9000',
    });
    expect(cap?.effortValues).toEqual(['high', 'low']);
    // 'medium' not listed → first (descending = highest) effort wins.
    expect(cap?.defaultEffort).toBe('high');
  });
});
