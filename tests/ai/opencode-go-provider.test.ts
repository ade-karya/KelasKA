import { describe, expect, it } from 'vitest';

import { getModelInfo, getProvider, PROVIDERS } from '@/lib/ai/providers';
import { LLM_ENV_MAP } from '@/lib/server/provider-config';

// Provider `opencode-go` = slug CLI `opencode-go/*` (terbukti via
// `opencode models`). Diregistrasi agar `opencode-go:*` lolos resolveModel
// (tanpa ini: Unknown provider) dan tampil di pemilih model workbench.
describe('provider opencode-go (tier2 + workbench picker)', () => {
  it('terdaftar di katalog dengan model gpt-6-luna', () => {
    expect(PROVIDERS['opencode-go']).toBeDefined();
    expect(getProvider('opencode-go')?.type).toBe('opencode');
    expect(getModelInfo('opencode-go', 'gpt-6-luna')).toMatchObject({ id: 'gpt-6-luna' });
  });

  it('mencerminkan katalog live `opencode models` (provider opencode-go/*)', () => {
    const ids = PROVIDERS['opencode-go'].models.map((m) => m.id);
    for (const id of [
      'deepseek-v4-pro',
      'glm-5.3',
      'gpt-5.6-luna',
      'gpt-6-luna',
      'kimi-k3',
      'muse-spark-1.3-contributor',
      'qwen3.8-max',
      'space-bunny-free',
      'longcat-2.5-preview-free',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('setiap model membawa varian thinking effort (prompt-level CLI)', () => {
    for (const m of PROVIDERS['opencode-go'].models) {
      expect(m.capabilities?.thinking).toMatchObject({
        control: 'effort',
        requestAdapter: 'opencode',
      });
    }
    for (const m of PROVIDERS.opencode.models) {
      expect(m.capabilities?.thinking).toMatchObject({
        control: 'effort',
        requestAdapter: 'opencode',
      });
    }
  });

  it('punya prefix env sendiri untuk jalur HTTP (driver agen)', () => {
    expect(LLM_ENV_MAP.OPENCODE_GO).toBe('opencode-go');
  });

  it('tidak menimpa provider opencode (slug bebas)', () => {
    expect(getProvider('opencode')?.type).toBe('opencode');
    expect(getModelInfo('opencode', 'muse-spark-1.3-contributor-free')).toMatchObject({
      id: 'muse-spark-1.3-contributor-free',
    });
    expect(getModelInfo('opencode', 'fledge-alpha-free')).toMatchObject({
      id: 'fledge-alpha-free',
    });
  });
});
