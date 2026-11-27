/**
 * Start the on-demand Kaggle worker from the Vercel deployment.
 *
 * Vercel functions end with their request, so they cannot run the generation
 * runner. When a run is enqueued (or a paused run is confirmed/retried), the
 * API route asks this module to make sure a Kaggle kernel is running. That
 * kernel clones `deploy/kaggle`, runs `install.sh --kaggle`, and its
 * generation runner claims the queued row from the shared database.
 *
 * The kernel is started through the same Kaggle service the Cloudflare Worker
 * uses (`deploy/cloudflare-worker/src/kaggle.ts`): the SDK serializes enums by
 * name, and `SaveKernel.slug` must be the full `owner/kernel-slug` ref. Both
 * credential shapes are supported: a classic `KAGGLE_USERNAME`/`KAGGLE_KEY`
 * pair (Basic) or a `KGAT_...` token (Bearer).
 *
 * Everything here is best-effort. A launch failure is logged and the run stays
 * queued; the next start/command retries after the cooldown. It must never
 * turn a successful `POST /api/generation-runs` into an error.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import { resolveDeployTarget } from '@/lib/config/deploy-target';
import { createLogger } from '@/lib/logger';
import {
  recordKaggleWorkerLaunch,
  reserveKaggleWorkerLaunch,
} from '@/lib/persistence/kaggle-worker';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

const log = createLogger('KaggleWorker');

const DEFAULT_KERNEL_REF = 'akjdev/kelaska-worker';
const DEFAULT_KERNEL_SOURCE_URL =
  'https://raw.githubusercontent.com/ade-karya/KelasKA/refs/heads/deploy/kaggle/deploy/kaggle/worker-kernel.py';
const DEFAULT_MACHINE_SHAPE = 'NvidiaTeslaT4';
const DEFAULT_SESSION_TIMEOUT_SECONDS = 4 * 60 * 60;
const LAUNCH_COOLDOWN_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 25_000;
const SOURCE_CACHE_MS = 5 * 60 * 1000;

export type KaggleKernelStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'error'
  | 'cancelled'
  | 'unknown';

export interface KaggleLaunchConfig {
  ref: string;
  username?: string;
  key: string;
  title: string;
  sourceUrl: string;
  machineShape: string;
  sessionTimeoutSeconds: number;
  dataset?: string;
}

export interface KaggleSaveResult {
  ref: string;
  url: string;
  versionNumber: number;
  kernelId: number;
}

export interface KaggleLaunchOutcome {
  started: boolean;
  status: 'started' | 'queued' | 'running' | 'cooldown' | 'not-vercel' | 'not-configured' | 'error';
  ref?: string;
  url?: string;
  versionNumber?: number;
  message?: string;
}

function apiBase(): string {
  return 'https://api.kaggle.com/v1/kernels.KernelsApiService';
}

/** Read the operator's Kaggle settings; null when no key is configured. */
export function readKaggleConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): KaggleLaunchConfig | null {
  const key = env.KAGGLE_KEY?.trim();
  if (!key) return null;
  const ref = env.KAGGLE_KERNEL_REF?.trim() || DEFAULT_KERNEL_REF;
  const timeout = Number(env.KAGGLE_SESSION_TIMEOUT_SECONDS ?? '');
  return {
    ref,
    username: env.KAGGLE_USERNAME?.trim() || undefined,
    key,
    title: env.KAGGLE_KERNEL_TITLE?.trim() || 'KelasKA Worker',
    sourceUrl: env.KAGGLE_KERNEL_SOURCE_URL?.trim() || DEFAULT_KERNEL_SOURCE_URL,
    machineShape: env.KAGGLE_MACHINE_SHAPE?.trim() || DEFAULT_MACHINE_SHAPE,
    sessionTimeoutSeconds:
      Number.isFinite(timeout) && timeout > 0
        ? Math.floor(timeout)
        : DEFAULT_SESSION_TIMEOUT_SECONDS,
    dataset: env.KAGGLE_DATASET?.trim() || undefined,
  };
}

function authorization(config: KaggleLaunchConfig): string {
  if (config.key.startsWith('KGAT_')) return `Bearer ${config.key}`;
  if (!config.username) {
    throw new Error('KAGGLE_USERNAME is required for a classic Kaggle key');
  }
  return `Basic ${Buffer.from(`${config.username}:${config.key}`).toString('base64')}`;
}

function splitKernelRef(ref: string): { owner: string; slug: string } {
  const [owner, slug, extra] = ref.split('/');
  if (!owner || !slug || extra) {
    throw new Error(`KAGGLE_KERNEL_REF must be owner/kernel-slug, got ${JSON.stringify(ref)}`);
  }
  return { owner, slug };
}

async function post<T>(config: KaggleLaunchConfig, method: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: {
      authorization: authorization(config),
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'kelaska-vercel/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      payload = { message: raw.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message =
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.error === 'string' && payload.error) ||
      `Kaggle API ${method} failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function mapStatus(raw: unknown): KaggleKernelStatus {
  const value = typeof raw === 'string' ? raw.toUpperCase() : raw;
  if (value === 0 || value === '0' || value === 'QUEUED') return 'queued';
  if (value === 1 || value === '1' || value === 'RUNNING') return 'running';
  if (value === 2 || value === '2' || value === 'COMPLETE') return 'complete';
  if (value === 3 || value === '3' || value === 'ERROR') return 'error';
  if (value === 4 || value === '4' || value === 'CANCEL_REQUESTED') return 'cancelled';
  if (value === 5 || value === '5' || value === 'CANCEL_ACKNOWLEDGED') return 'cancelled';
  return 'unknown';
}

/** Read the latest session status of the worker kernel. */
export async function getKernelSessionStatus(
  config: KaggleLaunchConfig,
): Promise<{ status: KaggleKernelStatus; failureMessage: string }> {
  const { owner, slug } = splitKernelRef(config.ref);
  const payload = await post<Record<string, unknown>>(config, 'GetKernelSessionStatus', {
    userName: owner,
    kernelSlug: slug,
  });
  return {
    status: mapStatus(payload.status),
    failureMessage:
      typeof payload.failureMessage === 'string'
        ? payload.failureMessage
        : typeof payload.failure_message === 'string'
          ? payload.failure_message
          : '',
  };
}

let sourceCache: { url: string; source: string; fetchedAt: number } | null = null;

/** Fetch the kernel script that lives in the `deploy/kaggle` branch. */
export async function fetchKernelSource(
  config: KaggleLaunchConfig,
  now = Date.now(),
): Promise<string> {
  if (
    sourceCache &&
    sourceCache.url === config.sourceUrl &&
    now - sourceCache.fetchedAt < SOURCE_CACHE_MS
  ) {
    return sourceCache.source;
  }
  const response = await fetch(config.sourceUrl, {
    headers: { 'user-agent': 'kelaska-vercel/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Kernel source fetch failed with HTTP ${response.status}`);
  }
  const source = await response.text();
  if (source.length < 200) throw new Error('Kernel source is unexpectedly short');
  sourceCache = { url: config.sourceUrl, source, fetchedAt: now };
  return source;
}

/** Push a new version of the prepared kernel and start it. */
export async function saveAndRunKernel(
  config: KaggleLaunchConfig,
  source: string,
): Promise<KaggleSaveResult> {
  const { owner, slug } = splitKernelRef(config.ref);
  const body: Record<string, unknown> = {
    slug: `${owner}/${slug}`,
    newTitle: config.title,
    text: source,
    language: 'python',
    kernelType: 'script',
    isPrivate: true,
    enableGpu: true,
    enableInternet: true,
    machineShape: config.machineShape,
    datasetDataSources: config.dataset ? [config.dataset] : [],
    categoryIds: [],
    // The Kaggle SDK serializes enums by name, not by numeric value.
    kernelExecutionType: 'SAVE_AND_RUN_ALL',
    sessionTimeoutSeconds: config.sessionTimeoutSeconds,
  };
  const payload = await post<Record<string, unknown>>(config, 'SaveKernel', body);
  const error = typeof payload.error === 'string' ? payload.error : '';
  if (error) throw new Error(error);
  return {
    ref: typeof payload.ref === 'string' ? payload.ref : config.ref,
    url:
      typeof payload.url === 'string' ? payload.url : `https://www.kaggle.com/code/${config.ref}`,
    versionNumber: Number(payload.versionNumber ?? payload.version_number ?? 0) || 0,
    kernelId: Number(payload.kernelId ?? payload.kernel_id ?? 0) || 0,
  };
}

/**
 * Make sure a Kaggle worker is running for the queued work. Safe to call from
 * an `after()` callback: it never throws and skips when the host is not
 * Vercel or the Kaggle credentials are absent.
 */
export async function ensureKaggleWorker(reason: string): Promise<KaggleLaunchOutcome> {
  if (resolveDeployTarget() !== 'vercel') {
    return { started: false, status: 'not-vercel' };
  }
  const config = readKaggleConfig();
  if (!config) {
    log.warn(
      'Kaggle worker is not configured (KAGGLE_KEY missing); generation runs will wait for an external worker.',
    );
    return { started: false, status: 'not-configured' };
  }

  try {
    const current = await getKernelSessionStatus(config);
    if (current.status === 'running' || current.status === 'queued') {
      log.info(`Kaggle worker is already ${current.status}; no launch needed (${reason}).`);
      return { started: false, status: current.status };
    }
  } catch (error) {
    // A status probe failure must not block the launch: SaveKernel is the
    // authoritative action, and Kaggle rejects a duplicate start itself.
    log.warn(
      `Kaggle worker status probe failed (${reason}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const queryable = pool as unknown as Queryable;
    const reserved = await reserveKaggleWorkerLaunch(queryable, LAUNCH_COOLDOWN_MS).catch(
      (error) => {
        // The cooldown is an optimisation, not a gate: a database hiccup must
        // not leave the queued run without a worker.
        log.warn('Could not reserve the Kaggle launch cooldown; starting anyway:', error);
        return true;
      },
    );
    if (!reserved) {
      log.info(`Kaggle worker launch is cooling down; no launch needed (${reason}).`);
      return { started: false, status: 'cooldown' };
    }

    try {
      const source = await fetchKernelSource(config);
      const saved = await saveAndRunKernel(config, source);
      await recordKaggleWorkerLaunch(queryable, 'started').catch(() => {});
      log.info(
        `Started Kaggle worker ${saved.ref} version ${saved.versionNumber} (${reason}): ${saved.url}`,
      );
      return {
        started: true,
        status: 'started',
        ref: saved.ref,
        url: saved.url,
        versionNumber: saved.versionNumber,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordKaggleWorkerLaunch(queryable, 'failed', message).catch(() => {});
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Kaggle worker launch failed (${reason}): ${message}`);
    return { started: false, status: 'error', message };
  }
}
