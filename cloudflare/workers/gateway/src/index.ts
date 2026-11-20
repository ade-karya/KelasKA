/**
 * Worker gerbang — api-kelas.riau.ai
 *
 * Tugasnya hanya routing tipis:
 *   - `/api/*` dan halaman lain diteruskan ke Vercel.
 *   - `/worker/colab/*` dan `/worker/gpu/*` diteruskan hanya bila worker
 *     on-demand sedang aktif (status dari KV yang ditulis Cron Worker).
 *   - `/worker/status` dipakai Vercel untuk menampilkan status worker.
 *
 * Worker ini TIDAK membaca header identitas gateway (cf-access-*). Cloudflare
 * Access memverifikasi identitas di edge; aplikasi tidak boleh mempercayai
 * header tersebut tanpa verifikasi di sisi aplikasi (lihat cookie-guard test).
 */
interface Env {
  ORIGIN_VERCEL: string;
  ALLOWED_ORIGIN: string;
  WORKER_STATE: { get(key: string): Promise<string | null> };
}

const WORKER_STATE_KEY = 'kelaska:workers';
const MAX_BODY_BYTES = 100 * 1024 * 1024;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);

function json(body: unknown, status = 200, env?: Env): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': env?.ALLOWED_ORIGIN ?? '*',
    'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  return new Response(JSON.stringify(body), { status, headers });
}

async function workerOnline(env: Env): Promise<boolean> {
  try {
    return (await env.WORKER_STATE.get(WORKER_STATE_KEY)) === 'online';
  } catch {
    return false;
  }
}

function proxy(request: Request, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  headers.delete('cf-access-jwt-assertion');
  headers.delete('cf-access-identity');

  const forwarded = new Request(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
  return fetch(forwarded);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({}, 204, env);
    }
    if (!SAFE_METHODS.has(request.method)) {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405, env);
    }
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ error: 'PAYLOAD_TOO_LARGE' }, 413, env);
    }

    if (url.pathname === '/worker/status') {
      const online = await workerOnline(env);
      return json(
        { workers: online ? 'online' : 'offline', checkedAt: new Date().toISOString() },
        200,
        env,
      );
    }

    const isWorkerRoute =
      url.pathname.startsWith('/worker/colab/') || url.pathname.startsWith('/worker/gpu/');
    if (isWorkerRoute && !(await workerOnline(env))) {
      return json(
        {
          error: 'WORKER_OFFLINE',
          hint: 'Worker on-demand belum dinyalakan. Permintaan sudah masuk antrean Supabase.',
        },
        503,
        env,
      );
    }

    try {
      return proxy(request, env.ORIGIN_VERCEL);
    } catch {
      return json({ error: 'ORIGIN_UNAVAILABLE' }, 502, env);
    }
  },
};
