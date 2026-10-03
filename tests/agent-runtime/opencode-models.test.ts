import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('model CLI opencode/opencode-go (installer + workbench picker)', () => {
  let file = '';

  beforeEach(async () => {
    vi.resetModules();
    file = path.join(
      os.tmpdir(),
      `openmaic-test-override-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.OPENCODE_ACTIVE_MODEL_FILE = file;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  });

  afterEach(() => {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
    delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
  });

  it('mengaktifkan model kedua provider dari env', async () => {
    process.env.OPENCODE_MODELS = 'space-bunny-free,muse-spark-1.3-contributor-free,big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna,deepseek-v4-pro';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.activatedOpencodeIds('opencode')).toEqual([
      'space-bunny-free',
      'muse-spark-1.3-contributor-free',
      'big-pickle',
    ]);
    expect(m.activatedOpencodeIds('opencode-go')).toEqual(['gpt-6-luna', 'deepseek-v4-pro']);
    expect(m.activatedOpencodeModels().map((x: { modelString: string }) => x.modelString)).toEqual([
      'opencode:space-bunny-free',
      'opencode:muse-spark-1.3-contributor-free',
      'opencode:big-pickle',
      'opencode-go:gpt-6-luna',
      'opencode-go:deepseek-v4-pro',
    ]);
    expect(m.defaultTier3ModelString()).toBe('opencode:muse-spark-1.3-contributor-free');
  });

  it('setiap model aktif membawa provider + capability thinking', async () => {
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const models = m.activatedOpencodeModels();
    expect(models[0]).toMatchObject({ provider: 'opencode', id: 'big-pickle' });
    expect(models[0].thinking).toMatchObject({ control: 'effort' });
    expect(models[1]).toMatchObject({ provider: 'opencode-go', id: 'gpt-6-luna' });
    expect(models[1].thinking).toMatchObject({ control: 'effort' });
  });

  it('menghormati daftar operator apa adanya (tanpa menyuntik default)', async () => {
    process.env.OPENCODE_MODELS = 'space-bunny-free,big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.activatedOpencodeIds('opencode')).toEqual(['space-bunny-free', 'big-pickle']);
    expect(m.defaultTier3ModelString()).toBe('opencode:space-bunny-free');
  });

  it('fallback katalog bila env kosong (kedua provider)', async () => {
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const ids = m.activatedOpencodeIds('opencode');
    expect(ids).toContain('muse-spark-1.3-contributor-free');
    expect(ids).toContain('fledge-alpha-free');
    expect(m.activatedOpencodeIds('opencode-go')).toContain('gpt-6-luna');
  });

  it('parse input dua provider + bare kompatibel lama', async () => {
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.parseOpencodeModelInput('opencode:big-pickle')).toMatchObject({
      provider: 'opencode',
      bare: 'big-pickle',
      modelString: 'opencode:big-pickle',
    });
    expect(m.parseOpencodeModelInput('opencode-go:gpt-6-luna')).toMatchObject({
      provider: 'opencode-go',
      bare: 'gpt-6-luna',
      modelString: 'opencode-go:gpt-6-luna',
    });
    expect(m.parseOpencodeModelInput('opencode-go/gpt-6-luna')).toMatchObject({
      provider: 'opencode-go',
      bare: 'gpt-6-luna',
    });
    expect(m.parseOpencodeModelInput('big-pickle')).toMatchObject({
      provider: 'opencode',
      bare: 'big-pickle',
    });
    expect(m.parseOpencodeModelInput('')).toBeNull();
    expect(m.parseOpencodeModelInput('opencode-go:')).toBeNull();
  });

  it('menolak model di luar allowlist saat memilih aktif', async () => {
    process.env.OPENCODE_MODELS = 'space-bunny-free,muse-spark-1.3-contributor-free';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(() => m.writeActiveModelOverride('opencode:tidak-ada')).toThrow();
    expect(() => m.writeActiveModelOverride('opencode-go:tidak-ada')).toThrow();
    const saved = m.writeActiveModelOverride('space-bunny-free');
    expect(saved.modelString).toBe('opencode:space-bunny-free');
    expect(m.readActiveModelOverride()?.modelString).toBe('opencode:space-bunny-free');
  });

  it('menyimpan + membaca override opencode-go beserta varian thinking', async () => {
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const saved = m.writeActiveModelOverride('opencode-go:gpt-6-luna', { effort: 'high' });
    expect(saved.modelString).toBe('opencode-go:gpt-6-luna');
    expect(saved.thinking).toMatchObject({ mode: 'enabled', effort: 'high' });
    const read = m.readActiveModelOverride();
    expect(read?.modelString).toBe('opencode-go:gpt-6-luna');
    expect(read?.thinking).toMatchObject({ mode: 'enabled', effort: 'high' });
  });

  it('menormalkan varian thinking tak dikenal ke default capability', async () => {
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const saved = m.writeActiveModelOverride('opencode:big-pickle', { effort: 'ultra' });
    expect(saved.thinking).toMatchObject({ effort: 'medium' });
  });
});

describe('varian natif per model (cermin /variants CLI)', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
  });

  it('effortValues mengikuti himpunan natif terverifikasi per model', async () => {
    process.env.OPENCODE_MODELS =
      'muse-spark-1.3-contributor-free,space-bunny-free,fledge-alpha-free,big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const byId = new Map(m.activatedOpencodeModels().map((x) => [x.modelString, x]));
    expect(byId.get('opencode:muse-spark-1.3-contributor-free')?.thinking?.effortValues).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(byId.get('opencode:space-bunny-free')?.thinking?.effortValues).toEqual([
      'low',
      'medium',
      'high',
      'max',
      'xhigh',
    ]);
    expect(byId.get('opencode:fledge-alpha-free')?.thinking?.effortValues).toEqual([
      'low',
      'high',
      'max',
    ]);
    // Tanpa varian natif: set generik prompt-hint.
    expect(byId.get('opencode:big-pickle')?.thinking?.effortValues).toContain('none');
  });

  it('inferensi keluarga Go memakai set gaya OpenAI', async () => {
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna,kimi-k3';
    delete process.env.OPENCODE_MODELS;
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const byId = new Map(m.activatedOpencodeModels().map((x) => [x.modelString, x]));
    expect(byId.get('opencode-go:gpt-6-luna')?.thinking?.effortValues).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    // kimi-k3 terverifikasi tanpa varian natif: generik prompt-hint.
    expect(byId.get('opencode-go:kimi-k3')?.thinking?.effortValues).toContain('none');
  });
});

describe('grup Go disembunyikan bila belum login', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
  });

  it('env kosong eksplisit = hidden (tanpa fallback katalog)', async () => {
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = '';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.activatedOpencodeIds('opencode-go')).toEqual([]);
    expect(m.activatedOpencodeModels().map((x: { modelString: string }) => x.modelString)).toEqual([
      'opencode:big-pickle',
    ]);
    expect(m.isActivatedOpencodeId('gpt-6-luna', 'opencode-go')).toBe(false);
  });

  it('env tak ada (unset) = fallback katalog (instalasi manual/dev)', async () => {
    process.env.OPENCODE_MODELS = 'big-pickle';
    delete process.env.OPENCODE_GO_MODELS;
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.activatedOpencodeIds('opencode-go')).toContain('gpt-6-luna');
  });

  it('override Go basi ditolak saat hidden (self-healing ke route)', async () => {
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = '';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(() => m.writeActiveModelOverride('opencode-go:gpt-6-luna')).toThrow();
  });
});
