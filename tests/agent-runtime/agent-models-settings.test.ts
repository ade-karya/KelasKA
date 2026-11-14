import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  opencodeModels: [] as { provider: 'opencode' | 'opencode-go'; id: string }[],
  codexModels: [] as Array<{
    id: string;
    displayName: string;
    description: string;
    reasoningEfforts: string[];
    defaultReasoningEffort: string;
    hidden: boolean;
  }>,
  agModels: [] as { id: string; displayName: string }[],
}));

const LIVE_OPENCODE = [
  { provider: 'opencode' as const, id: 'muse-spark-1.3-contributor-free' },
  { provider: 'opencode' as const, id: 'big-pickle' },
];
const CODEX = [
  {
    id: 'gpt-5.6-codex',
    displayName: 'GPT-5.6 Codex',
    description: '',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high',
    hidden: false,
  },
];
const AG_MODELS = [{ id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' }];

vi.mock('@/lib/ai/opencode-cli-models', () => ({
  listOpencodeModels: async () => mocks.opencodeModels,
  invalidateOpencodeModelCache: () => {},
}));
vi.mock('@/lib/ai/codex-app-server', () => ({
  listCodexModels: async () => mocks.codexModels,
  invalidateCodexModelCache: () => {},
}));
vi.mock('@/lib/ai/codex-auth', () => ({
  codexAuthStatus: async () => ({ installed: true, loggedIn: true, message: 'ok' }),
}));
vi.mock('@/lib/ai/antigravity-cli-models', () => ({
  listAntigravityModels: async () => mocks.agModels,
}));
vi.mock('@/lib/ai/antigravity-cli-auth', () => ({
  antigravityCliAuthStatus: async () => ({
    bridge: true,
    installed: true,
    authenticated: true,
    message: 'ok',
  }),
}));

const providers = {
  opencode: { preset: 'opencode', apiKey: 'sk' },
  google: {
    preset: 'google',
    apiKey: 'sk-google',
    // The installer's managed list, as in openmaic.yml: deployment-managed
    // providers only authorize the models they name (plus slot references).
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  },
};

async function configureDeployment() {
  const runtime = await import('@/lib/server/model-config/runtime');
  runtime.setDeploymentConfigForTests({
    layer: {
      source: 'deployment',
      config: {
        providers,
        slots: {
          agent: { model: 'opencode:muse-spark-1.3-contributor-free', api: 'opencode-cli' },
        },
      } as never,
    },
    legacy: false,
    notices: [],
  });
  runtime.setWorkspaceLayerLoaderForTests(async () => null);
}

describe('workbench picker: every model from the model settings, over HTTP', () => {
  let file = '';

  beforeEach(async () => {
    vi.resetModules();
    file = path.join(
      os.tmpdir(),
      `openmaic-test-http-driver-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.OPENCODE_ACTIVE_MODEL_FILE = file;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://openmaic:pw@localhost:5432/openmaic';
    process.env.OPENCODE_MODELS = 'muse-spark-1.3-contributor-free,big-pickle';
    mocks.opencodeModels = [...LIVE_OPENCODE];
    mocks.codexModels = CODEX.map((m) => ({ ...m }));
    mocks.agModels = AG_MODELS.map((m) => ({ ...m }));
    await configureDeployment();
  });

  afterEach(async () => {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
    delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
    delete process.env.OPENCODE_MODELS;
    const runtime = await import('@/lib/server/model-config/runtime');
    runtime.setDeploymentConfigForTests(undefined);
    runtime.setWorkspaceLayerLoaderForTests(undefined);
  });

  it('GET lists the CLI transports first, then the settings’ HTTP chat models', async () => {
    const { GET } = await import('@/app/api/agent/models/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: Array<{ modelString: string; provider: string; transport?: string }>;
    };
    const cli = body.models.filter((m) => m.transport === 'cli').map((m) => m.modelString);
    const http = body.models.filter((m) => m.transport === 'http').map((m) => m.modelString);
    expect(cli).toEqual([
      'opencode:muse-spark-1.3-contributor-free',
      'opencode:big-pickle',
      'codex:gpt-5.6-codex',
      'antigravity:gemini-3.8-flash',
    ]);
    expect(http).toContain('google:gemini-3.5-flash-lite');
    expect(http.every((id) => id.startsWith('google:'))).toBe(true);
    // No CLI provider appears twice, and HTTP models carry no thinking effort.
    expect(
      body.models.filter((m) => m.transport === 'http').every((m) => !m.id.includes('opencode')),
    ).toBe(true);
  });

  it('POST accepts a settings model and stores the HTTP marker; GET resolves it', async () => {
    const { GET, POST } = await import('@/app/api/agent/models/route');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'google:gemini-3.5-flash-lite' }),
    });
    const postRes = await POST(req);
    expect(postRes.status).toBe(200);
    expect(((await postRes.json()) as { active: string }).active).toBe(
      'google:gemini-3.5-flash-lite',
    );
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      model: 'google:gemini-3.5-flash-lite',
      api: 'http',
    });

    const getRes = await GET();
    const getBody = (await getRes.json()) as { active: string; source: string };
    expect(getBody.active).toBe('google:gemini-3.5-flash-lite');
    expect(getBody.source).toBe('workbench-override');
  });

  it('POST refuses a model the settings do not offer', async () => {
    const { POST } = await import('@/app/api/agent/models/route');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'google:not-a-real-model' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('the stored HTTP selection drives the run over the HTTP path', async () => {
    const { POST } = await import('@/app/api/agent/models/route');
    const postRes = await POST(
      new NextRequest('http://localhost/api/agent/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'google:gemini-3.5-flash-lite' }),
      }),
    );
    expect(postRes.status).toBe(200);

    const { resolveAgentDriverModel } =
      await import('@/lib/server/agent-runtime/agent-driver-model');
    const driver = await resolveAgentDriverModel(null);
    expect(driver.driverTransport).toBe('http');
    expect(driver.isCliDriver).toBe(false);
    expect(driver.connection.providerId).toBe('google');
    expect(driver.connection.modelId).toBe('gemini-3.5-flash-lite');
  });
});
