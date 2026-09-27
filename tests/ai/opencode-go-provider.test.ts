import { describe, expect, it } from 'vitest';

import { getModelInfo, getProvider, PROVIDERS } from '@/lib/ai/providers';
import { LLM_ENV_MAP } from '@/lib/server/provider-config';

// Provider `opencode-go` = slug CLI `opencode-go/*` (terbukti via
// `opencode models`: opencode-go/gpt-6-luna). Diregistrasi agar
// `opencode-go:gpt-6-luna` lolos resolveModel (tanpa ini: Unknown provider).
describe('provider opencode-go (tier2 Pro Workbench)', () => {
  it('terdaftar di katalog dengan model gpt-6-luna', () => {
    expect(PROVIDERS['opencode-go']).toBeDefined();
    expect(getProvider('opencode-go')?.type).toBe('opencode');
    expect(getModelInfo('opencode-go', 'gpt-6-luna')).toMatchObject({ id: 'gpt-6-luna' });
  });

  it('punya prefix env sendiri untuk jalur HTTP (driver agen)', () => {
    expect(LLM_ENV_MAP.OPENCODE_GO).toBe('opencode-go');
  });

  it('tidak menimpa provider opencode (slug bebas)', () => {
    expect(getProvider('opencode')?.type).toBe('opencode');
    expect(getModelInfo('opencode', 'muse-spark-1.3-contributor-free')).toMatchObject({
      id: 'muse-spark-1.3-contributor-free',
    });
  });
});
