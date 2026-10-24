/**
 * The workbench picker's model catalogue now spans three local transports:
 * `opencode`, `opencode-go` and `codex` (native Codex SDK). These pin the codex
 * half without touching the existing opencode expectations.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('model transport Codex SDK (picker)', () => {
  let file = '';

  beforeEach(() => {
    vi.resetModules();
    file = path.join(
      os.tmpdir(),
      `openmaic-test-codex-models-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.OPENCODE_ACTIVE_MODEL_FILE = file;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    delete process.env.CODEX_MODELS;
  });

  afterEach(() => {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
    delete process.env.OPENCODE_ACTIVE_MODEL_FILE;
    delete process.env.OPENCODE_MODELS;
    delete process.env.OPENCODE_GO_MODELS;
    delete process.env.CODEX_MODELS;
  });

  it('mengaktifkan model codex dari CODEX_MODELS', async () => {
    process.env.CODEX_MODELS = 'gpt-5.6-codex';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.activatedCodexModels()).toEqual([
      expect.objectContaining({
        provider: 'codex',
        id: 'gpt-5.6-codex',
        modelString: 'codex:gpt-5.6-codex',
      }),
    ]);
  });

  it('CODEX_MODELS kosong menyembunyikan grup codex', async () => {
    process.env.CODEX_MODELS = '';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.activatedCodexModels()).toEqual([]);
  });

  it('tanpa env memakai katalog provider codex', async () => {
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const ids = m.activatedCodexModels().map((entry) => entry.modelString);
    expect(ids).toContain('codex:gpt-5.6-codex');
    expect(ids).toContain('codex:gpt-5.5-codex');
  });

  it('activatedDriverModels menggabungkan ketiga transport, codex terakhir', async () => {
    process.env.OPENCODE_MODELS = 'big-pickle';
    process.env.OPENCODE_GO_MODELS = 'gpt-6-luna';
    process.env.CODEX_MODELS = 'gpt-5.6-codex';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.activatedDriverModels().map((entry) => entry.modelString)).toEqual([
      'opencode:big-pickle',
      'opencode-go:gpt-6-luna',
      'codex:gpt-5.6-codex',
    ]);
  });

  it('parse input codex (titik dua + slash) dan api-nya', async () => {
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.parseDriverModelInput('codex:gpt-5.6-codex')).toMatchObject({
      provider: 'codex',
      bare: 'gpt-5.6-codex',
      modelString: 'codex:gpt-5.6-codex',
    });
    expect(m.parseDriverModelInput('codex/gpt-5.6-codex')).toMatchObject({
      provider: 'codex',
      bare: 'gpt-5.6-codex',
    });
    expect(m.parseDriverModelInput('codex:')).toBeNull();
    // Prefix lama tidak boleh menelan model codex.
    expect(m.parseOpencodeModelInput('codex:gpt-5.6-codex')).toBeNull();
    expect(m.driverApiFor('codex')).toBe('codex-sdk');
    expect(m.driverApiFor('opencode-go')).toBe('opencode-cli');
  });

  it('capability thinking codex memakai effort OpenAI', async () => {
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(m.driverThinkingCapability('codex', 'gpt-5.6-codex')?.effortValues).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('menyimpan override codex dengan api codex-sdk + thinking', async () => {
    process.env.CODEX_MODELS = 'gpt-5.6-codex';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    const saved = m.writeActiveModelOverride('codex:gpt-5.6-codex', { effort: 'high' });
    expect(saved).toMatchObject({
      modelString: 'codex:gpt-5.6-codex',
      api: 'codex-sdk',
      thinking: { mode: 'enabled', effort: 'high' },
    });
    const read = m.readActiveModelOverride();
    expect(read).toMatchObject({ modelString: 'codex:gpt-5.6-codex', api: 'codex-sdk' });
  });

  it('menolak model codex di luar allowlist', async () => {
    process.env.CODEX_MODELS = 'gpt-5.6-codex';
    const m = await import('@/lib/server/agent-runtime/opencode-models');
    expect(() => m.writeActiveModelOverride('codex:tidak-ada')).toThrow();
    expect(m.isActivatedDriverModel('codex', 'gpt-5.6-codex')).toBe(true);
    expect(m.isActivatedDriverModel('codex', 'tidak-ada')).toBe(false);
  });
});
