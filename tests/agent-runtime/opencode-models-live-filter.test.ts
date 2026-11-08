import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listOpencodeModels = vi.fn();
const listCodexModels = vi.fn();
const listAntigravityModels = vi.fn();
const codexAuthStatus = vi.fn();

vi.mock('@/lib/ai/opencode-cli-models', () => ({
  listOpencodeModels: (...args: unknown[]) => listOpencodeModels(...args),
  invalidateOpencodeModelCache: vi.fn(),
}));

vi.mock('@/lib/ai/codex-app-server', () => ({
  listCodexModels: (...args: unknown[]) => listCodexModels(...args),
}));

vi.mock('@/lib/ai/antigravity-cli-models', () => ({
  listAntigravityModels: (...args: unknown[]) => listAntigravityModels(...args),
}));

vi.mock('@/lib/ai/antigravity-cli-auth', () => ({
  antigravityCliAuthStatus: async () => ({
    bridge: true,
    installed: true,
    authenticated: true,
    message: 'ok',
  }),
}));

vi.mock('@/lib/ai/codex-auth', () => ({
  codexAuthStatus: () => codexAuthStatus(),
}));

describe('activatedDriverModelsDynamic — hanya yang bisa dipakai', () => {
  beforeEach(() => {
    vi.resetModules();
    listOpencodeModels.mockReset();
    listCodexModels.mockReset();
    listAntigravityModels.mockReset();
    codexAuthStatus.mockReset();
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    delete process.env.CODEX_MODELS;
    delete process.env.ANTIGRAVITY_MODELS;
  });

  afterEach(() => {
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    delete process.env.CODEX_MODELS;
    delete process.env.ANTIGRAVITY_MODELS;
  });

  it('irisan allowlist operator dengan hasil `opencode models`', async () => {
    process.env.OPENCODE_MODELS = 'beam-free,big-pickle';
    listOpencodeModels.mockResolvedValue([
      { provider: 'opencode', id: 'big-pickle' },
      { provider: 'opencode', id: 'gpt-6-sol' },
    ]);
    listAntigravityModels.mockResolvedValue([]);
    codexAuthStatus.mockResolvedValue({ installed: true, loggedIn: false, message: 'x' });

    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const models = await m.activatedDriverModelsDynamic();
    expect(models.map((x) => x.id)).toEqual(['big-pickle']);
  });

  it('tanpa allowlist: apa pun yang live-discovery temukan, di kedua provider', async () => {
    listOpencodeModels.mockResolvedValue([
      { provider: 'opencode', id: 'beam-free' },
      { provider: 'opencode-go', id: 'gpt-6-luna' },
    ]);
    listAntigravityModels.mockResolvedValue([]);
    codexAuthStatus.mockResolvedValue({ installed: true, loggedIn: false, message: 'x' });

    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const models = await m.activatedDriverModelsDynamic();
    expect(models.map((x) => x.modelString)).toEqual([
      'opencode:beam-free',
      'opencode-go:gpt-6-luna',
    ]);
  });

  it('discovery gagal/kosong = tidak menampilkan apa pun', async () => {
    process.env.OPENCODE_MODELS = 'beam-free';
    process.env.CODEX_MODELS = 'gpt-6.1-sol';
    process.env.ANTIGRAVITY_MODELS = 'gemini-3.8-flash';
    listOpencodeModels.mockResolvedValue([]);
    listCodexModels.mockResolvedValue([
      {
        id: 'gpt-6.1-sol',
        displayName: 'x',
        reasoningEfforts: [],
        defaultReasoningEffort: null,
        hidden: false,
      },
    ]);
    listAntigravityModels.mockResolvedValue([]);
    codexAuthStatus.mockResolvedValue({ installed: true, loggedIn: false, message: 'x' });

    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const models = await m.activatedDriverModelsDynamic();
    expect(models).toEqual([]);
  });

  it('codex hanya ditampilkan bila `codex login status` berhasil', async () => {
    listOpencodeModels.mockResolvedValue([]);
    listCodexModels.mockResolvedValue([
      {
        id: 'gpt-6.1-sol',
        displayName: 'GPT-6.1-Sol',
        reasoningEfforts: [],
        defaultReasoningEffort: null,
        hidden: false,
      },
    ]);
    listAntigravityModels.mockResolvedValue([]);

    const m = await import('@/lib/server/agent-runtime/opencode-models');

    codexAuthStatus.mockResolvedValue({ installed: true, loggedIn: false, message: 'x' });
    expect(await m.activatedCodexModelsDynamic()).toEqual([]);

    codexAuthStatus.mockResolvedValue({ installed: true, loggedIn: true, message: 'ok' });
    const models = await m.activatedCodexModelsDynamic();
    expect(models.map((x) => x.modelString)).toEqual(['codex:gpt-6.1-sol']);
  });

  it('antigravity hanya ditampilkan bila discovery berhasil', async () => {
    process.env.ANTIGRAVITY_MODELS = 'gemini-3.8-flash';
    listAntigravityModels.mockResolvedValue([]);
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(await m.activatedAntigravityModelsDynamic()).toEqual([]);

    listAntigravityModels.mockResolvedValue([
      { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
    ]);
    const models = await m.activatedAntigravityModelsDynamic();
    expect(models.map((x) => x.modelString)).toEqual(['antigravity:gemini-3.8-flash']);
  });
});
