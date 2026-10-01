import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('opencode free models (installer + workbench picker)', () => {
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
  });

  it('mengaktifkan semua model free dari OPENCODE_MODELS', async () => {
    process.env.OPENCODE_MODELS =
      'space-bunny-free,muse-spark-1.3-contributor-free,big-pickle';
    const m = await import('@/lib/server/agent-runtime/opencode-models.ts');
    expect(m.activatedOpencodeIds()).toEqual([
      'space-bunny-free',
      'muse-spark-1.3-contributor-free',
      'big-pickle',
    ]);
    expect(m.activatedOpencodeModels().map((x: { modelString: string }) => x.modelString)).toEqual([
      'opencode:space-bunny-free',
      'opencode:muse-spark-1.3-contributor-free',
      'opencode:big-pickle',
    ]);
    expect(m.defaultTier3ModelString()).toBe('opencode:muse-spark-1.3-contributor-free');
  });

  it('menghormati daftar operator apa adanya (tanpa menyuntik default)', async () => {
    process.env.OPENCODE_MODELS = 'space-bunny-free,big-pickle';
    const m = await import('@/lib/server/agent-runtime/opencode-models.ts');
    expect(m.activatedOpencodeIds()).toEqual(['space-bunny-free', 'big-pickle']);
    expect(m.defaultTier3ModelString()).toBe('opencode:space-bunny-free');
  });

  it('fallback katalog bila OPENCODE_MODELS kosong', async () => {
    delete process.env.OPENCODE_MODELS;
    const m = await import('@/lib/server/agent-runtime/opencode-models.ts');
    const ids = m.activatedOpencodeIds();
    expect(ids).toContain('muse-spark-1.3-contributor-free');
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });

  it('menolak model di luar allowlist saat memilih aktif', async () => {
    process.env.OPENCODE_MODELS = 'space-bunny-free,muse-spark-1.3-contributor-free';
    const m = await import('@/lib/server/agent-runtime/opencode-models.ts');
    expect(() => m.writeActiveModelOverride('opencode:tidak-ada')).toThrow();
    const saved = m.writeActiveModelOverride('space-bunny-free');
    expect(saved.modelString).toBe('opencode:space-bunny-free');
    expect(m.readActiveModelOverride()?.modelString).toBe('opencode:space-bunny-free');
  });
});
