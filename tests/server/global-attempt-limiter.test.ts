import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearGlobalAccessCodeAttempt,
  consumeGlobalAccessCodeAttempt,
} from '@/lib/server/global-attempt-limiter';

const redisMocks = vi.hoisted(() => ({
  isRedisConfigured: vi.fn(),
  redisDel: vi.fn(),
  redisIncrWithTtl: vi.fn(),
}));

vi.mock('@/lib/server/redis', () => ({
  REDIS_KEY_PREFIX: 'openmaic:',
  isRedisConfigured: redisMocks.isRedisConfigured,
  redisDel: redisMocks.redisDel,
  redisIncrWithTtl: redisMocks.redisIncrWithTtl,
}));

beforeEach(() => {
  vi.clearAllMocks();
  redisMocks.isRedisConfigured.mockReturnValue(true);
});

describe('consumeGlobalAccessCodeAttempt', () => {
  it('allows under the budget', async () => {
    redisMocks.redisIncrWithTtl.mockResolvedValue({ count: 5, ttlSeconds: 50 });
    expect(await consumeGlobalAccessCodeAttempt('1.2.3.4')).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
  });

  it('limits past 10 attempts with the key TTL as retry-after', async () => {
    redisMocks.redisIncrWithTtl.mockResolvedValue({ count: 11, ttlSeconds: 42 });
    expect(await consumeGlobalAccessCodeAttempt('1.2.3.4')).toEqual({
      limited: true,
      retryAfterSeconds: 42,
    });
  });

  it('allows when Redis is unconfigured (local limiter still applies)', async () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);
    expect(await consumeGlobalAccessCodeAttempt('1.2.3.4')).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
    expect(redisMocks.redisIncrWithTtl).not.toHaveBeenCalled();
  });

  it('allows when Redis errors (fail-safe to the local limiter)', async () => {
    redisMocks.redisIncrWithTtl.mockResolvedValue(undefined);
    expect(await consumeGlobalAccessCodeAttempt('1.2.3.4')).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
  });

  it('keys by identity hash, never the raw identity', async () => {
    redisMocks.redisIncrWithTtl.mockResolvedValue({ count: 1, ttlSeconds: 60 });
    await consumeGlobalAccessCodeAttempt('203.0.113.7');
    const key = redisMocks.redisIncrWithTtl.mock.calls[0][0] as string;
    expect(key.startsWith('openmaic:ratelimit:access-code:')).toBe(true);
    expect(key).not.toContain('203.0.113');
    expect(key.length).toBe('openmaic:ratelimit:access-code:'.length + 64);
  });
});

describe('clearGlobalAccessCodeAttempt', () => {
  it('deletes the identity key', async () => {
    await clearGlobalAccessCodeAttempt('203.0.113.7');
    expect(redisMocks.redisDel).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without Redis', async () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);
    await clearGlobalAccessCodeAttempt('203.0.113.7');
    expect(redisMocks.redisDel).not.toHaveBeenCalled();
  });
});
