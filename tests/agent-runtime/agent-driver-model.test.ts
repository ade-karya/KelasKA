import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelConfigLayer } from '@/lib/server/model-config/resolve-slot';

const mocks = vi.hoisted(() => ({
  streamLLM: vi.fn(),
  resolveModel: vi.fn(),
  modelInfo: undefined as unknown,
  workspaceReads: [] as string[],
}));

vi.mock('@/lib/ai/llm', () => ({ streamLLM: mocks.streamLLM }));
vi.mock('@/lib/server/resolve-model', () => ({ resolveModel: mocks.resolveModel }));
// The connection itself is lib/server/model-config/llm.ts's business; here it
// only echoes the resolution, with the catalogue info a case sets.
vi.mock('@/lib/server/model-config/llm', () => ({
  slotLanguageModel: async (resolution: {
    registryId: string;
    modelId: string;
    baseUrl?: string;
    thinking?: unknown;
  }) => ({
    model: {},
    modelInfo: mocks.modelInfo,
    modelString: `${resolution.registryId}:${resolution.modelId}`,
    providerId: resolution.registryId,
    modelId: resolution.modelId,
    apiKey: 'secret',
    baseUrl: resolution.baseUrl,
    thinkingConfig: resolution.thinking,
    serverManaged: true,
    resolution,
  }),
}));

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
};

function finishedStream() {
  return {
    fullStream: (async function* () {
      yield { type: 'finish', finishReason: 'stop', totalUsage: ZERO_USAGE };
    })(),
    usage: Promise.resolve(ZERO_USAGE),
  };
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of stream) {
    // Drain the protocol stream so the async transport call settles.
  }
}

const providers = {
  openai: { preset: 'openai', apiKey: 'sk' },
  ac: { preset: 'atlascloud', apiKey: 'sk' },
  opencode: { preset: 'opencode', apiKey: 'sk' },
  'opencode-go': { preset: 'opencode-go', apiKey: 'sk' },
};

async function configure(
  agent: unknown,
  { workspace, defaults }: { workspace?: ModelConfigLayer; defaults?: ModelConfigLayer } = {},
) {
  const runtime = await import('@/lib/server/model-config/runtime');
  const slots = agent === undefined ? {} : { agent };
  runtime.setDeploymentConfigForTests({
    layer: { source: 'deployment', config: { providers, slots } as ModelConfigLayer['config'] },
    defaults: defaults ?? null,
    notices: [],
  });
  runtime.setWorkspaceLayerLoaderForTests(async (ownerId) => {
    mocks.workspaceReads.push(ownerId);
    return workspace ?? null;
  });
  return (await import('@/lib/server/agent-runtime/agent-driver-model')).resolveAgentDriverModel;
}

describe('agent driver model', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.streamLLM.mockReset();
    mocks.modelInfo = { contextWindow: 200_000, outputWindow: 16_384 };
    mocks.workspaceReads.length = 0;
  });

  afterEach(async () => {
    const runtime = await import('@/lib/server/model-config/runtime');
    runtime.setDeploymentConfigForTests();
    runtime.setWorkspaceLayerLoaderForTests();
  });

  it('fails loud when nothing assigns the agent', async () => {
    const resolve = await configure(undefined);
    await expect(resolve()).rejects.toThrow('No model is configured for agent');
  });

  it('stays off where an older deployment had no driver route', async () => {
    const resolve = await configure(undefined, {
      defaults: { source: 'default', config: { slots: { llm: 'openai:gpt-5.6', agent: null } } },
    });
    await expect(resolve()).rejects.toThrow('agent capability is turned off');
  });

  it("uses the owner's workspace model", async () => {
    const resolve = await configure(undefined, {
      workspace: { source: 'workspace', config: { slots: { llm: 'openai:gpt-5.6-luna' } } },
    });
    const resolved = await resolve('user:alice');
    expect(mocks.workspaceReads).toEqual(['user:alice']);
    expect(resolved.piModel).toMatchObject({ id: 'gpt-5.6-luna', provider: 'openai' });
  });

  it('fails loud when reasoning effort is configured for the tool-using driver', async () => {
    const resolve = await configure({
      model: 'openai:gpt-5.6-luna',
      thinking: { effort: 'medium' },
    });
    await expect(resolve()).rejects.toThrow('must not set thinking.effort');
  });

  it('drops the effort the agent inherits from the default model and keeps the rest', async () => {
    // The home toolbar writes a thinking level on llm; the agent follows llm.
    const resolve = await configure(undefined, {
      workspace: {
        source: 'workspace',
        config: {
          slots: {
            llm: { model: 'openai:gpt-5.6-luna', thinking: { mode: 'enabled', effort: 'high' } },
          },
        },
      },
    });
    const resolved = await resolve('user:alice');
    expect(resolved.piModel).toMatchObject({ id: 'gpt-5.6-luna', provider: 'openai' });
    expect(resolved.connection.thinkingConfig).toEqual({ mode: 'enabled' });
  });

  it('keeps an inherited "no thinking" as thinking off rather than the model default', async () => {
    const resolve = await configure(undefined, {
      workspace: {
        source: 'workspace',
        config: { slots: { llm: { model: 'openai:gpt-5.6-luna', thinking: { effort: 'none' } } } },
      },
    });
    expect((await resolve('user:alice')).connection.thinkingConfig).toEqual({ mode: 'disabled' });
  });

  it('refuses a model the catalogue says cannot call tools', async () => {
    const resolve = await configure('ac:qwen/qwen3.5-flash');
    await expect(resolve()).rejects.toThrow('does not support tool calling');
  });

  it('defaults the pi API dialect and passes an explicit one through', async () => {
    let resolve = await configure('openai:gpt-5.6-luna');
    expect((await resolve()).piModel).toMatchObject({
      id: 'gpt-5.6-luna',
      provider: 'openai',
      api: 'openai-completions',
    });
    vi.resetModules();
    resolve = await configure({ model: 'openai:gpt-5.6-luna', api: 'openai-responses' });
    expect((await resolve()).piModel.api).toBe('openai-responses');
  });

  it('fails loud for an incompatible pi API dialect', async () => {
    const resolve = await configure({ model: 'openai:gpt-5.6-luna', api: 'anthropic-messages' });
    await expect(resolve()).rejects.toThrow('unsupported pi api/dialect');
  });

  it('uses the provider catalog window when the model is known', async () => {
    const resolved = await (await configure('openai:gpt-5.6-luna'))();
    expect(resolved.piModel.contextWindow).toBe(200_000);
    expect(resolved.piModel.maxTokens).toBe(16_384);
    expect(resolved.wireMaxOutputTokens).toBe(16_384);
    expect(resolved.reservedOutputTokens).toBe(16_384);
  });

  it('falls back to a conservative real window for an unknown model', async () => {
    mocks.modelInfo = null;
    const resolved = await (await configure('openai:some-model'))();
    // The old 1_050_000 fallback made pi's compaction threshold unreachable;
    // the calibrated fallback is a conservative real window.
    expect(resolved.piModel.contextWindow).toBe(128_000);
    expect(resolved.piModel.maxTokens).toBe(8_192);
    expect(resolved.wireMaxOutputTokens).toBeUndefined();
    expect(resolved.reservedOutputTokens).toBe(8_192);
  });

  it('omits the unknown-model output limit even when compaction supplies its reservation', async () => {
    mocks.streamLLM.mockReturnValue(finishedStream());
    const { createCallLlmStreamFn } = await import('@/lib/agent/runtime/stream-fn');
    const streamFn = createCallLlmStreamFn({
      languageModel: {} as never,
      maxOutputTokens: undefined,
      omitMaxOutputTokens: true,
    });

    const stream = await streamFn(
      {} as never,
      { systemPrompt: 'system', messages: [], tools: [] },
      { maxTokens: 8_192 },
    );
    await drain(stream);

    expect(mocks.streamLLM.mock.calls[0]?.[0]?.maxOutputTokens).toBeUndefined();
  });

  it('keeps the catalog output limit on the wire for a known model', async () => {
    mocks.streamLLM.mockReturnValue(finishedStream());
    const { createCallLlmStreamFn } = await import('@/lib/agent/runtime/stream-fn');
    const streamFn = createCallLlmStreamFn({
      languageModel: {} as never,
      maxOutputTokens: 16_384,
    });

    const stream = await streamFn({} as never, { systemPrompt: 'system', messages: [], tools: [] });
    await drain(stream);

    expect(mocks.streamLLM.mock.calls[0]?.[0]?.maxOutputTokens).toBe(16_384);
  });

  it('lets the slot pin a contextWindow below the catalog value', async () => {
    mocks.modelInfo = { contextWindow: 1_050_000, outputWindow: 128_000 };
    const resolved = await (
      await configure({ model: 'openai:gpt-5.6-luna', contextWindow: 32_000 })
    )();
    expect(resolved.piModel.contextWindow).toBe(32_000);
  });
});

describe('agent driver CLI dua provider + thinking varian', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveModel.mockReset();
    mocks.streamLLM.mockReset();
    mocks.modelInfo = { contextWindow: 256_000, outputWindow: 32_000 };
    mocks.workspaceReads.length = 0;
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
  });

  afterEach(async () => {
    const runtime = await import('@/lib/server/model-config/runtime');
    runtime.setDeploymentConfigForTests();
    runtime.setWorkspaceLayerLoaderForTests();
  });

  it('mengizinkan thinking.effort pada slot transport CLI (prompt-level)', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    // Isolasi dari data/agent-driver-model.json repo (tanpa ini override asli
    // ikut terbaca dan jalur yang diuji bukan slot).
    process.env.OPENCODE_ACTIVE_MODEL_FILE = path.join(
      os.tmpdir(),
      `openmaic-test-driver-nooverride-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    // Slot `agent` menunjuk transport CLI: effort legal (prompt-level).
    const resolve = await configure({
      model: 'opencode:big-pickle',
      api: 'opencode-cli',
      thinking: { effort: 'high' },
    });
    const resolved = await resolve();
    expect(resolved).toMatchObject({ isCliDriver: true });
    expect(mocks.resolveModel).not.toHaveBeenCalled();
    expect(resolved.piModel).toMatchObject({ id: 'big-pickle', provider: 'opencode' });
    expect(resolved.wireMaxOutputTokens).toBeUndefined();
  });

  it('override opencode-go + thinking dipakai untuk run berikutnya', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(
      os.tmpdir(),
      `openmaic-test-driver-go-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.OPENCODE_ACTIVE_MODEL_FILE = file;
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    // Slot menunjuk CLI gratis: override tombol berlaku.
    const resolve = await configure({
      model: 'opencode:big-pickle',
      api: 'opencode-cli',
    });
    try {
      const models = await import('@/lib/server/agent-runtime/opencode-models');
      models.writeActiveModelOverride('opencode-go:gpt-6-luna', { effort: 'low' });
      mocks.resolveModel.mockResolvedValue({
        model: {},
        modelInfo: { contextWindow: 256_000, outputWindow: 32_000 },
        modelString: 'opencode-go:gpt-6-luna',
        providerId: 'opencode-go',
        modelId: 'gpt-6-luna',
        apiKey: '',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        thinkingConfig: { mode: 'enabled', effort: 'low' },
      });
      const { resolveAgentDriverModel } =
        await import('@/lib/server/agent-runtime/agent-driver-model');
      const resolved = await resolveAgentDriverModel();
      expect(mocks.resolveModel).toHaveBeenCalledWith({
        modelString: 'opencode-go:gpt-6-luna',
        thinkingConfig: { mode: 'enabled', effort: 'low' },
      });
      expect(resolved.isCliDriver).toBe(true);
      expect(resolved.piModel).toMatchObject({ id: 'gpt-6-luna', provider: 'opencode-go' });
    } finally {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
    }
  });

  it('override di luar allowlist go diabaikan (pakai slot)', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(
      os.tmpdir(),
      `openmaic-test-driver-go2-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    process.env.OPENCODE_MODELS = 'big-pickle';
    // Slot menunjuk CLI gratis; override di luar allowlist -> slot menang.
    const resolve = await configure({
      model: 'opencode:big-pickle',
      api: 'opencode-cli',
    });
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ model: 'opencode-go:tidak-ada', api: 'opencode-cli' }),
      );
      process.env.OPENCODE_ACTIVE_MODEL_FILE = file;
      const resolved = await resolve();
      expect(mocks.resolveModel).not.toHaveBeenCalled();
      expect(resolved.piModel).toMatchObject({ id: 'big-pickle', provider: 'opencode' });
    } finally {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
    }
  });
});
