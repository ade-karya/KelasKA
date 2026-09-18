import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCachedProbeModels,
  probeCacheKey,
  setCachedProbeModels,
} from '@/lib/server/model-probe-cache';

const redisMocks = vi.hoisted(() => ({
  isRedisConfigured: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
}));

vi.mock('@/lib/server/redis', () => ({
  REDIS_KEY_PREFIX: 'openmaic:',
  isRedisConfigured: redisMocks.isRedisConfigured,
  redisGet: redisMocks.redisGet,
  redisSetex: redisMocks.redisSetex,
}));

const MODELS = [{ id: 'model-a', ownedBy: 'acme' }, { id: 'model-b' }];

beforeEach(() => {
  vi.clearAllMocks();
  redisMocks.isRedisConfigured.mockReturnValue(true);
});

describe('probe cache keys', () => {
  it('binds base URL, override, and key fingerprint', () => {
    const a = probeCacheKey('https://api.example.com/v1', undefined, 'key-1');
    const b = probeCacheKey('https://api.example.com/v1', undefined, 'key-2');
    const c = probeCacheKey('https://other.example.com/v1', undefined, 'key-1');
    expect(new Set([a, b, c]).size).toBe(3);
    for (const key of [a, b, c]) {
      expect(key.startsWith('openmaic:models:')).toBe(true);
      expect(key).not.toContain('key-1');
      expect(key).not.toContain('example.com');
    }
  });
});

describe('getCachedProbeModels', () => {
  it('returns parsed models on a hit', async () => {
    redisMocks.redisGet.mockResolvedValue(JSON.stringify(MODELS));
    expect(await getCachedProbeModels('https://api.example.com/v1', undefined, 'k')).toEqual(
      MODELS,
    );
  });

  it('misses on absent, corrupt, or misshapen values', async () => {
    redisMocks.redisGet.mockResolvedValue(null);
    expect(await getCachedProbeModels('https://x/v1', undefined, 'k')).toBeUndefined();
    redisMocks.redisGet.mockResolvedValue('not-json{');
    expect(await getCachedProbeModels('https://x/v1', undefined, 'k')).toBeUndefined();
    redisMocks.redisGet.mockResolvedValue(JSON.stringify([{ nope: 1 }]));
    expect(await getCachedProbeModels('https://x/v1', undefined, 'k')).toBeUndefined();
  });

  it('misses without Redis', async () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);
    expect(await getCachedProbeModels('https://x/v1', undefined, 'k')).toBeUndefined();
    expect(redisMocks.redisGet).not.toHaveBeenCalled();
  });
});

describe('setCachedProbeModels', () => {
  it('writes JSON with a 10-minute TTL', async () => {
    await setCachedProbeModels('https://api.example.com/v1', undefined, 'k', MODELS);
    expect(redisMocks.redisSetex).toHaveBeenCalledTimes(1);
    const [key, ttl, value] = redisMocks.redisSetex.mock.calls[0] as [string, number, string];
    expect(key.startsWith('openmaic:models:')).toBe(true);
    expect(ttl).toBe(600);
    expect(JSON.parse(value)).toEqual(MODELS);
  });

  it('is a no-op without Redis', async () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);
    await setCachedProbeModels('https://x/v1', undefined, 'k', MODELS);
    expect(redisMocks.redisSetex).not.toHaveBeenCalled();
  });
});
