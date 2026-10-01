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
    process.env.OPENCODE_MODELS =
      'space-bunny-free,muse-spark-1.3-contributor-free,big-pickle';
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
    delete process.env.MODEL_ROUTES;
  });

  it('GET mengembalikan semua model aktif + model driver saat ini', async () => {
    const { GET } = await import('@/app/api/agent/models/route.ts');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      active: string;
      models: Array<{ modelString: string }>;
    };
    expect(body.active).toBe('opencode:muse-spark-1.3-contributor-free');
    expect(body.models.map((m) => m.modelString)).toEqual([
      'opencode:space-bunny-free',
      'opencode:muse-spark-1.3-contributor-free',
      'opencode:big-pickle',
    ]);
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
