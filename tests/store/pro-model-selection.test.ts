import { describe, expect, it } from 'vitest';

import {
  resolveProModelSelection,
  useSettingsStore,
  type ProvidersConfig,
} from '@/lib/store/settings';
import type { ProviderId } from '@/lib/types/provider';

function llmConfig(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: '',
    baseUrl: '',
    models: [],
    name: 'x',
    type: 'openai',
    requiresApiKey: true,
    isBuiltIn: true,
    ...overrides,
  };
}

function configWithMainAndPro() {
  return {
    openai: llmConfig({
      apiKey: 'sk-test',
      defaultBaseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }],
    }),
    opencode: llmConfig({
      requiresApiKey: false,
      isServerConfigured: true,
      models: [
        { id: 'muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free' },
        { id: 'mimo-v2.6-flash-free', name: 'MiMo-V2.6-Flash Free' },
      ],
    }),
  } as unknown as ProvidersConfig;
}

describe('resolveProModelSelection', () => {
  it('follows the main selection when no Pro pick is stored', () => {
    expect(
      resolveProModelSelection({
        providersConfig: configWithMainAndPro(),
        proProviderId: '',
        proModelId: '',
        providerId: 'openai' as ProviderId,
        modelId: 'gpt-5.4',
      }),
    ).toEqual({ providerId: 'openai', modelId: 'gpt-5.4' });
  });

  it('uses the Pro pick when it is still usable', () => {
    expect(
      resolveProModelSelection({
        providersConfig: configWithMainAndPro(),
        proProviderId: 'opencode' as ProviderId,
        proModelId: 'mimo-v2.6-flash-free',
        providerId: 'openai' as ProviderId,
        modelId: 'gpt-5.4',
      }),
    ).toEqual({ providerId: 'opencode', modelId: 'mimo-v2.6-flash-free' });
  });

  it('falls back to the first catalog model when the Pro model id is stale', () => {
    expect(
      resolveProModelSelection({
        providersConfig: configWithMainAndPro(),
        proProviderId: 'opencode' as ProviderId,
        proModelId: 'retired-model',
        providerId: 'openai' as ProviderId,
        modelId: 'gpt-5.4',
      }),
    ).toEqual({ providerId: 'opencode', modelId: 'muse-spark-1.3-contributor-free' });
  });

  it('falls back to main when the Pro provider is disabled or gone', () => {
    const config = configWithMainAndPro();
    (config.opencode as { enabled?: boolean }).enabled = false;
    expect(
      resolveProModelSelection({
        providersConfig: config,
        proProviderId: 'opencode' as ProviderId,
        proModelId: 'mimo-v2.6-flash-free',
        providerId: 'openai' as ProviderId,
        modelId: 'gpt-5.4',
      }),
    ).toEqual({ providerId: 'openai', modelId: 'gpt-5.4' });

    expect(
      resolveProModelSelection({
        providersConfig: config,
        proProviderId: 'removed' as ProviderId,
        proModelId: 'x',
        providerId: 'openai' as ProviderId,
        modelId: 'gpt-5.4',
      }),
    ).toEqual({ providerId: 'openai', modelId: 'gpt-5.4' });
  });
});

describe('setProModel', () => {
  it('stores the Pro pick without touching the main selection', () => {
    useSettingsStore.getState().setProModel('opencode' as ProviderId, 'mimo-v2.6-flash-free');
    const state = useSettingsStore.getState();
    expect(state.proProviderId).toBe('opencode');
    expect(state.proModelId).toBe('mimo-v2.6-flash-free');
    // Cleanup so no other test observes this pick.
    useSettingsStore.getState().setProModel('', '');
  });
});
