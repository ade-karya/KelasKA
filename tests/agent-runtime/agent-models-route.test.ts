import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

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
    process.env.MODEL_ROUTES = JSON.stringify({
      'maic-agent-driver': {
        model: 'opencode:muse-spark-1.3-contributor-free',
        api: 'opencode-cli',
      },
    });
  });

  afterEach(() => {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
    delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    delete process.env.MODEL_ROUTES;
  });

  it('GET mengembalikan semua model aktif kedua provider + model driver saat ini', async () => {
    const { GET } = await import('@/app/api/agent/models/route.ts');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      active: string;
      models: Array<{ provider: string; modelString: string; thinking?: unknown }>;
    };
    expect(body.active).toBe('opencode:muse-spark-1.3-contributor-free');
    expect(body.models.map((m) => m.modelString)).toEqual([
      'opencode:space-bunny-free',
      'opencode:muse-spark-1.3-contributor-free',
      'opencode:big-pickle',
      'opencode-go:gpt-6-luna',
    ]);
    expect(body.models[0].provider).toBe('opencode');
    expect(body.models[3].provider).toBe('opencode-go');
    // Setiap model membawa capability thinking untuk kontrol varian.
    for (const m of body.models) {
      expect(m.thinking).toMatchObject({ control: 'effort' });
    }
  });

  it('POST memilih model aktif dan GET berikutnya memakai override', async () => {
    const { GET, POST } = await import('@/app/api/agent/models/route.ts');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'opencode:big-pickle' }),
    });
    const postRes = await POST(req as unknown as Request);
    expect(postRes.status).toBe(200);
    expect(((await postRes.json()) as { active: string }).active).toBe('opencode:big-pickle');

    const getRes = await GET();
    const getBody = (await getRes.json()) as { active: string; source: string };
    expect(getBody.active).toBe('opencode:big-pickle');
    expect(getBody.source).toBe('workbench-override');
  });

  it('POST memilih model opencode-go beserta varian thinking', async () => {
    const { GET, POST } = await import('@/app/api/agent/models/route.ts');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'opencode-go:gpt-6-luna', thinking: { effort: 'high' } }),
    });
    const postRes = await POST(req as unknown as Request);
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
    const { POST } = await import('@/app/api/agent/models/route.ts');
    const req = new NextRequest('http://localhost/api/agent/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'opencode:tidak-ada' }),
    });
    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
  });
});

describe('grup Go disembunyikan bila belum login (OPENCODE_GO_MODELS kosong)', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(async () => {
    vi.resetModules();
    process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgres://openmaic:pw@localhost:5432/openmaic';
    process.env.MODEL_ROUTES = JSON.stringify({
      'maic-agent-driver': { model: 'opencode:big-pickle', api: 'opencode-cli' },
    });
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = '';
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('GET hanya model opencode; POST Go ditolak', async () => {
    const { GET, POST } = await import('@/app/api/agent/models/route.ts');
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
    expect((await POST(req as unknown as Request)).status).toBe(400);
  });
});
