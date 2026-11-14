import { describe, expect, it } from 'vitest';
import { MONO_LOGO_PROVIDERS, PROVIDERS } from '@/lib/ai/providers';
import { getCatalogThinkingCapability } from '@/lib/ai/model-metadata';

/**
 * Coarena's free Model API ships as a normal OpenAI-compatible chat provider.
 * The catalog snapshot below comes from GET https://coarena.ai/api/v1/models
 * (2026-11-14): zero-cost rows with 128k input, 16k output, images, tools and
 * reasoning, served through the OpenAI-compatible endpoint. Its
 * Anthropic-compatible endpoint is deliberately not wired: the same catalog is
 * reachable through `/api/v1`, which also answers model discovery.
 */
describe('coarena provider', () => {
  it('uses the OpenAI-compatible endpoint and supports live model discovery', () => {
    const provider = PROVIDERS.coarena;
    expect(provider).toMatchObject({
      id: 'coarena',
      name: 'Coarena',
      type: 'openai',
      defaultBaseUrl: 'https://coarena.ai/api/v1',
      supportsModelDiscovery: true,
      requiresApiKey: true,
      icon: '/logos/coarena.svg',
    });
    expect(MONO_LOGO_PROVIDERS.has('coarena')).toBe(true);
  });

  it('lists every catalog model with its published window and capabilities', () => {
    const models = PROVIDERS.coarena.models;
    expect(models.map((model) => model.id)).toEqual([
      'claude-fable-5',
      'claude-fable-5-1',
      'claude-fable-5-2',
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'deepseek-v4-1-flash-1017',
      'gemini-3-8-flash',
      'gemini-4-argon',
      'gemini-4-carbon',
      'glm-5-3-flash',
      'gpt-6-1-sol',
      'gpt-6-1-terra',
      'gpt-6-astra',
      'gpt-6-luna',
      'grok-4-7',
      'hy4',
      'kimi-k3-1-pro',
      'mimo-v2-6-pro',
      'minimax-m3-1-flash',
    ]);
    for (const model of models) {
      expect(model.contextWindow, model.id).toBe(128000);
      expect(model.outputWindow, model.id).toBe(16384);
      expect(model.capabilities, model.id).toMatchObject({
        streaming: true,
        tools: true,
        vision: true,
      });
    }
  });

  it.each([
    ['claude-fable-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-fable-5-1', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-fable-5-2', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-haiku-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-sonnet-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['deepseek-v4-1-flash-1017', ['none', 'high', 'max']],
    ['gemini-3-8-flash', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['gemini-4-argon', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['gemini-4-carbon', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['glm-5-3-flash', ['low', 'medium', 'high']],
    ['gpt-6-1-sol', ['low', 'medium', 'high', 'xhigh']],
    ['gpt-6-1-terra', ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-6-astra', ['low', 'medium', 'high', 'xhigh']],
    ['gpt-6-luna', ['none', 'low', 'medium', 'high', 'xhigh']],
    ['grok-4-7', ['low', 'medium', 'high', 'xhigh']],
    ['hy4', ['low', 'medium', 'high']],
    ['kimi-k3-1-pro', ['low', 'high']],
    ['mimo-v2-6-pro', ['low', 'medium', 'high']],
    ['minimax-m3-1-flash', ['low', 'medium', 'high']],
  ] as const)('maps %s to the effort ladder its catalog row advertises', (modelId, efforts) => {
    const capability = getCatalogThinkingCapability('coarena', modelId);
    // Coarena is an OpenAI-compatible gateway: thinking is `reasoning_effort`.
    expect(capability?.requestAdapter).toBe('openai');
    expect(capability?.effortValues).toEqual(efforts);
  });
});
