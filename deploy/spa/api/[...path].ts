/**
 * The only Vercel function in the Hobby deployment.
 *
 * Two jobs:
 *   POST /api/kaggle/wake  -> start the on-demand Kaggle kernel through the
 *                             Kaggle API (the kernel clones deploy/kaggle).
 *   everything else        -> stream the request to the existing app behind
 *                             the Cloudflare Worker, so the static SPA keeps
 *                             using same-origin /api/* with its cookie.
 *
 * Keeping this in one function matters: Hobby allows at most 12 Serverless
 * Functions per deployment, and the full Next app has ~126 routes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Pool } from 'pg';

const BACKEND = (process.env.SPLIT_BACKEND_ORIGIN || 'https://kelaska.riau.ai').replace(/\/$/, '');
const KAGGLE_API = 'https://api.kaggle.com/v1/kernels.KernelsApiService';
const DEFAULT_KERNEL_REF = 'akjdev/kelaska-worker';
const DEFAULT_SOURCE_URL =
  'https://raw.githubusercontent.com/ade-karya/KelasKA/refs/heads/deploy/kaggle/deploy/kaggle/worker-kernel.py';
const REQUEST_TIMEOUT_MS = 25_000;
const LAUNCH_COOLDOWN_MS = 2 * 60 * 1000;

let cooldownPool: Pool | undefined;
function launchPool(): Pool | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  cooldownPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  return cooldownPool;
}

/** Reserve a launch slot across Vercel instances; best-effort. */
async function reserveLaunch(): Promise<boolean> {
  const pool = launchPool();
  if (!pool) return true;
  try {
    const now = Date.now();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO kaggle_worker_launch (id, last_started_at)
       VALUES ('default', $1)
       ON CONFLICT (id) DO UPDATE
         SET last_started_at = EXCLUDED.last_started_at, updated_at = now()
         WHERE kaggle_worker_launch.last_started_at < $2
       RETURNING id`,
      [now, now - LAUNCH_COOLDOWN_MS],
    );
    return rows.length > 0;
  } catch {
    // The table is created by the full app / Kaggle worker. If it is not
    // there yet, an extra kernel version is cheaper than a stuck run.
    return true;
  }
}

export const config = { api: { bodyParser: false } };

interface WakeResult {
  started: boolean;
  status: string;
  ref?: string;
  url?: string;
  message?: string;
}

function kaggleAuth(): string {
  const key = process.env.KAGGLE_KEY?.trim() || '';
  if (!key) throw new Error('KAGGLE_KEY is not configured');
  if (key.startsWith('KGAT_')) return `Bearer ${key}`;
  const username = process.env.KAGGLE_USERNAME?.trim();
  if (!username) throw new Error('KAGGLE_USERNAME is required for a classic Kaggle key');
  return `Basic ${btoa(`${username}:${key}`)}`;
}

function splitRef(ref: string): { owner: string; slug: string } {
  const [owner, slug, extra] = ref.split('/');
  if (!owner || !slug || extra) throw new Error(`KAGGLE_KERNEL_REF must be owner/kernel-slug`);
  return { owner, slug };
}

async function kagglePost<T>(method: string, body: unknown): Promise<T> {
  const response = await fetch(`${KAGGLE_API}/${method}`, {
    method: 'POST',
    headers: {
      authorization: kaggleAuth(),
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'kelaska-spa/1.0',
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
    throw new Error(
      (typeof payload.message === 'string' && payload.message) ||
        `Kaggle ${method} failed (${response.status})`,
    );
  }
  return payload as T;
}

function kernelStatus(value: unknown): string {
  const v = typeof value === 'string' ? value.toUpperCase() : value;
  if (v === 0 || v === '0' || v === 'QUEUED') return 'queued';
  if (v === 1 || v === '1' || v === 'RUNNING') return 'running';
  if (v === 2 || v === '2' || v === 'COMPLETE') return 'complete';
  if (v === 3 || v === '3' || v === 'ERROR') return 'error';
  return 'unknown';
}

async function wakeKernel(): Promise<WakeResult> {
  const ref = process.env.KAGGLE_KERNEL_REF?.trim() || DEFAULT_KERNEL_REF;
  const { owner, slug } = splitRef(ref);
  try {
    const current = await kagglePost<{ status?: unknown }>('GetKernelSessionStatus', {
      userName: owner,
      kernelSlug: slug,
    });
    const status = kernelStatus(current.status);
    if (status === 'running' || status === 'queued') {
      return { started: false, status };
    }
  } catch {
    // Some Kaggle tokens may push kernels but cannot read session status.
    // Fall through to SaveKernel; the cooldown below bounds duplicate pushes.
  }

  if (!(await reserveLaunch())) {
    return { started: false, status: 'cooldown' };
  }

  const sourceUrl = process.env.KAGGLE_KERNEL_SOURCE_URL?.trim() || DEFAULT_SOURCE_URL;
  const sourceResponse = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!sourceResponse.ok) {
    throw new Error(`Kernel source fetch failed (${sourceResponse.status})`);
  }
  const source = await sourceResponse.text();
  if (source.length < 200) throw new Error('Kernel source is unexpectedly short');

  const timeout = Number(process.env.KAGGLE_SESSION_TIMEOUT_SECONDS ?? '');
  const saved = await kagglePost<{ ref?: string; url?: string; error?: string }>('SaveKernel', {
    slug: ref,
    newTitle: process.env.KAGGLE_KERNEL_TITLE?.trim() || 'KelasKA Worker',
    text: source,
    language: 'python',
    kernelType: 'script',
    isPrivate: true,
    enableGpu: true,
    enableInternet: true,
    machineShape: process.env.KAGGLE_MACHINE_SHAPE?.trim() || 'NvidiaTeslaT4',
    datasetDataSources: process.env.KAGGLE_DATASET?.trim()
      ? [process.env.KAGGLE_DATASET.trim()]
      : [],
    categoryIds: [],
    // The Kaggle SDK serializes enums by name.
    kernelExecutionType: 'SAVE_AND_RUN_ALL',
    sessionTimeoutSeconds:
      Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 4 * 60 * 60,
  });
  if (saved.error) throw new Error(saved.error);
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
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const segments = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  // Vercel's filesystem route only matches one segment after /api. A rewrite
  // folds the remaining segments into ?rest=..., so restore them here.
  const queryRest = (req as IncomingMessage & { query?: Record<string, string | string[]> }).query
    ?.rest;
  const rest =
    url.searchParams.get('rest') ||
    (Array.isArray(queryRest) ? queryRest[0] : queryRest) ||
    undefined;
  url.searchParams.delete('rest');
  const path = rest ? `${segments.join('/')}/${rest}` : segments.join('/');

  if (path === 'kaggle/wake' && req.method === 'POST') {
    try {
      json(res, 200, { success: true, ...(await wakeKernel()) });
    } catch (error) {
      json(res, 502, {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (path === 'kaggle/wake') {
    json(res, 405, { success: false, message: 'Method not allowed' });
    return;
  }

  const target = new URL(`${BACKEND}/api/${path}`);
  target.search = url.search;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || ['host', 'connection', 'content-length', 'accept-encoding'].includes(key)) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }

  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(300_000),
    });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (['content-length', 'transfer-encoding', 'connection'].includes(key)) return;
      if (key === 'set-cookie') {
        // The SPA lives on kelas.riau.ai; a cookie scoped to a different host
        // would never come back to this proxy. Keep it host-only.
        const cookies = value.split(/,(?=\s*[^;,=]+\s*=)/).map((cookie) =>
          cookie.replace(/;\s*Domain=[^;]+/i, '').trim(),
        );
        for (const cookie of cookies) res.setHeader('set-cookie', cookie);
        return;
      }
      res.setHeader(key, value);
    });
    if (!upstream.body) {
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    json(res, 503, {
      success: false,
      code: 'BACKEND_OFFLINE',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
