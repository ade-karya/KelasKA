/**
 * Cron Worker — pemeliharaan tiap 5 menit.
 *
 * - Memanggil /api/internal/maintenance di Vercel untuk cek DB, antrean, dan
 *   keberadaan worker on-demand (heartbeat <10 menit).
 * - Menyimpan status worker ke KV yang dibaca Worker gerbang.
 * - Menjaga Supabase tetap aktif (Free pause setelah 7 hari idle).
 * - Mengirim notifikasi ke operator bila ada job macet atau antrean menumpuk
 *   tanpa worker aktif.
 *
 * fetch() tidak dihitung sebagai CPU time, jadi semua pekerjaan di sini aman
 * dalam batas 10 ms/request Workers Free.
 */
interface Env {
  MAINTENANCE_URL: string;
  CRON_SECRET: string;
  OPERATOR_WEBHOOK: string;
  KEEPALIVE_URL: string;
  KEEPALIVE_ANON_KEY?: string;
  WORKER_STATE: { put(key: string, value: string): Promise<void> };
}

interface Maintenance {
  ok?: boolean;
  dbOk?: boolean;
  queued?: number | null;
  stuck?: number | null;
  workersOnline?: number | null;
  error?: string;
}

const WORKER_STATE_KEY = 'kelaska:workers';

async function notify(env: Env, text: string): Promise<void> {
  if (!env.OPERATOR_WEBHOOK) return;
  await fetch(env.OPERATOR_WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function keepAlive(env: Env): Promise<void> {
  if (!env.KEEPALIVE_URL) return;
  await fetch(env.KEEPALIVE_URL, {
    headers: env.KEEPALIVE_ANON_KEY ? { apikey: env.KEEPALIVE_ANON_KEY } : undefined,
  });
}

async function run(env: Env): Promise<Maintenance> {
  const [maintenanceResult, keepAliveResult] = await Promise.allSettled([
    fetch(env.MAINTENANCE_URL, {
      method: 'POST',
      headers: { 'x-kelaska-cron-secret': env.CRON_SECRET },
    }),
    keepAlive(env),
  ]);

  let report: Maintenance = { ok: false, error: 'MAINTENANCE_UNREACHABLE' };
  if (maintenanceResult.status === 'fulfilled' && maintenanceResult.value.ok) {
    try {
      report = (await maintenanceResult.value.json()) as Maintenance;
    } catch {
      report = { ok: false, error: 'INVALID_MAINTENANCE_RESPONSE' };
    }
  }

  const online = (report.workersOnline ?? 0) > 0;
  await env.WORKER_STATE.put(WORKER_STATE_KEY, online ? 'online' : 'offline').catch(() => {});

  const queued = report.queued ?? 0;
  const stuck = report.stuck ?? 0;
  if (stuck > 0) {
    await notify(
      env,
      `[KelasKA] ${stuck} job macet terdeteksi. Cek Supabase worker_jobs dan nyalakan worker on-demand.`,
    );
  } else if (queued > 0 && !online) {
    await notify(
      env,
      `[KelasKA] ${queued} job menunggu dan tidak ada worker aktif. Nyalakan Colab/Kaggle sesuai kebutuhan.`,
    );
  }
  if (keepAliveResult.status === 'rejected') {
    await notify(env, '[KelasKA] Keep-alive Supabase gagal; project berisiko pause.');
  }
  return report;
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(run(env));
  },

  // Manual trigger untuk smoke test: POST /__cron dengan secret yang sama.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== '/__cron' ||
      request.headers.get('x-kelaska-cron-secret') !== env.CRON_SECRET
    ) {
      return new Response('Not Found', { status: 404 });
    }
    const report = await run(env);
    return new Response(JSON.stringify(report), {
      headers: { 'content-type': 'application/json' },
    });
  },
};
