import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEPLOY_TARGET_ENV,
  DEPLOY_TARGETS,
  deployCapabilities,
  isServerlessDeploy,
  isServerlessTarget,
  resolveDeployTarget,
  runsBackgroundWorkers,
} from '@/lib/config/deploy-target';

const AUTO_KEYS = [
  'VERCEL',
  'CF_PAGES',
  'WORKERS_CI',
  'KAGGLE_KERNEL_RUN_TYPE',
  'KAGGLE_URL_BASE',
  'COLAB_RELEASE_TAG',
  'COLAB_BACKEND_VERSION',
] as const;

const originals = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of [DEPLOY_TARGET_ENV, ...AUTO_KEYS]) {
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
});

describe('resolveDeployTarget', () => {
  it('defaults to a self-hosted deployment with no markers', () => {
    expect(resolveDeployTarget()).toBe('self-hosted');
  });

  it.each([
    ['VERCEL', '1', 'vercel'],
    ['VERCEL', 'true', 'vercel'],
    ['CF_PAGES', '1', 'cloudflare'],
    ['WORKERS_CI', '1', 'cloudflare'],
    ['KAGGLE_KERNEL_RUN_TYPE', 'interactive', 'kaggle'],
    ['KAGGLE_URL_BASE', 'https://www.kaggle.com', 'kaggle'],
    ['COLAB_RELEASE_TAG', 'colab2026', 'colab'],
    ['COLAB_BACKEND_VERSION', '2', 'colab'],
  ])('detects %s=%s as %s', (key, value, expected) => {
    process.env[key] = value;
    expect(resolveDeployTarget()).toBe(expected);
  });

  it.each(DEPLOY_TARGETS)('honours the explicit target %s', (target) => {
    process.env[DEPLOY_TARGET_ENV] = target;
    expect(resolveDeployTarget()).toBe(target);
  });

  it('normalises case and surrounding whitespace of the explicit target', () => {
    process.env[DEPLOY_TARGET_ENV] = '  VeRcEl ';
    expect(resolveDeployTarget()).toBe('vercel');
  });

  it('lets the explicit target override auto-detection', () => {
    process.env.VERCEL = '1';
    process.env[DEPLOY_TARGET_ENV] = 'kaggle';
    expect(resolveDeployTarget()).toBe('kaggle');
  });

  it('rejects an unknown explicit target with the accepted values', () => {
    process.env[DEPLOY_TARGET_ENV] = 'heroku';
    expect(() => resolveDeployTarget()).toThrow(DEPLOY_TARGET_ENV);
    expect(() => resolveDeployTarget()).toThrow('vercel, cloudflare');
  });
});

describe('deploy capabilities', () => {
  it.each(['vercel', 'cloudflare'] as const)(
    '%s is serverless and needs an external worker',
    (target) => {
      expect(isServerlessTarget(target)).toBe(true);
      expect(deployCapabilities(target)).toEqual({
        target,
        serverless: true,
        backgroundWorkers: false,
        localProcesses: false,
        durableLocalFilesystem: false,
        localMediaProvidersAllowed: false,
        externalWorkerRequired: true,
      });
    },
  );

  it.each(['self-hosted', 'kaggle', 'colab'] as const)('%s runs its own workers', (target) => {
    expect(isServerlessTarget(target)).toBe(false);
    expect(deployCapabilities(target)).toEqual({
      target,
      serverless: false,
      backgroundWorkers: true,
      localProcesses: true,
      durableLocalFilesystem: true,
      localMediaProvidersAllowed: true,
      externalWorkerRequired: false,
    });
  });

  it('reads the live environment in the convenience wrappers', () => {
    expect(runsBackgroundWorkers()).toBe(true);
    expect(isServerlessDeploy()).toBe(false);

    process.env.VERCEL = '1';
    expect(runsBackgroundWorkers()).toBe(false);
    expect(isServerlessDeploy()).toBe(true);
  });
});
