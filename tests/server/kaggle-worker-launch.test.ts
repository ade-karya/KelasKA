import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchKernelSource,
  getKernelSessionStatus,
  readKaggleConfig,
  saveAndRunKernel,
  type KaggleLaunchConfig,
} from '@/lib/server/kaggle/launch';

const ENV_KEYS = [
  'OPENMAIC_DEPLOY_TARGET',
  'VERCEL',
  'KAGGLE_USERNAME',
  'KAGGLE_KEY',
  'KAGGLE_KERNEL_REF',
] as const;
const originals = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originals.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of originals) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originals.clear();
  vi.unstubAllGlobals();
});

function config(overrides: Partial<KaggleLaunchConfig> = {}): KaggleLaunchConfig {
  return {
    ref: 'tester/worker-kernel',
    username: 'tester',
    key: 'classic-key',
    title: 'Test Worker',
    sourceUrl: 'https://example.test/kernel.py',
    machineShape: 'NvidiaTeslaT4',
    sessionTimeoutSeconds: 3600,
    ...overrides,
  };
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('readKaggleConfig', () => {
  it('returns null without a key', () => {
    expect(readKaggleConfig({})).toBeNull();
  });

  it('defaults the kernel ref and session length', () => {
    const parsed = readKaggleConfig({ KAGGLE_KEY: 'KGAT_token', VERCEL: '1' });
    expect(parsed?.ref).toBe('akjdev/kelaska-worker');
    expect(parsed?.sessionTimeoutSeconds).toBe(4 * 60 * 60);
  });
});

describe('Kaggle API client', () => {
  it('uses Basic auth and names the kernel by owner and slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 'RUNNING' }));
    vi.stubGlobal('fetch', fetchMock);

    const status = await getKernelSessionStatus(config());

    expect(status.status).toBe('running');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.kaggle.com/v1/kernels.KernelsApiService/GetKernelSessionStatus');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('tester:classic-key').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      userName: 'tester',
      kernelSlug: 'worker-kernel',
    });
  });

  it('uses Bearer auth for a KGAT token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const status = await getKernelSessionStatus(
      config({ username: undefined, key: 'KGAT_token', ref: 'tester/worker' }),
    );

    expect(status.status).toBe('complete');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer KGAT_token');
  });

  it('pushes a full slug with SAVE_AND_RUN_ALL and GPU enabled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ ref: 'tester/worker-kernel', versionNumber: 7, kernelId: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    const saved = await saveAndRunKernel(config(), 'x'.repeat(300));

    expect(saved.versionNumber).toBe(7);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.kaggle.com/v1/kernels.KernelsApiService/SaveKernel');
    const body = JSON.parse(init.body as string);
    expect(body.slug).toBe('tester/worker-kernel');
    expect(body.kernelExecutionType).toBe('SAVE_AND_RUN_ALL');
    expect(body.enableGpu).toBe(true);
    expect(body.sessionTimeoutSeconds).toBe(3600);
    expect(body.text).toHaveLength(300);
  });

  it('rejects a ref without an owner', async () => {
    await expect(saveAndRunKernel(config({ ref: 'bare-slug' }), 'x'.repeat(300))).rejects.toThrow(
      /KAGGLE_KERNEL_REF must be owner\/kernel-slug/,
    );
  });
});

describe('fetchKernelSource', () => {
  it('caches the script by URL', async () => {
    const source = '# kernel\n' + 'print("hello")\n'.repeat(30);
    const fetchMock = vi.fn().mockResolvedValue(new Response(source, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cfg = config({ sourceUrl: 'https://example.test/cached-kernel.py' });

    expect(await fetchKernelSource(cfg, 1_000)).toBe(source);
    expect(await fetchKernelSource(cfg, 2_000)).toBe(source);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
