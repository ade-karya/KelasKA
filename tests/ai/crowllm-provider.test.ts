import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/lib/ai/providers';

/**
 * CrowLLM is an OpenAI-compatible gateway ("one key, every model") at
 * https://crowllm.com/v1. GET /v1/models answered 196 chat ids on 2026-11-14
 * (a free group plus paid tiers), so the built-in catalogue is a curated
 * flagship-per-vendor snapshot; "Fetch models" appends the rest from the live
 * endpoint. CrowLLM publishes no context window, output cap or vision flag,
 * and exposes reasoning as separate `*-thinking` ids, so no row carries a
 * `contextWindow` or a `thinking` control. Refresh the ids below from the live
 * catalogue instead of guessing them.
 */
const CATALOG_IDS = `
gpt-6-sol
gpt-5.6-sol:free
claude-opus-5-5
claude-sonnet-5-5
claude-haiku-5-5
gemini-3.8-flash
gemini-3.8-flash:free
gemini-3.1-pro:free
deepseek-v4.1-flash
deepseek-v4.1-flash:free
deepseek-v4-pro
qwen3.8-max
qwen-3.8-max:free
qwen3.8-flash
kimi-k3.1-pro
kimi-k2.6
glm-5.3
glm-5.3-flash:free
minimax-m3
minimax-m3.1-flash:free
grok-4.7
grok-4.7:free
hy4-preview
hy4:free
mimo-v2.6-pro
mimo-v2.6-flash:free
nemotron-3-ultra-550b-a55b:free
llama-3.3-70b-instruct:free
mistral-medium-3.5:free
`
  .trim()
  .split(/\s+/);

describe('crowllm provider', () => {
  it('uses the OpenAI-compatible endpoint and supports live model discovery', () => {
    expect(PROVIDERS.crowllm).toMatchObject({
      id: 'crowllm',
      name: 'CrowLLM',
      type: 'openai',
      defaultBaseUrl: 'https://crowllm.com/v1',
      supportsModelDiscovery: true,
      requiresApiKey: true,
      icon: '/logos/crowllm.svg',
    });
  });

  it('lists the curated flagship ids without duplicates', () => {
    const ids = PROVIDERS.crowllm.models.map((model) => model.id);
    expect(ids).toEqual(CATALOG_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('claims only the capabilities every listed chat model shares', () => {
    for (const model of PROVIDERS.crowllm.models) {
      expect(model.name, model.id).not.toBe(model.id);
      expect(model.capabilities, model.id).toEqual({ streaming: true, tools: true });
      // Windows and reasoning are not published per id: keep them unset so the
      // app's 128k prompt budget applies and no unsupported knob is sent.
      expect(model.contextWindow, model.id).toBeUndefined();
      expect(model.outputWindow, model.id).toBeUndefined();
    }
  });
});
