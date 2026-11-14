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
 * no context window, output cap or vision flag for any id (neither endpoint
 * carries one), so the windows below are the mirrored ones from the matching
 * first-party rows in `PROVIDERS` — estimates until CrowLLM itself documents
 * them. Reasoning ships as separate `*-thinking` ids instead of a
 * `reasoning_effort` knob, so no row carries a `thinking` control. Refresh
 * the ids below from the live catalogue instead of guessing them.
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

/**
 * Mirrored from the matching first-party rows in this file: OpenAI `gpt-5.6`,
 * Google Gemini 3, DeepSeek `deepseek-flash` (V4.1 Flash), Qwen3.7 Max, `glm-5.3-flash`
 * (Zhipu), `MiniMax-M3` (MiniMax), Grok 4.6, Tencent Hunyuan `hy3`, Xiaomi
 * `mimo-v2.6-flash`, OpenCode Zen `nemotron-3-ultra-free`, Ollama `llama3.3`,
 * Mistral Medium 3.x. `vision` is claimed only where the underlying model is
 * multimodal in this file's catalogue; `llama-3.3-70b-instruct` omits the
 * output window (no first-party row publishes one).
 */
const WINDOWS: Record<string, { contextWindow: number; outputWindow?: number; vision: boolean }> =
  {
    'gpt-5.6-sol:free': { contextWindow: 1050000, outputWindow: 128000, vision: true },
    'gemini-3.8-flash:free': { contextWindow: 1048576, outputWindow: 65536, vision: true },
    'gemini-3.1-pro:free': { contextWindow: 1048576, outputWindow: 65536, vision: true },
    'deepseek-v4.1-flash:free': { contextWindow: 1048576, outputWindow: 393216, vision: true },
    'qwen-3.8-max:free': { contextWindow: 1000000, outputWindow: 64000, vision: false },
    'glm-5.3-flash:free': { contextWindow: 1000000, outputWindow: 128000, vision: true },
    'minimax-m3.1-flash:free': { contextWindow: 1000000, outputWindow: 32768, vision: true },
    'grok-4.7:free': { contextWindow: 500000, outputWindow: 500000, vision: true },
    'hy4:free': { contextWindow: 256000, outputWindow: 64000, vision: false },
    'mimo-v2.6-flash:free': { contextWindow: 1048576, outputWindow: 131072, vision: true },
    'nemotron-3-ultra-550b-a55b:free': { contextWindow: 256000, outputWindow: 32000, vision: false },
    'llama-3.3-70b-instruct:free': { contextWindow: 131072, vision: false },
    'mistral-medium-3.5:free': { contextWindow: 128000, outputWindow: 16384, vision: true },
  };

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

  it('carries the mirrored first-party limits and shared capabilities', () => {
    for (const model of PROVIDERS.crowllm.models) {
      expect(model.name, model.id).not.toBe(model.id);
      const expected = WINDOWS[model.id];
      expect(expected, model.id).toBeDefined();
      expect(model.contextWindow, model.id).toBe(expected.contextWindow);
      expect(model.outputWindow, model.id).toBe(expected.outputWindow);
      expect(model.capabilities, model.id).toEqual({
        streaming: true,
        tools: true,
        vision: expected.vision,
      });
      // Reasoning is sold as separate `*-thinking` ids: no knob on these rows.
      expect(model.capabilities?.thinking, model.id).toBeUndefined();
    }
  });
});
