import { accessHeaders } from './access';
import { errorMessage, intEnv, json } from './http';
import { fetchKernelSource, getKernelSessionStatus, saveAndRunKernel } from './kaggle';
import { EMPTY_COORDINATOR_STATE, type CoordinatorState, type Env } from './types';

const STATE_KEY = 'state';

/**
 * Single-flight owner of the Kaggle session.
 *
 * Durable Object requests are serialized, so two generation starts that both
 * need a GPU can never push two kernels. The object also owns the alarm that
 * polls the session and the GPU health endpoint; the Worker entrypoint stays
 * stateless and only asks this object for state.
 */
export class Coordinator implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    switch (path) {
      case '/ensure':
        return json(await this.ensure());
      case '/desire': {
        const state = await this.load();
        state.desired = true;
        await this.save(state);
        return json(await this.ensure());
      }
      case '/state':
        return json(await this.load());
      case '/stop': {
        const state = await this.load();
        state.desired = false;
        state.stopRequested = true;
        state.status = 'stopping';
        await this.save(state);
        await this.env.STATE.put('gpu:stopRequested', '1');
        await this.schedule(15);
        return json(state);
      }
      case '/clear-stop': {
        const state = await this.load();
        state.stopRequested = false;
        state.desired = false;
        if (state.status === 'stopping' || state.status === 'offline') state.status = 'idle';
        await this.save(state);
        await this.env.STATE.delete('gpu:stopRequested');
        return json(state);
      }
      case '/health': {
        const body = (await request.json().catch(() => ({}))) as { online?: unknown };
        const state = await this.load();
        if (body.online === true) {
          state.status = 'online';
          state.lastHealthAt = Date.now();
          state.failures = 0;
          state.lastError = null;
          await this.env.STATE.put('gpu:status', 'online');
        } else if (body.online === false && state.status === 'online') {
          state.failures += 1;
          if (state.failures >= 3) {
            state.status = 'offline';
            state.lastError = 'GPU health check failed';
            await this.env.STATE.put('gpu:status', 'offline');
          }
        }
        await this.save(state);
        return json(state);
      }
      default:
        return json({ error: 'not_found' }, 404);
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.poll();
    } catch (error) {
      const state = await this.load();
      state.lastError = errorMessage(error);
      await this.save(state);
      await this.schedule(60);
    }
  }

  /** Start the kernel unless one is already starting, online, or cooling down. */
  private async ensure(): Promise<CoordinatorState> {
    const state = await this.load();
    const now = Date.now();
    if (state.status === 'starting' || state.status === 'online' || state.status === 'stopping') {
      return state;
    }
    if (state.cooldownUntil && now < state.cooldownUntil) return state;

    state.status = 'starting';
    state.desired = true;
    state.stopRequested = false;
    state.startedAt = now;
    state.lastError = null;
    state.failures = 0;
    state.sessionStatus = 'queued';
    await this.save(state);
    await this.env.STATE.put('gpu:status', 'starting');
    await this.env.STATE.delete('gpu:stopRequested');

    try {
      const source = await fetchKernelSource(this.env);
      const result = await saveAndRunKernel(this.env, source);
      state.kernelRef = result.ref;
      state.kernelUrl = result.url;
      state.versionNumber = result.versionNumber;
      await this.save(state);
      await this.schedule(30);
    } catch (error) {
      state.status = 'error';
      state.lastError = errorMessage(error);
      state.cooldownUntil = now + this.cooldownMs();
      await this.save(state);
      await this.env.STATE.put('gpu:status', 'offline');
    }
    return state;
  }

  /** Poll health and session state; reschedule until the session ends. */
  private async poll(): Promise<void> {
    const state = await this.load();
    const now = Date.now();

    if (state.status === 'stopping') {
      if (await this.gpuHealthy()) {
        await this.schedule(30);
        return;
      }
      state.status = 'offline';
      state.desired = false;
      state.stopRequested = false;
      state.cooldownUntil = now + this.cooldownMs();
      await this.save(state);
      await this.env.STATE.put('gpu:status', 'offline');
      return;
    }

    if (state.status === 'online' || state.status === 'starting') {
      if (await this.gpuHealthy()) {
        state.status = 'online';
        state.lastHealthAt = now;
        state.failures = 0;
        state.lastError = null;
        await this.save(state);
        await this.env.STATE.put('gpu:status', 'online');
        await this.env.STATE.put('gpu:lastSeen', String(now));
        await this.schedule(120);
        return;
      }

      if (state.status === 'online') {
        state.failures += 1;
        state.lastHealthAt = now;
        if (state.failures >= 3) {
          state.status = 'offline';
          state.lastError = 'GPU health check failed';
          await this.env.STATE.put('gpu:status', 'offline');
        }
        await this.save(state);
        await this.schedule(60);
        return;
      }

      let kernel;
      try {
        kernel = await getKernelSessionStatus(this.env);
      } catch (error) {
        state.lastError = errorMessage(error);
        await this.save(state);
        await this.schedule(30);
        return;
      }
      state.sessionStatus = kernel.status;
      if (
        kernel.status === 'complete' ||
        kernel.status === 'error' ||
        kernel.status === 'cancelled'
      ) {
        state.status = kernel.status === 'error' ? 'error' : 'offline';
        state.lastError = kernel.failureMessage || `Kaggle session ${kernel.status}`;
        state.cooldownUntil = now + this.cooldownMs();
        state.desired = false;
        await this.save(state);
        await this.env.STATE.put('gpu:status', 'offline');
        return;
      }
      await this.save(state);
      await this.schedule(30);
      return;
    }

    if (state.desired && (!state.cooldownUntil || now >= state.cooldownUntil)) {
      await this.ensure();
    }
  }

  private async gpuHealthy(): Promise<boolean> {
    try {
      const response = await fetch(new URL('/health', this.env.GPU_ORIGIN), {
        headers: accessHeaders(this.env),
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return false;
      const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
      return body?.ok !== false;
    } catch {
      return false;
    }
  }

  private cooldownMs(): number {
    return intEnv(this.env.KAGGLE_COOLDOWN_SECONDS, 900) * 1000;
  }

  private async load(): Promise<CoordinatorState> {
    const stored = await this.ctx.storage.get<CoordinatorState>(STATE_KEY);
    return stored ? { ...EMPTY_COORDINATOR_STATE, ...stored } : { ...EMPTY_COORDINATOR_STATE };
  }

  private async save(state: CoordinatorState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private async schedule(seconds: number): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + seconds * 1000);
  }
}
