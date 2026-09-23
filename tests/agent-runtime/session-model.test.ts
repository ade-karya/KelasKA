import { beforeEach, describe, expect, it, vi } from 'vitest';

const opencodeCliMock = vi.hoisted(() => ({ available: false }));

vi.mock('@/lib/ai/opencode-cli', () => ({
  OPENCODE_PROVIDER_ID: 'opencode',
  isOpencodeCliAvailable: () => opencodeCliMock.available,
}));

async function validate(raw: unknown) {
  const { validateSessionModel } = await import('@/lib/server/agent-runtime/session-model');
  return validateSessionModel(raw);
}

describe('validateSessionModel', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    opencodeCliMock.available = false;
    for (const key of Object.keys(process.env)) {
      if (/^(OPENAI|ANTHROPIC|OPENCODE|DEFAULT_MODEL|MODEL_ROUTES)_/.test(key)) {
        delete process.env[key];
      }
    }
  });

  it('accepts nothing when no pin is sent', async () => {
    expect(await validate(undefined)).toEqual({});
    expect(await validate(null)).toEqual({});
  });

  it('rejects non-string and bare model ids', async () => {
    expect((await validate(42)).error).toMatch(/provider:model/);
    expect((await validate('mimo-v2.6-flash-free')).error).toMatch(/explicit provider prefix/);
  });

  it('rejects unregistered providers', async () => {
    expect((await validate(' wat :x')).error).toMatch(/not registered/);
  });

  it('rejects providers without operator credentials', async () => {
    // No OPENAI_API_KEY in this env: client-keyed providers cannot be pinned
    // per session because secrets must never travel into durable rows.
    expect((await validate('openai:gpt-5.4')).error).toMatch(/not server-configured/);
  });

  it('accepts a server-managed opencode pin and canonicalizes it', async () => {
    opencodeCliMock.available = true;
    expect(await validate('opencode:muse-spark-1.3-contributor-free')).toEqual({
      model: 'opencode:muse-spark-1.3-contributor-free',
    });
  });

  it('rejects overlong pins', async () => {
    expect((await validate(`opencode:${'x'.repeat(300)}`)).error).toMatch(/too long/);
  });
});
