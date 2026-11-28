import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_KERNEL_SOURCE_URL,
  injectedKernelSource,
  kernelStatus,
  kaggleAuthHeader,
  saveKernelBody,
  splitKernelRef,
  wakeEnv,
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
    expect(body.enableGpu).toBe(false);
    expect(body.machineShape).toBeUndefined();
    expect(body.text).toBe('print("hello")');
  });

  it('uses a separate kernel, tunnel and domain for CPU and GPU modes', () => {
    const base = {
      KAGGLE_KERNEL_REF: 'akjdev/kelaska-compute',
      KAGGLE_GPU_KERNEL_REF: 'akjdev/kelaska-gpu-worker',
      KELASKA_APP_TUNNEL_TOKEN: 'api-tunnel',
      KELASKA_GPU_TUNNEL_TOKEN: 'gpu-tunnel',
    };
    const cpu = wakeEnv(base, false);
    expect(cpu.KAGGLE_KERNEL_REF).toBe('akjdev/kelaska-compute');
    expect(cpu.KELASKA_MODE).toBe('app');
    expect(cpu.KAGGLE_ENABLE_GPU).toBe('false');
    const gpu = wakeEnv(base, true);
    expect(gpu.KAGGLE_KERNEL_REF).toBe('akjdev/kelaska-gpu-worker');
    expect(gpu.KELASKA_MODE).toBe('gpu-worker');
    expect(gpu.KAGGLE_ENABLE_GPU).toBe('true');
    expect(gpu.KAGGLE_MACHINE_SHAPE).toBe('NvidiaTeslaT4');
  });

  it('requests a T4 only when GPU mode is explicitly enabled', () => {
    const body = saveKernelBody('akjdev/kelaska-compute', 'print("hello")', {
      KAGGLE_ENABLE_GPU: 'true',
      KAGGLE_MACHINE_SHAPE: 'NvidiaTeslaT4',
    });
    expect(body.enableGpu).toBe(true);
    expect(body.machineShape).toBe('NvidiaTeslaT4');
  });

  it('attaches every staged dataset to the kernel', () => {
    const body = saveKernelBody('akjdev/kelaska-compute', 'print(1)', {
      KAGGLE_DATASETS: 'akjdev/kelaska-runtime, akjdev/kelaska-gpu-models',
    });
    expect(body.datasetDataSources).toEqual([
      'akjdev/kelaska-runtime',
      'akjdev/kelaska-gpu-models',
    ]);
  });

  it('defaults to the Vercel kernel source on deploy/kaggle', () => {
    expect(DEFAULT_KERNEL_SOURCE_URL).toContain('refs/heads/deploy/kaggle');
    expect(DEFAULT_KERNEL_SOURCE_URL).toContain('kelaska-vercel-kernel.py');
  });

  it('injects the app env into the kernel before its first secret() call', () => {
    const envB64 = Buffer.from('FOO=bar\nAUTH_PUBLIC_URL=https://kelaska.riau.ai\n').toString(
      'base64',
    );
    const source = injectedKernelSource('from __future__ import annotations\nprint("kernel")', {
      KELASKA_ENV_B64: envB64,
      KELASKA_AUTH_PUBLIC_URL: 'https://kelaska-ui.vercel.app',
      KELASKA_APP_TUNNEL_TOKEN: 'tunnel',
      KELASKA_PROXY_TOKEN: 'proxy',
    });
    const match = source.match(/b64decode\('([^']+)'\)/);
    expect(match).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(match![1], 'base64').toString('utf8'));
    expect(decoded.FOO).toBe('bar');
    expect(decoded.AUTH_PUBLIC_URL).toBe('https://kelaska.riau.ai');
    expect(decoded.KELASKA_AUTH_PUBLIC_URL).toBe('https://kelaska-ui.vercel.app');
    expect(decoded.KELASKA_APP_TUNNEL_TOKEN).toBe('tunnel');
    expect(decoded.KELASKA_PROXY_TOKEN).toBe('proxy');
    expect(source.startsWith('from __future__ import annotations')).toBe(true);
    expect(source.indexOf('b64decode')).toBeGreaterThan(source.indexOf('from __future__'));
    expect(source.endsWith('print("kernel")')).toBe(true);
  });

  it('reassembles a chunked env value', () => {
    const envB64 = Buffer.from('TOKEN=abc\n').toString('base64');
    const source = injectedKernelSource('from __future__ import annotations\nprint(1)', {
      KELASKA_ENV_B64_1: envB64.slice(0, 8),
      KELASKA_ENV_B64_2: envB64.slice(8),
    });
    const match = source.match(/b64decode\('([^']+)'\)/);
    expect(match).not.toBeNull();
    expect(JSON.parse(Buffer.from(match![1], 'base64').toString('utf8')).TOKEN).toBe('abc');
  });

  it('fails clearly when the injected env is missing', () => {
    expect(() => injectedKernelSource('print("kernel")', {})).toThrow(
      'KELASKA_ENV_B64 is not configured',
    );
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
