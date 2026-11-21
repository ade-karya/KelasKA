import { accessHeaders } from './access';
import type { Env, Upstream } from './types';

function originFor(env: Env, upstream: Upstream): string {
  switch (upstream) {
    case 'vercel':
      return env.VERCEL_ORIGIN;
    case 'colab':
      return env.COLAB_ORIGIN;
    case 'gpu':
      return env.GPU_ORIGIN;
  }
}

/**
 * Stream a request to one upstream and stream the answer back. The body is
 * never buffered: SSE (`text/event-stream`), uploads, and downloads keep their
 * shape through the Worker.
 */
export async function proxyRequest(
  request: Request,
  env: Env,
  upstream: Upstream,
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, originFor(env, upstream));

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));
  headers.set('x-kelaska-edge', '1');

  if (upstream !== 'vercel') {
    for (const [name, value] of accessHeaders(env)) headers.set(name, value);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  const response = await fetch(target.toString(), init);
  return passthrough(response, upstream);
}

/** Preserve multiple Set-Cookie headers and tag the origin for debugging. */
function passthrough(response: Response, upstream: Upstream): Response {
  const headers = new Headers(response.headers);
  headers.set('x-kelaska-upstream', upstream);

  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  const cookies = getSetCookie ? getSetCookie.call(response.headers) : [];

  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  if (cookies.length > 0) {
    out.headers.delete('set-cookie');
    for (const cookie of cookies) out.headers.append('set-cookie', cookie);
  }
  return out;
}

/** A response body that is safe to hand to a browser when the edge itself fails. */
export function backendOffline(reason: 'colab' | 'gpu', detail?: string): Response {
  const body = {
    success: false,
    errorCode: reason === 'colab' ? 'BACKEND_OFFLINE' : 'GPU_OFFLINE',
    error:
      reason === 'colab'
        ? 'Backend kelas belum aktif. Operator perlu menjalankan notebook Colab; permintaan baru akan masuk antrean.'
        : 'GPU belum aktif. Mesin Kaggle sedang disiapkan atau kuota GPU habis.',
    retryable: true,
    ...(detail ? { detail } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': reason === 'colab' ? '30' : '60',
    },
  });
}
