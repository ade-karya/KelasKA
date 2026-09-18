import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REDIS_KEY_PREFIX,
  getRedisClient,
  isRedisConfigured,
  redisDel,
  redisGet,
  redisGetdel,
  redisIncrWithTtl,
  redisSetex,
  resetRedisClientForTests,
} from '@/lib/server/redis';

const { MockRedis } = vi.hoisted(() => ({
  MockRedis: vi.fn(),
}));

vi.mock('@upstash/redis', () => ({ Redis: MockRedis }));

function stubRedisEnv() {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
}

beforeEach(() => {
  vi.unstubAllEnvs();
  resetRedisClientForTests();
  MockRedis.mockClear();
});

describe('isRedisConfigured', () => {
  it('is false without credentials and never constructs a client', () => {
    expect(isRedisConfigured()).toBe(false);
    expect(getRedisClient()).toBeNull();
    expect(MockRedis).not.toHaveBeenCalled();
  });

  it('is false with only one credential', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io');
    expect(isRedisConfigured()).toBe(false);
  });

  it('is true with both credentials', () => {
    stubRedisEnv();
    expect(isRedisConfigured()).toBe(true);
  });
});

describe('degraded helpers (unconfigured)', () => {
  it('all helpers degrade without touching the network', async () => {
    expect(await redisGet('k')).toBeUndefined();
    expect(await redisGetdel('k')).toBeUndefined();
    expect(await redisSetex('k', 60, 'v')).toBe(false);
    expect(await redisIncrWithTtl('k', 60)).toBeUndefined();
    await expect(redisDel('k')).resolves.toBeUndefined();
    expect(MockRedis).not.toHaveBeenCalled();
  });
});

describe('configured helpers (mocked client)', () => {
  function mockClient(impl: Record<string, unknown>) {
    // A `new`-able implementation: returning an object from a constructor
    // function yields that object as the instance.
    MockRedis.mockImplementation(function () {
      return impl;
    } as unknown as new (...args: unknown[]) => unknown);
  }

  it('passes values through', async () => {
    mockClient({
      get: vi.fn().mockResolvedValue('v'),
      getdel: vi.fn().mockResolvedValue('wake'),
      setex: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(3),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(57),
      del: vi.fn().mockResolvedValue(1),
    });
    stubRedisEnv();
    expect(await redisGet('k')).toBe('v');
    expect(await redisGetdel('k')).toBe('wake');
    expect(await redisSetex('k', 60, 'v')).toBe(true);
    expect(await redisIncrWithTtl('k', 60)).toEqual({ count: 3, ttlSeconds: 57 });
    await expect(redisDel('k')).resolves.toBeUndefined();
  });

  it('stamps the TTL on first increment only', async () => {
    const expire = vi.fn().mockResolvedValue(1);
    const incr = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    mockClient({ incr, expire, ttl: vi.fn().mockResolvedValue(60) });
    stubRedisEnv();
    await redisIncrWithTtl('k', 60);
    expect(expire).toHaveBeenCalledTimes(1);
    await redisIncrWithTtl('k', 60);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('degrades command failures to unavailable', async () => {
    mockClient({
      get: vi.fn().mockRejectedValue(new Error('outage')),
      setex: vi.fn().mockRejectedValue(new Error('outage')),
      incr: vi.fn().mockRejectedValue(new Error('outage')),
    });
    stubRedisEnv();
    expect(await redisGet('k')).toBeUndefined();
    expect(await redisSetex('k', 60, 'v')).toBe(false);
    expect(await redisIncrWithTtl('k', 60)).toBeUndefined();
  });

  it('recreates the client when credentials change', () => {
    const instances: unknown[] = [];
    MockRedis.mockImplementation(function () {
      const instance = {};
      instances.push(instance);
      return instance;
    } as unknown as new (...args: unknown[]) => unknown);
    stubRedisEnv();
    expect(getRedisClient()).not.toBeNull();
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'rotated-token');
    expect(getRedisClient()).not.toBeNull();
    expect(instances.length).toBe(2);
    expect(instances[0]).not.toBe(instances[1]);
  });

  it('uses the shared key prefix', () => {
    expect(REDIS_KEY_PREFIX).toBe('openmaic:');
  });
});
