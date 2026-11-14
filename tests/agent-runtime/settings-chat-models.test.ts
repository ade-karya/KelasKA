import { describe, expect, it } from 'vitest';

import {
  settingsChatModelsFromView,
  type SettingsChatModel,
} from '@/lib/server/agent-runtime/settings-chat-models';
import type { ModelSettingsView } from '@/lib/server/model-config/settings';

function viewOf(providers: ModelSettingsView['providers']): ModelSettingsView {
  return { revision: null, allowUserKeys: true, presets: [], slots: [], providers };
}

describe('settingsChatModelsFromView (HTTP chat models for the workbench picker)', () => {
  it('lists the settings providers’ chat models, never the CLI transports', () => {
    const view = viewOf([
      {
        id: 'google',
        preset: 'google',
        presetName: 'Gemini',
        presetKind: 'single',
        source: 'deployment',
        capabilities: {
          chat: {
            registryId: 'google',
            models: [
              {
                id: 'gemini-3.5-flash-lite',
                name: 'Gemini 3.5 Flash Lite',
                contextWindow: 1_000_000,
                outputWindow: 64_000,
                capabilities: { tools: true, streaming: true },
              },
              // The agent contract needs function tools: leave it out.
              {
                id: 'gemini-3.9-image',
                name: 'No tools here',
                capabilities: { tools: false },
              },
              // No capability metadata: kept, the runtime reports a refusal if wrong.
              { id: 'gemini-3.1-flash-lite', name: '3.1 Lite', capabilities: {} },
            ],
          },
        },
      },
      {
        id: 'funasr',
        preset: 'funasr',
        presetName: 'FunASR',
        presetKind: 'single',
        source: 'deployment',
        capabilities: {
          asr: { registryId: 'funasr', models: [{ id: 'sensevoice', name: 'SenseVoice' }] },
        },
      },
      {
        id: 'opencode',
        preset: 'opencode',
        presetName: 'OpenCode',
        presetKind: 'single',
        source: 'deployment',
        capabilities: {
          chat: {
            registryId: 'opencode',
            models: [
              {
                id: 'muse-spark-1.3-contributor-free',
                name: 'Muse Spark 1.3',
                capabilities: { tools: true },
              },
            ],
          },
        },
      },
    ]);

    const ids = settingsChatModelsFromView(view).map((model) => model.modelString);
    expect(ids).toEqual(['google:gemini-3.5-flash-lite', 'google:gemini-3.1-flash-lite']);
  });

  it('carries the provider name and logo, so the picker can group HTTP providers', () => {
    const view = viewOf([
      {
        id: 'coarena',
        preset: 'coarena',
        presetName: 'Coarena',
        presetKind: 'single',
        source: 'workspace',
        capabilities: {
          chat: {
            registryId: 'coarena',
            models: [
              {
                id: 'muse-spark-1.3',
                name: 'Muse Spark 1.3 (Coarena)',
                capabilities: { tools: true },
              },
            ],
          },
        },
      },
    ]);
    const [model] = settingsChatModelsFromView(view);
    expect(model).toMatchObject({
      provider: 'coarena',
      id: 'muse-spark-1.3',
      modelString: 'coarena:muse-spark-1.3',
      providerName: 'Coarena',
      name: 'Muse Spark 1.3 (Coarena)',
      icon: '/logos/coarena.svg',
    });
    expect(Object.keys(model as SettingsChatModel)).toContain('icon');
  });
});
