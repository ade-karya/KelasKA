import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '@/lib/ai/providers';

/**
 * CrowLLM is an OpenAI-compatible gateway ("one key, every model") at
 * https://crowllm.com/v1. GET /v1/models answered 196 ids on 2026-11-14, but
 * it is the whole catalogue for every key: GET /api/pricing marks 83 of those
 * `pro` only, so a free key that picks one is refused. The built-in snapshot
 * therefore lists only ids the free group may run (every one of them ends in
 * `:free`); "Fetch models" adds the rest of the key's own plan via
 * `/api/pricing`, and a paid id can still be added by hand. CrowLLM publishes
 * no context window, output cap or vision flag, and exposes reasoning as
 * separate `*-thinking` ids, so no row carries a `contextWindow` or a
 * `thinking` control. Refresh the ids below from the live catalogue instead of
 * guessing them.
 */
const CATALOG_IDS = `
gpt-5.6-sol:free
gemini-3.8-flash:free
gemini-3.1-pro:free
deepseek-v4.1-flash:free
qwen-3.8-max:free
glm-5.3-flash:free
minimax-m3.1-flash:free
grok-4.7:free
hy4:free
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

  it('lists only free-group ids, without duplicates', () => {
    const ids = PROVIDERS.crowllm.models.map((model) => model.id);
    expect(ids).toEqual(CATALOG_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // The free group is the only group a key without a plan may run, so the
      // shipped snapshot must not offer a paid row (they end in `:free`).
      expect(id.endsWith(':free'), id).toBe(true);
    }
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
