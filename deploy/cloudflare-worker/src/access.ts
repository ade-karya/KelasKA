import type { Env } from './types';

/**
 * Cloudflare Access service-token headers. The `api.` and `gpu.` hostnames are
 * protected by an Access application whose only policy is this service token;
 * the browser never talks to them directly.
 */
export function accessHeaders(env: Env): Headers {
  const headers = new Headers();
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
  }
  return headers;
}

/** Fetch a health endpoint through Access, with a bounded wait. */
export async function fetchHealth(
  env: Env,
  origin: string,
  path: string,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status: number; latencyMs: number; body?: unknown }> {
  const startedAt = Date.now();
  const headers = accessHeaders(env);
  headers.set('accept', 'application/json');
  try {
    const response = await fetch(new URL(path, origin), {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    let body: unknown;
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      body = await response.json().catch(() => undefined);
    }
    return { ok: response.ok, status: response.status, latencyMs, body };
  } catch {
    return { ok: false, status: 0, latencyMs: Date.now() - startedAt };
  }
}
