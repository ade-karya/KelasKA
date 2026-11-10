import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  audioGet: vi.fn(),
  audioBulkGet: vi.fn(),
  assetRefExists: vi.fn(),
}));

vi.mock('@/lib/device-storage/database', () => ({
  db: {
    audioFiles: {
      get: (...args: unknown[]) => mocks.audioGet(...args),
      bulkGet: (...args: unknown[]) => mocks.audioBulkGet(...args),
    },
  },
}));
vi.mock('@/lib/media/use-asset-url', () => ({
  assetRefExists: (...args: unknown[]) => mocks.assetRefExists(...args),
}));

import { audioExists, audioExistsBulk } from '@/lib/audio/regenerate-speech-tts';

describe('narration existence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers from the local mirror first', async () => {
    mocks.audioGet.mockResolvedValue({ blob: new Blob(['a']) });
    await expect(audioExists('tts_s1_a')).resolves.toBe(true);
    expect(mocks.assetRefExists).not.toHaveBeenCalled();
  });

  it('probes the asset pool for an allocated id with no local row', async () => {
    mocks.audioGet.mockResolvedValue(undefined);
    mocks.assetRefExists.mockResolvedValue(true);
    await expect(audioExists('ast_agent_narration')).resolves.toBe(true);
    expect(mocks.assetRefExists).toHaveBeenCalledWith('ast_agent_narration');
  });

  it('does not probe the pool for a legacy id', async () => {
    mocks.audioGet.mockResolvedValue(undefined);
    await expect(audioExists('tts_s1_a')).resolves.toBe(false);
    expect(mocks.assetRefExists).not.toHaveBeenCalled();
  });

  it('combines local hits and pool hits in a bulk probe', async () => {
    mocks.audioBulkGet.mockResolvedValue([{ blob: new Blob(['a']) }, undefined]);
    mocks.assetRefExists.mockResolvedValue(true);
    await expect(audioExistsBulk(['local', 'ast_pool'])).resolves.toEqual(
      new Set(['local', 'ast_pool']),
    );
    expect(mocks.assetRefExists).toHaveBeenCalledTimes(1);
    expect(mocks.assetRefExists).toHaveBeenCalledWith('ast_pool');
  });

  it('treats a failed pool probe as a miss', async () => {
    mocks.audioGet.mockResolvedValue(undefined);
    mocks.assetRefExists.mockRejectedValue(new Error('offline'));
    await expect(audioExists('ast_agent_narration')).resolves.toBe(false);
  });
});
