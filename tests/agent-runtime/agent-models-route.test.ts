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
  { provider: 'opencode' as const, id: 'space-bunny-free' },
  { provider: 'opencode' as const, id: 'muse-spark-1.3-contributor-free' },
  { provider: 'opencode' as const, id: 'big-pickle' },
  // Tidak di allowlist operator: tidak boleh tampil.
  { provider: 'opencode' as const, id: 'not-activated-free' },
  { provider: 'opencode-go' as const, id: 'gpt-6-luna' },
];

const CODEX_MODELS = [
  {
    id: 'gpt-5.6-codex',
    displayName: 'GPT-5.6 Codex',
    description: '',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high',
    hidden: false,
  },
  {
    id: 'gpt-5.5-codex',
    displayName: 'GPT-5.5 Codex',
    description: '',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
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
  'opencode-go': { preset: 'opencode-go', apiKey: 'sk' },
  codex: { preset: 'codex' },
  antigravity: { preset: 'antigravity' },
};

async function configureSlot(agent: { model: string; api: string }) {
  const runtime = await import('@/lib/server/model-config/runtime');
  runtime.setDeploymentConfigForTests({
    layer: {
      source: 'deployment',
      config: { providers, slots: { agent } } as never,
    },
    legacy: false,
    notices: [],
  });
  runtime.setWorkspaceLayerLoaderForTests(async () => null);
}

async function resetSlot() {
  const runtime = await import('@/lib/server/model-config/runtime');
  runtime.setDeploymentConfigForTests(undefined);
  runtime.setWorkspaceLayerLoaderForTests(undefined);
}

describe('GET/POST /api/agent/models (tombol pemilih model workbench)', () => {
  let file = '';

  beforeEach(async () => {
    vi.resetModules();
    file = path.join(
      os.tmpdir(),
      `openmaic-test-override-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.OPENCODE_ACTIVE_MODEL_FILE = file;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://openmaic:pw@localhost:5432/openmaic';
    process.env.OPENCODE_MODELS = 'space-bunny-free,muse-spark-1.3-contributor-free,big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    delete process.env.CODEX_MODELS;
    process.env.ANTIGRAVITY_MODELS = 'gemini-3.8-flash';
    mocks.opencodeModels = [...LIVE_OPENCODE];
    mocks.codexModels = CODEX_MODELS.map((m) => ({ ...m }));
    mocks.agModels = AG_MODELS.map((m) => ({ ...m }));
    await configureSlot({ model: 'opencode:muse-spark-1.3-contributor-free', api: 'opencode-cli' });
  });

  afterEach(async () => {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
    delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    delete process.env.CODEX_MODELS;
    delete process.env.ANTIGRAVITY_MODELS;
    await resetSlot();
  });

  it('POST memilih model codex beserta varian thinking (api codex-sdk)', async () => {
    const { GET, POST } = await import('@/app/api/agent/models/route');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codex:gpt-5.6-codex', thinking: { effort: 'high' } }),
    });
    const postRes = await POST(req);
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as { active: string; thinking: { effort: string } };
    expect(postBody.active).toBe('codex:gpt-5.6-codex');
    expect(postBody.thinking).toMatchObject({ effort: 'high' });

    const getRes = await GET();
    const getBody = (await getRes.json()) as {
      active: string;
      source: string;
      thinking: { effort: string };
    };
    expect(getBody.active).toBe('codex:gpt-5.6-codex');
    expect(getBody.source).toBe('workbench-override');
    expect(getBody.thinking).toMatchObject({ effort: 'high' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      model: 'codex:gpt-5.6-codex',
      api: 'codex-sdk',
    });
  });

  it('GET mengembalikan model yang bisa dipakai akun login (hasil penemuan live)', async () => {
    const { GET } = await import('@/app/api/agent/models/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      active: string;
      models: Array<{ provider: string; modelString: string; thinking?: { control?: string } }>;
    };
    expect(body.active).toBe('opencode:muse-spark-1.3-contributor-free');
    expect(body.models.map((m) => m.modelString)).toEqual([
      'opencode:space-bunny-free',
      'opencode:muse-spark-1.3-contributor-free',
      'opencode:big-pickle',
      'opencode-go:gpt-6-luna',
      'codex:gpt-5.6-codex',
      'codex:gpt-5.5-codex',
      'antigravity:gemini-3.8-flash',
    ]);
    expect(body.models[0].provider).toBe('opencode');
    expect(body.models[3].provider).toBe('opencode-go');
    expect(body.models[4].provider).toBe('codex');
    expect(body.models[6].provider).toBe('antigravity');
    // OpenCode/Codex membawa capability thinking; Antigravity tidak (varian effort dirangkum di id model).
    for (const m of body.models) {
      if (m.provider === 'antigravity') expect(m.thinking).toBeUndefined();
      else expect(m.thinking).toMatchObject({ control: 'effort' });
    }
  });

  it('POST memilih model aktif dan GET berikutnya memakai override', async () => {
    const { GET, POST } = await import('@/app/api/agent/models/route');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'opencode:big-pickle' }),
    });
    const postRes = await POST(req);
    expect(postRes.status).toBe(200);
    expect(((await postRes.json()) as { active: string }).active).toBe('opencode:big-pickle');

    const getRes = await GET();
    const getBody = (await getRes.json()) as { active: string; source: string };
    expect(getBody.active).toBe('opencode:big-pickle');
    expect(getBody.source).toBe('workbench-override');
  });

  it('POST memilih model opencode-go beserta varian thinking', async () => {
    const { GET, POST } = await import('@/app/api/agent/models/route');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'opencode-go:gpt-6-luna', thinking: { effort: 'high' } }),
    });
    const postRes = await POST(req);
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as { active: string; thinking: { effort: string } };
    expect(postBody.active).toBe('opencode-go:gpt-6-luna');
    expect(postBody.thinking).toMatchObject({ effort: 'high' });

    const getRes = await GET();
    const getBody = (await getRes.json()) as {
      active: string;
      source: string;
      thinking: { effort: string };
    };
    expect(getBody.active).toBe('opencode-go:gpt-6-luna');
    expect(getBody.source).toBe('workbench-override');
    expect(getBody.thinking).toMatchObject({ effort: 'high' });
  });

  it('POST menolak model di luar allowlist', async () => {
    const { POST } = await import('@/app/api/agent/models/route');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'opencode:tidak-ada' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('grup disembunyikan bila akun tidak punya model (penemuan live kosong)', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    vi.resetModules();
    process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://openmaic:pw@localhost:5432/openmaic';
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = '';
    process.env.CODEX_MODELS = '';
    process.env.ANTIGRAVITY_MODELS = '';
    await configureSlot({ model: 'opencode:big-pickle', api: 'opencode-cli' });
  });

  afterEach(async () => {
    process.env = { ...OLD_ENV };
    await resetSlot();
  });

  it('GET hanya model opencode; POST Go dan Codex ditolak', async () => {
    // Akun ini hanya punya big-pickle (penemuan live); grup Go/Codex/Antigravity kosong.
    mocks.opencodeModels = [{ provider: 'opencode', id: 'big-pickle' }];
    mocks.codexModels = [];
    mocks.agModels = [];
    const { GET, POST } = await import('@/app/api/agent/models/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      models: Array<{ modelString: string }>;
    };
    expect(body.models.map((m) => m.modelString)).toEqual(['opencode:big-pickle']);

    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'opencode-go:gpt-6-luna' }),
    });
    expect((await POST(req)).status).toBe(400);

    const codexReq = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'codex:gpt-5.6-codex' }),
    });
    expect((await POST(codexReq)).status).toBe(400);
  });
});
