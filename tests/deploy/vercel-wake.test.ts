import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_KERNEL_SOURCE_URL,
  kernelStatus,
  kaggleAuthHeader,
  saveKernelBody,
  splitKernelRef,
} from '@/api/wake';
import { wakeComputeBackend } from '@/lib/deploy/wake-compute';

describe('Kaggle wake function', () => {
  it('uses Bearer for KGAT tokens and Basic for classic keys', () => {
    expect(kaggleAuthHeader({ KAGGLE_KEY: 'KGAT_abc' })).toBe('Bearer KGAT_abc');
    expect(kaggleAuthHeader({ KAGGLE_USERNAME: 'akjdev', KAGGLE_KEY: 'secret' })).toBe(
      `Basic ${Buffer.from('akjdev:secret').toString('base64')}`,
    );
    expect(() => kaggleAuthHeader({})).toThrow('KAGGLE_KEY is not configured');
    expect(() => kaggleAuthHeader({ KAGGLE_KEY: 'secret' })).toThrow('KAGGLE_USERNAME is required');
  });

  it('requires the full owner/kernel ref', () => {
    expect(splitKernelRef('akjdev/kelaska-app')).toEqual({
      owner: 'akjdev',
      slug: 'kelaska-app',
    });
    expect(() => splitKernelRef('kelaska-app')).toThrow('owner/kernel-slug');
    expect(() => splitKernelRef('a/b/c')).toThrow('owner/kernel-slug');
  });

  it('maps Kaggle session statuses', () => {
    expect(kernelStatus(1)).toBe('running');
    expect(kernelStatus('QUEUED')).toBe('queued');
    expect(kernelStatus(2)).toBe('complete');
    expect(kernelStatus(3)).toBe('error');
    expect(kernelStatus('CANCEL_REQUESTED')).toBe('cancelled');
    expect(kernelStatus('mystery')).toBe('unknown');
  });

  it('pushes the full slug with SAVE_AND_RUN_ALL and a bounded session', () => {
    const body = saveKernelBody('akjdev/kelaska-app', 'print("hello")', {
      KAGGLE_SESSION_TIMEOUT_SECONDS: '42000',
    });
    expect(body.slug).toBe('akjdev/kelaska-app');
    expect(body.kernelExecutionType).toBe('SAVE_AND_RUN_ALL');
    expect(body.sessionTimeoutSeconds).toBe(42000);
    expect(body.machineShape).toBe('NvidiaTeslaT4');
    expect(body.text).toBe('print("hello")');
  });

  it('defaults to the Vercel kernel source on deploy/kaggle', () => {
    expect(DEFAULT_KERNEL_SOURCE_URL).toContain('refs/heads/deploy/kaggle');
    expect(DEFAULT_KERNEL_SOURCE_URL).toContain('kelaska-vercel-kernel.py');
  });
});

describe('wakeComputeBackend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports success only for a 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    await expect(wakeComputeBackend()).resolves.toBe(true);
  });

  it('fails closed when the function is missing or errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    await expect(wakeComputeBackend()).resolves.toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    await expect(wakeComputeBackend()).resolves.toBe(false);
  });
});
