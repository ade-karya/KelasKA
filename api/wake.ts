/**
 * Vercel function that wakes the on-demand Kaggle compute node.
 *
 * The static Vercel UI has zero functions for normal traffic: `vercel.json`
 * rewrites `/api/*` straight to the tunnel. This single function exists only
 * for `/api/wake`, which the auth session provider calls when `/api/auth/me`
 * is unreachable (the Kaggle session was stopped). It pushes the prepared
 * kernel source with `SaveKernel` and starts a new session; the browser polls
 * `/api/auth/me` until the app behind the named tunnel answers again.
 *
 * Hobby allows at most 12 functions, so keep every wake path in this file.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

const KAGGLE_API = 'https://api.kaggle.com/v1/kernels.KernelsApiService';
// Hobby functions default to a 10 s wall clock; keep each Kaggle call short.
const REQUEST_TIMEOUT_MS = 8_000;
const COOLDOWN_MS = 5 * 60 * 1000;
export const DEFAULT_KERNEL_SOURCE_URL =
  'https://raw.githubusercontent.com/ade-karya/KelasKA/refs/heads/deploy/kaggle/deploy/kaggle/kelaska-vercel-kernel.py';

export const config = { api: { bodyParser: false } };

export type KernelStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled' | 'unknown';

export interface WakeResult {
  started: boolean;
  status: string;
  ref?: string;
  url?: string;
  message?: string;
}

type Env = NodeJS.ProcessEnv;

/** KGAT tokens use Bearer; classic kaggle.json keys use Basic. */
export function kaggleAuthHeader(env: Env = process.env): string {
  const key = env.KAGGLE_KEY?.trim() ?? '';
  if (!key) throw new Error('KAGGLE_KEY is not configured on Vercel');
  if (key.startsWith('KGAT_')) return `Bearer ${key}`;
  const username = env.KAGGLE_USERNAME?.trim();
  if (!username) throw new Error('KAGGLE_USERNAME is required for a classic Kaggle key');
  return `Basic ${Buffer.from(`${username}:${key}`).toString('base64')}`;
}

/** Kaggle's slug is the full `owner/kernel` ref; userName/kernelSlug are separate. */
export function splitKernelRef(ref: string): { owner: string; slug: string } {
  const [owner, slug, extra] = ref.split('/');
  if (!owner || !slug || extra) {
    throw new Error(`KAGGLE_KERNEL_REF must be owner/kernel-slug, got ${JSON.stringify(ref)}`);
  }
  return { owner, slug };
}

export function kernelStatus(value: unknown): KernelStatus {
  const raw = typeof value === 'string' ? value.toUpperCase() : value;
  if (raw === 0 || raw === '0' || raw === 'QUEUED') return 'queued';
  if (raw === 1 || raw === '1' || raw === 'RUNNING') return 'running';
  if (raw === 2 || raw === '2' || raw === 'COMPLETE') return 'complete';
  if (raw === 3 || raw === '3' || raw === 'ERROR') return 'error';
  if (
    raw === 4 ||
    raw === '4' ||
    raw === '5' ||
    raw === 'CANCEL_REQUESTED' ||
    raw === 'CANCEL_ACKNOWLEDGED'
  ) {
    return 'cancelled';
  }
  return 'unknown';
}

/**
 * Inject the application environment into the kernel source before any
 * `secret()` call runs. The kernel reads `os.environ` first, so a Vercel
 * Secret is enough and the operator does not have to set Kaggle Secrets by
 * hand. The payload lives only in this private kernel on Kaggle, never in git.
 */
function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && ['"', "'"].includes(value[0]) && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

export function injectedKernelSource(source: string, env: Env = process.env): string {
  // A full .env.local is ~10 KB base64, above Vercel's per-variable value
  // limit. It is stored as numbered chunks; keep the legacy single value as
  // the first chunk so older deployments still work.
  const encoded = [
    'KELASKA_ENV_B64',
    ...Array.from({ length: 8 }, (_, i) => `KELASKA_ENV_B64_${i + 1}`),
  ]
    .map((key) => env[key]?.trim() ?? '')
    .join('');
  if (!encoded) throw new Error('KELASKA_ENV_B64 is not configured on Vercel');
  const values = parseEnvText(Buffer.from(encoded, 'base64').toString('utf8'));
  for (const key of [
    'KELASKA_AUTH_PUBLIC_URL',
    'KELASKA_APP_TUNNEL_TOKEN',
    'KELASKA_GPU_TUNNEL_TOKEN',
    'KELASKA_GPU_PUBLIC_URL',
    'KELASKA_MODE',
    'KELASKA_PROXY_TOKEN',
    'KELASKA_GITHUB_TOKEN',
  ]) {
    const override = env[key]?.trim();
    if (override) values[key] = override;
  }
  const payload = Buffer.from(JSON.stringify(values), 'utf8').toString('base64');
  const prefix =
    '# App environment injected by the Vercel wake function (Vercel Secret, not Kaggle Secrets).\n' +
    'import os as _kelaska_env_os, base64 as _kelaska_env_b64, json as _kelaska_env_json\n' +
    `_kelaska_env_os.environ.update(_kelaska_env_json.loads(_kelaska_env_b64.b64decode('${payload}').decode('utf-8')))\n`;
  // `from __future__ import annotations` must stay the first statement in the
  // kernel, otherwise Python exits with a SyntaxError before any cell runs.
  const lines = source.split(/\r?\n/);
  const futureIndex = lines.findIndex((line) =>
    line.trimStart().startsWith('from __future__ import '),
  );
  if (futureIndex >= 0) {
    lines.splice(futureIndex + 1, 0, prefix);
    return lines.join('\n');
  }
  return `${prefix}\n${source}`;
}

/** The SDK serializes enums by name and expects the full slug. */
export function saveKernelBody(
  ref: string,
  source: string,
  env: Env = process.env,
): Record<string, unknown> {
  const { owner, slug } = splitKernelRef(ref);
  const timeout = Number(env.KAGGLE_SESSION_TIMEOUT_SECONDS ?? '');
  // CPU is the default: a GPU session is started only when the caller asks
  // for it with POST /api/wake {"gpu": true}.
  const gpu = env.KAGGLE_ENABLE_GPU?.trim().toLowerCase() === 'true';
  const shape = env.KAGGLE_MACHINE_SHAPE?.trim();
  return {
    slug: `${owner}/${slug}`,
    newTitle: env.KAGGLE_KERNEL_TITLE?.trim() || 'KelasKA Compute',
    text: source,
    language: 'python',
    kernelType: 'script',
    isPrivate: true,
    enableGpu: gpu,
    enableInternet: true,
    ...(gpu && shape ? { machineShape: shape } : {}),
    datasetDataSources: env.KAGGLE_DATASET?.trim() ? [env.KAGGLE_DATASET.trim()] : [],
    categoryIds: [],
    kernelExecutionType: 'SAVE_AND_RUN_ALL',
    ...(Number.isFinite(timeout) && timeout > 0
      ? { sessionTimeoutSeconds: Math.floor(timeout) }
      : {}),
  };
}

async function kagglePost<T>(method: string, body: unknown, env: Env): Promise<T> {
  const response = await fetch(`${KAGGLE_API}/${method}`, {
    method: 'POST',
    headers: {
      authorization: kaggleAuthHeader(env),
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'kelaska-vercel-wake/1.0',
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
      payload = { message: raw.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const message =
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.error === 'string' && payload.error) ||
      `Kaggle ${method} failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

let lastStartAt = 0;

/** Start the kernel only when no session is already running or queued. */
export async function wakeKaggleCompute(env: Env = process.env): Promise<WakeResult> {
  const ref = env.KAGGLE_KERNEL_REF?.trim();
  if (!ref) throw new Error('KAGGLE_KERNEL_REF is not configured on Vercel');
  // Calling the auth header early gives a clear error before any source fetch.
  kaggleAuthHeader(env);
  const { owner, slug } = splitKernelRef(ref);

  if (Date.now() - lastStartAt < COOLDOWN_MS) {
    return { started: false, status: 'cooldown' };
  }

  // Status and source fetch do not depend on each other; running them together
  // keeps the whole function inside Hobby's 10 s wall clock.
  const statusCheck = kagglePost<{ status?: unknown }>(
    'GetKernelSessionStatus',
    { userName: owner, kernelSlug: slug },
    env,
  )
    .then((current) => kernelStatus(current.status))
    .catch((error: unknown) => {
      // Some tokens can push but not read status; the cooldown bounds retries.
      if (
        error instanceof Error &&
        /not configured|must be owner\/kernel-slug/.test(error.message)
      ) {
        throw error;
      }
      return 'unknown';
    });
  const sourceUrl = env.KAGGLE_KERNEL_SOURCE_URL?.trim() || DEFAULT_KERNEL_SOURCE_URL;
  const sourceFetch = fetch(sourceUrl, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Kernel source fetch failed (${response.status})`);
    const text = await response.text();
    if (text.length < 200) throw new Error('Kernel source is unexpectedly short');
    return text;
  });
  const [status, source] = await Promise.all([statusCheck, sourceFetch]);
  if (status === 'running' || status === 'queued') {
    return { started: false, status };
  }

  const saved = await kagglePost<{ ref?: string; url?: string; error?: string }>(
    'SaveKernel',
    saveKernelBody(ref, injectedKernelSource(source, env), env),
    env,
  );
  if (saved.error) throw new Error(saved.error);
  lastStartAt = Date.now();
  return {
    started: true,
    status: 'started',
    ref: saved.ref || ref,
    url: saved.url || `https://www.kaggle.com/code/${ref}`,
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** CPU app and GPU worker are separate kernels, tunnels and domains. */
export function wakeEnv(base: Env, gpu: boolean): Env {
  return {
    ...base,
    KAGGLE_ENABLE_GPU: gpu ? 'true' : 'false',
    KAGGLE_MACHINE_SHAPE: gpu ? base.KAGGLE_MACHINE_SHAPE?.trim() || 'NvidiaTeslaT4' : '',
    KAGGLE_KERNEL_REF: gpu
      ? base.KAGGLE_GPU_KERNEL_REF?.trim() || base.KAGGLE_KERNEL_REF
      : base.KAGGLE_KERNEL_REF,
    KAGGLE_KERNEL_TITLE: gpu ? 'KelasKA GPU Worker' : base.KAGGLE_KERNEL_TITLE,
    KELASKA_MODE: gpu ? 'gpu-worker' : 'app',
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** GET is a credential-free readiness probe; POST starts the kernel. */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (path !== '/api/wake') {
    json(res, 404, { success: false, message: 'Not found' });
    return;
  }
  if (req.method === 'GET') {
    json(res, 200, {
      success: true,
      configured: Boolean(process.env.KAGGLE_KEY && process.env.KAGGLE_KERNEL_REF),
      kernelRef: process.env.KAGGLE_KERNEL_REF?.trim() || null,
      gpuKernelRef: process.env.KAGGLE_GPU_KERNEL_REF?.trim() || null,
    });
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { success: false, message: 'Method not allowed' });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const gpu = body.gpu === true;
    // A GPU session is a separate worker kernel beside the running app, not a
    // replacement: different tunnel (gpu.) and no second Next app/DB pool.
    const env = wakeEnv(process.env, gpu);
    json(res, 200, {
      success: true,
      mode: gpu ? 'gpu' : 'cpu',
      ...(await wakeKaggleCompute(env)),
    });
  } catch (error) {
    json(res, 502, {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
