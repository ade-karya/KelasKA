/**
 * The small part of the Kaggle API the Worker needs.
 *
 * Kaggle has two API credential shapes: a classic `kaggle.json` key (Basic
 * auth) and a `KGAT_...` personal access token (Bearer). Both call the same
 * gRPC-transcoded service under `https://api.kaggle.com/v1`; only the
 * Authorization header differs. `www.kaggle.com/api/v1` is the legacy REST
 * API and has no `kernels.KernelsApiService` route, so a KGAT token sent there
 * fails before SaveKernel is reached.
 */

function apiBase(): string {
  return 'https://api.kaggle.com/v1/kernels.KernelsApiService';
}
const SOURCE_CACHE_KEY = 'kernel:source';
// Keep this short: the kernel source is pushed on every start, and a stale
// script would reintroduce fixes we already merged. A transient GitHub miss is
// retried by the coordinator's alarm, so a long cache buys little.
const SOURCE_CACHE_SECONDS = 300;

export async function clearKernelSource(env: { STATE: KVNamespace }): Promise<void> {
  await env.STATE.delete(SOURCE_CACHE_KEY);
}

export type KernelStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled' | 'unknown';

export interface SaveKernelResult {
  ref: string;
  url: string;
  versionNumber: number;
  kernelId: number;
}

export interface KernelSessionStatus {
  status: KernelStatus;
  failureMessage: string;
}

function credentials(env: { KAGGLE_USERNAME?: string; KAGGLE_KEY?: string }): string {
  if (!env.KAGGLE_KEY) {
    throw new Error('Kaggle credentials are not configured (KAGGLE_USERNAME/KAGGLE_KEY)');
  }
  if (env.KAGGLE_KEY.startsWith('KGAT_')) return `Bearer ${env.KAGGLE_KEY}`;
  if (!env.KAGGLE_USERNAME) throw new Error('KAGGLE_USERNAME is required for a classic Kaggle key');
  return `Basic ${btoa(`${env.KAGGLE_USERNAME}:${env.KAGGLE_KEY}`)}`;
}

function splitKernelRef(ref: string): { owner: string; slug: string } {
  const [owner, slug, extra] = ref.split('/');
  if (!owner || !slug || extra) {
    throw new Error(`KAGGLE_KERNEL_REF must be owner/kernel-slug, got ${JSON.stringify(ref)}`);
  }
  return { owner, slug };
}

async function post<T>(
  env: { KAGGLE_USERNAME?: string; KAGGLE_KEY?: string },
  method: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: {
      authorization: credentials(env),
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'kelaska-edge/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
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

/**
 * The kernel source is versioned in git and fetched from `KERNEL_SOURCE_URL`.
 * A one-hour KV cache keeps a cold start from depending on GitHub on every
 * attempt, while a push still picks up a fresh script within the hour.
 */
export async function fetchKernelSource(env: {
  STATE: KVNamespace;
  KERNEL_SOURCE_URL?: string;
}): Promise<string> {
  const cached = await env.STATE.get(SOURCE_CACHE_KEY);
  if (cached && cached.length > 200) return cached;
  if (!env.KERNEL_SOURCE_URL) throw new Error('KERNEL_SOURCE_URL is not configured');

  const response = await fetch(env.KERNEL_SOURCE_URL, {
    headers: { 'user-agent': 'kelaska-edge/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Kernel source fetch failed with HTTP ${response.status}`);
  }
  const source = await response.text();
  if (source.length < 200) throw new Error('Kernel source is unexpectedly short');
  await env.STATE.put(SOURCE_CACHE_KEY, source, { expirationTtl: SOURCE_CACHE_SECONDS });
  return source;
}

/** Push a new version of the prepared kernel and start it. */
export async function saveAndRunKernel(
  env: {
    KAGGLE_USERNAME?: string;
    KAGGLE_KEY?: string;
    KAGGLE_KERNEL_REF?: string;
    KAGGLE_KERNEL_TITLE?: string;
    KAGGLE_DATASET?: string;
    KAGGLE_MACHINE_SHAPE?: string;
    KAGGLE_SESSION_TIMEOUT_SECONDS?: string;
  },
  source: string,
): Promise<SaveKernelResult> {
  const ref = env.KAGGLE_KERNEL_REF;
  if (!ref) throw new Error('KAGGLE_KERNEL_REF is not configured');
  // The Kaggle SDK documents SaveKernel's `slug` as the *full* ref
  // `{username}/{kernel-slug}`. Sending only the bare slug is rejected with
  // `Invalid slug: 'kelaska-gpu'`; `userName`/`kernelSlug` are separate fields
  // used only by GetKernelSessionStatus.
  const { owner, slug } = splitKernelRef(ref);

  const body: Record<string, unknown> = {
    slug: `${owner}/${slug}`,
    newTitle: env.KAGGLE_KERNEL_TITLE || 'KelasKA GPU',
    text: source,
    language: 'python',
    kernelType: 'script',
    isPrivate: true,
    enableGpu: true,
    enableInternet: true,
    machineShape: env.KAGGLE_MACHINE_SHAPE || 'NvidiaTeslaT4',
    datasetDataSources: env.KAGGLE_DATASET ? [env.KAGGLE_DATASET] : [],
    categoryIds: [],
    // The Kaggle SDK serializes enums by *name*, not by numeric value; 1 here
    // would be rejected. SAVE_AND_RUN_ALL is the "save and run" execution type.
    kernelExecutionType: 'SAVE_AND_RUN_ALL',
  };
  const timeout = Number(env.KAGGLE_SESSION_TIMEOUT_SECONDS ?? '');
  if (Number.isFinite(timeout) && timeout > 0) body.sessionTimeoutSeconds = Math.floor(timeout);

  const payload = await post<Record<string, unknown>>(env, 'SaveKernel', body);
  const error = typeof payload.error === 'string' ? payload.error : '';
  if (error) throw new Error(error);

  return {
    ref: typeof payload.ref === 'string' ? payload.ref : ref,
    url: typeof payload.url === 'string' ? payload.url : `https://www.kaggle.com/code/${ref}`,
    versionNumber: Number(payload.versionNumber ?? payload.version_number ?? 0) || 0,
    kernelId: Number(payload.kernelId ?? payload.kernel_id ?? 0) || 0,
  };
}

/** Read the latest session status of the prepared kernel. */
export async function getKernelSessionStatus(env: {
  KAGGLE_USERNAME?: string;
  KAGGLE_KEY?: string;
  KAGGLE_KERNEL_REF?: string;
}): Promise<KernelSessionStatus> {
  const ref = env.KAGGLE_KERNEL_REF;
  if (!ref) throw new Error('KAGGLE_KERNEL_REF is not configured');
  const { owner, slug } = splitKernelRef(ref);
  const payload = await post<Record<string, unknown>>(env, 'GetKernelSessionStatus', {
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

function mapStatus(raw: unknown): KernelStatus {
  const value = typeof raw === 'string' ? raw.toUpperCase() : raw;
  if (value === 0 || value === '0' || value === 'QUEUED') return 'queued';
  if (value === 1 || value === '1' || value === 'RUNNING') return 'running';
  if (value === 2 || value === '2' || value === 'COMPLETE') return 'complete';
  if (value === 3 || value === '3' || value === 'ERROR') return 'error';
  if (value === 4 || value === '4' || value === 'CANCEL_REQUESTED') return 'cancelled';
  if (value === 5 || value === '5' || value === 'CANCEL_ACKNOWLEDGED') return 'cancelled';
  return 'unknown';
}
