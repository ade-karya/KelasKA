import { fetchHealth } from './access';
import type { Env } from './types';

export interface HealthResult {
  colab: boolean;
  gpu: boolean;
}

/** Probe the Colab app through its tunnel and store the answer in KV. */
export async function checkColab(env: Env): Promise<boolean> {
  const result = await fetchHealth(env, env.COLAB_ORIGIN, '/api/health', 10_000);
  const ok = result.ok && result.status >= 200 && result.status < 300;
  await env.STATE.put('colab:status', ok ? 'online' : 'offline');
  if (ok) {
    await env.STATE.put('colab:lastSeen', String(Date.now()));
    await env.STATE.put('colab:latencyMs', String(result.latencyMs));
  }
  return ok;
}

/** Probe the Kaggle reverse proxy and store the answer in KV. */
export async function checkGpu(env: Env): Promise<boolean> {
  const result = await fetchHealth(env, env.GPU_ORIGIN, '/health', 10_000);
  const body = result.body as { ok?: unknown } | undefined;
  const ok = result.ok && result.status >= 200 && result.status < 300 && body?.ok !== false;
  await env.STATE.put('gpu:status', ok ? 'online' : 'offline');
  if (ok) {
    await env.STATE.put('gpu:lastSeen', String(Date.now()));
    await env.STATE.put('gpu:latencyMs', String(result.latencyMs));
  }
  return ok;
}

/** Both probes, in parallel, plus a nudge to the Durable Object. */
export async function checkAll(env: Env): Promise<HealthResult> {
  const [colab, gpu] = await Promise.all([checkColab(env), checkGpu(env)]);
  await env.STATE.put('health:lastCheck', String(Date.now()));
  try {
    const coordinator = env.COORDINATOR.get(env.COORDINATOR.idFromName('kaggle'));
    await coordinator.fetch('https://coordinator/health', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ online: gpu }),
    });
  } catch {
    // The next alarm will reconcile the object; a failed nudge is not fatal.
  }
  return { colab, gpu };
}

/**
 * A queued job polls every few seconds. Trust an `online` KV entry, but when
 * the entry says offline/unknown, re-probe at most every 15 seconds so a
 * freshly started Colab is noticed before the two-minute cron.
 */
export async function probeColabIfStale(env: Env): Promise<boolean> {
  const status = await env.STATE.get('colab:status');
  if (status === 'online') return true;
  const lastProbe = Number((await env.STATE.get('colab:lastProbe')) ?? 0);
  if (Date.now() - lastProbe < 15_000) return false;
  await env.STATE.put('colab:lastProbe', String(Date.now()));
  return checkColab(env);
}
