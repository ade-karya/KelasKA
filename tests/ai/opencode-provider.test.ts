import { describe, expect, it } from 'vitest';

import { getModel, getModelInfo, getProvider, parseModelString } from '@/lib/ai/providers';

describe('opencode provider registration', () => {
  it('is registered as a keyless local-binary provider', () => {
    const provider = getProvider('opencode');
    expect(provider).toBeDefined();
    expect(provider?.id).toBe('opencode');
    expect(provider?.name).toBe('OpenCode CLI');
    expect(provider?.type).toBe('opencode');
    expect(provider?.requiresApiKey).toBe(false);
    expect(provider?.defaultBaseUrl).toBeUndefined();
    expect(provider?.models.length).toBeGreaterThan(0);
  });

  it('catalogs the free-tier models as streaming text-only', () => {
    const ids = (getProvider('opencode')?.models ?? []).map((m) => m.id);
    expect(ids).toContain('muse-spark-1.3-contributor-free');
    expect(ids).toContain('mimo-v2.6-flash-free');
    for (const model of getProvider('opencode')?.models ?? []) {
      expect(model.capabilities?.streaming).toBe(true);
      // `opencode run` executes its own agent loop and never returns tool
      // calls for the OpenMAIC pi loop — the transport is text-only.
      expect(model.capabilities?.tools).toBe(false);
    }
  });

  it('parses opencode: model strings to the opencode provider', () => {
    expect(parseModelString('opencode:muse-spark-1.3-contributor-free')).toEqual({
      providerId: 'opencode',
      modelId: 'muse-spark-1.3-contributor-free',
    });
  });

  it('resolves model info from the catalog', () => {
    expect(getModelInfo('opencode', 'mimo-v2.6-flash-free')?.name).toBe('MiMo-V2.6-Flash Free');
  });

  it('getModel builds the CLI model without requiring a key', () => {
    const { model, modelInfo } = getModel({
      providerId: 'opencode',
      modelId: 'muse-spark-1.3-contributor-free',
      apiKey: '',
    });
    expect((model as { provider: string }).provider).toBe('opencode');
    expect((model as { modelId: string }).modelId).toBe('muse-spark-1.3-contributor-free');
    expect(modelInfo?.id).toBe('muse-spark-1.3-contributor-free');
  });

  it('getModel rejects base URLs for the local-binary transport', () => {
    expect(() =>
      getModel({
        providerId: 'opencode',
        modelId: 'muse-spark-1.3-contributor-free',
        apiKey: '',
        baseUrl: 'https://example.test/v1',
      }),
    ).toThrow(/does not accept a base URL/);
  });
});
