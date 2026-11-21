import { Coordinator } from './coordinator';
import { checkAll } from './health';
import { bearerToken, errorMessage, intEnv, json, secretEquals } from './http';
import { backendOffline, proxyRequest } from './proxy';
import { enqueueGenerationStart, pollQueuedJob, queueCount } from './queue';
import { isQueueableStart, needsGpu, upstreamFor } from './routing';
import type { CoordinatorState, Env } from './types';

export { Coordinator };

const COORDINATOR_NAME = 'kaggle';

function coordinator(env: Env): DurableObjectStub {
  return env.COORDINATOR.get(env.COORDINATOR.idFromName(COORDINATOR_NAME));
}

async function coordinatorState(env: Env): Promise<CoordinatorState | null> {
  try {
    const response = await coordinator(env).fetch('https://coordinator/state');
    return (await response.json()) as CoordinatorState;
  } catch {
    return null;
  }
}

/** Ask the single-flight object for a GPU box. Never blocks the caller. */
async function ensureGpu(env: Env): Promise<CoordinatorState | null> {
  try {
    const response = await coordinator(env).fetch('https://coordinator/desire', {
      method: 'POST',
    });
    return (await response.json()) as CoordinatorState;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/__kelaska/health') {
      return json({
        ok: true,
        service: 'kelaska-edge',
        environment: env.ENVIRONMENT ?? 'production',
        now: Date.now(),
      });
    }

    if (path === '/__kelaska/status') return status(env);
    if (path === '/__kelaska/gpu/lease') return gpuLease(request, env);
    if (path.startsWith('/__kelaska/admin/')) return admin(request, env);
    if (path.startsWith('/__kelaska/jobs/')) return pollQueuedJob(request, env);

    if (upstreamFor(path, request.method) === 'vercel') {
      try {
        return await proxyRequest(request, env, 'vercel');
      } catch (error) {
        return json(
          {
            success: false,
            errorCode: 'EDGE_UPSTREAM_UNREACHABLE',
            error: 'UI upstream tidak dapat dihubungi.',
            detail: errorMessage(error),
          },
          502,
        );
      }
    }

    // A generation start is small JSON. If Colab is asleep, park it and let the
    // browser poll; the poll replays it with the browser's own session cookie.
    if (isQueueableStart(path, request.method)) {
      const colabStatus = await env.STATE.get('colab:status');
      if (colabStatus !== 'online') {
        const queued = await enqueueGenerationStart(request.clone(), env);
        if (queued) {
          ctx.waitUntil(env.STATE.put('gpu:lastRequest', String(Date.now())));
          ctx.waitUntil(ensureGpu(env));
          return queued;
        }
      }
    }

    if (needsGpu(path, request.method)) {
      ctx.waitUntil(env.STATE.put('gpu:lastRequest', String(Date.now())));
      ctx.waitUntil(ensureGpu(env));
    }

    const colabStatus = await env.STATE.get('colab:status');
    if (colabStatus === 'offline') return backendOffline('colab');

    try {
      const response = await proxyRequest(request, env, 'colab');
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        await env.STATE.put('colab:status', 'offline');
        return backendOffline('colab', `upstream ${response.status}`);
      }
      return response;
    } catch (error) {
      await env.STATE.put('colab:status', 'offline');
      return backendOffline('colab', errorMessage(error));
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAll(env));
  },
} satisfies ExportedHandler<Env>;

/** Public, non-secret status for the app's cold-start banner. */
async function status(env: Env): Promise<Response> {
  const [
    colabStatus,
    colabLastSeen,
    colabLatency,
    gpuStatus,
    gpuLastSeen,
    gpuLastRequest,
    lastCheck,
    queue,
    kaggle,
  ] = await Promise.all([
    env.STATE.get('colab:status'),
    env.STATE.get('colab:lastSeen'),
    env.STATE.get('colab:latencyMs'),
    env.STATE.get('gpu:status'),
    env.STATE.get('gpu:lastSeen'),
    env.STATE.get('gpu:lastRequest'),
    env.STATE.get('health:lastCheck'),
    queueCount(env),
    coordinatorState(env),
  ]);

  return json({
    ok: true,
    environment: env.ENVIRONMENT ?? 'production',
    now: Date.now(),
    colab: {
      status: colabStatus ?? 'unknown',
      lastSeen: numberOrNull(colabLastSeen),
      latencyMs: numberOrNull(colabLatency),
    },
    gpu: {
      status: gpuStatus ?? 'unknown',
      lastSeen: numberOrNull(gpuLastSeen),
      lastRequest: numberOrNull(gpuLastRequest),
    },
    kaggle: kaggle
      ? {
          status: kaggle.status,
          desired: kaggle.desired,
          startedAt: kaggle.startedAt,
          lastHealthAt: kaggle.lastHealthAt,
          lastError: kaggle.lastError,
          cooldownUntil: kaggle.cooldownUntil,
          sessionStatus: kaggle.sessionStatus,
        }
      : null,
    queue,
    lastCheck: numberOrNull(lastCheck),
  });
}

/**
 * The Kaggle kernel's keep-alive. It is not a health check: it tells the
 * kernel whether the deployment still wants the box. The Worker stops an idle
 * session so the weekly GPU quota is not spent on a warm tunnel.
 */
async function gpuLease(request: Request, env: Env): Promise<Response> {
  if (!secretEquals(env.GPU_LEASE_KEY, request.headers.get('x-kelaska-gpu-key'))) {
    return json({ error: 'forbidden' }, 403);
  }
  const now = Date.now();
  await env.STATE.put('gpu:lastSeen', String(now));

  const stopRequested = (await env.STATE.get('gpu:stopRequested')) === '1';
  const lastRequest = Number((await env.STATE.get('gpu:lastRequest')) ?? 0);
  const idleMs = intEnv(env.GPU_IDLE_STOP_SECONDS, 1800) * 1000;
  const idle = lastRequest > 0 && now - lastRequest > idleMs;
  const keepAlive = !stopRequested && !idle;
  if (!keepAlive) await env.STATE.put('gpu:status', 'stopping');

  return json({
    keepAlive,
    ttlSeconds: 120,
    now,
    reason: stopRequested ? 'stop_requested' : idle ? 'idle' : 'active',
  });
}

async function admin(request: Request, env: Env): Promise<Response> {
  if (!secretEquals(env.EDGE_ADMIN_TOKEN, bearerToken(request))) {
    return json({ error: 'forbidden' }, 401);
  }
  const action = new URL(request.url).pathname.slice('/__kelaska/admin/'.length);
  switch (action) {
    case 'warmup':
      return json((await ensureGpu(env)) ?? { status: 'unknown' });
    case 'stop': {
      const response = await coordinator(env).fetch('https://coordinator/stop', { method: 'POST' });
      return json(await response.json());
    }
    case 'clear-stop': {
      const response = await coordinator(env).fetch('https://coordinator/clear-stop', {
        method: 'POST',
      });
      return json(await response.json());
    }
    case 'check':
      return json(await checkAll(env));
    case 'state': {
      const [kaggle, queue] = await Promise.all([coordinatorState(env), queueCount(env)]);
      return json({ kaggle, queue });
    }
    default:
      return json({ error: 'not_found' }, 404);
  }
}

function numberOrNull(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
