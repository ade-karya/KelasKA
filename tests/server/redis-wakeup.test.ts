import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  publishRedisWakeup,
  redisWakeKey,
  startRedisWakePoll,
} from '@/lib/server/agent-runtime/redis-wakeup';

const redisMocks = vi.hoisted(() => ({
  isRedisConfigured: vi.fn(),
  redisGetdel: vi.fn(),
  redisSetex: vi.fn(),
}));

vi.mock('@/lib/server/redis', () => ({
  REDIS_KEY_PREFIX: 'openmaic:',
  isRedisConfigured: redisMocks.isRedisConfigured,
  redisGetdel: redisMocks.redisGetdel,
  redisSetex: redisMocks.redisSetex,
}));

beforeEach(() => {
  vi.useFakeTimers();
  redisMocks.isRedisConfigured.mockReturnValue(true);
  redisMocks.redisGetdel.mockResolvedValue(null);
  redisMocks.redisSetex.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('redisWakeKey', () => {
  it('builds prefixed keys per route kind', () => {
    expect(redisWakeKey({ kind: 'session', sessionId: 's1' })).toBe('openmaic:wake:session:s1');
    expect(redisWakeKey({ kind: 'owner', ownerId: 'o1' })).toBe('openmaic:wake:owner:o1');
    expect(redisWakeKey({ kind: 'stage', stageId: 'st1' })).toBe('openmaic:wake:stage:st1');
  });
});

describe('publishRedisWakeup', () => {
  it('is a no-op without Redis', () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);
    publishRedisWakeup({ kind: 'session', sessionId: 's1' });
    expect(redisMocks.redisSetex).not.toHaveBeenCalled();
  });

  it('publishes with a 60s TTL', () => {
    publishRedisWakeup({ kind: 'session', sessionId: 's-publish' });
    expect(redisMocks.redisSetex).toHaveBeenCalledWith('openmaic:wake:session:s-publish', 60, '1');
  });

  it('coalesces bursts to one publish per second per route', () => {
    // Fresh route ids per test: the publisher's coalescing map is
    // process-wide and fake timers freeze its clock across tests.
    const route = { kind: 'session', sessionId: 's-coalesce' } as const;
    publishRedisWakeup(route);
    publishRedisWakeup(route);
    publishRedisWakeup(route);
    expect(redisMocks.redisSetex).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    publishRedisWakeup(route);
    expect(redisMocks.redisSetex).toHaveBeenCalledTimes(2);
  });

  it('coalesces per route, not globally', () => {
    publishRedisWakeup({ kind: 'session', sessionId: 's-routes-a' });
    publishRedisWakeup({ kind: 'session', sessionId: 's-routes-b' });
    expect(redisMocks.redisSetex).toHaveBeenCalledTimes(2);
  });
});

describe('startRedisWakePoll', () => {
  it('returns null without Redis', () => {
    redisMocks.isRedisConfigured.mockReturnValue(false);
    expect(startRedisWakePoll({ kind: 'session', sessionId: 's1' }, () => {})).toBeNull();
  });

  it('invokes onWake once per published signal', async () => {
    const onWake = vi.fn();
    const timer = startRedisWakePoll({ kind: 'session', sessionId: 's1' }, onWake);
    expect(timer).not.toBeNull();
    // Idle second: key absent, no wake.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onWake).not.toHaveBeenCalled();
    // Signal arrives: exactly one wake per GETDEL hit.
    redisMocks.redisGetdel.mockResolvedValueOnce('1');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onWake).toHaveBeenCalledTimes(1);
    if (timer) clearInterval(timer);
  });

  it('never overlaps in-flight checks', async () => {
    let release!: () => void;
    redisMocks.redisGetdel.mockReturnValue(
      new Promise((resolve) => void (release = () => resolve(null))),
    );
    const onWake = vi.fn();
    const timer = startRedisWakePoll({ kind: 'session', sessionId: 's1' }, onWake);
    await vi.advanceTimersByTimeAsync(5_000);
    // Five ticks collapsed into one in-flight check.
    expect(redisMocks.redisGetdel).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    if (timer) clearInterval(timer);
  });
});
