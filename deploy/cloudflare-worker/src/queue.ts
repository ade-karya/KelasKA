import { errorMessage, json, randomToken, secretEquals } from './http';
import { probeColabIfStale } from './health';
import { proxyRequest } from './proxy';
import { needsGpu } from './routing';
import { sessionOnline, staticUiEnabled } from './session-mode';
import type { Env, QueuedJob } from './types';

const JOB_PREFIX = 'job:';
// A Kaggle 2x T4 cold start (clone + model link + service health) can take
// well over ten minutes, so a queued start must outlive that window.
const JOB_TTL_SECONDS = 1800;
const MAX_QUEUED_BODY_BYTES = 1_000_000;
const JOB_ID = /^[0-9a-f-]{36}$/;

/**
 * Park a generation-start body while Colab is asleep.
 *
 * Only the small JSON start request is queued. The body carries no session
 * cookie: the browser's poll presents its own cookie when the Worker replays
 * the request, so a queued job never stores a credential. The job is deleted
 * as soon as the run starts, fails definitively, or expires.
 */
export async function enqueueGenerationStart(request: Request, env: Env): Promise<Response | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_QUEUED_BODY_BYTES) return null;

  const body = await request.text();
  if (!body || body.length > MAX_QUEUED_BODY_BYTES) return null;

  const id = crypto.randomUUID();
  const secret = randomToken(24);
  const path = new URL(request.url).pathname;
  const job: QueuedJob = {
    id,
    secret,
    path,
    body,
    contentType: request.headers.get('content-type') || 'application/json',
    createdAt: Date.now(),
    needsGpu: needsGpu(path, 'POST'),
  };
  await env.STATE.put(`${JOB_PREFIX}${id}`, JSON.stringify(job), {
    expirationTtl: JOB_TTL_SECONDS,
  });

  const position = (await queueCount(env)) + 1;
  return json(
    {
      queued: true,
      jobId: id,
      secret,
      position,
      etaSeconds: 300,
      reason: staticUiEnabled(env) ? 'session_offline' : 'colab_offline',
    },
    202,
    { 'retry-after': '15' },
  );
}

/** `GET /__kelaska/jobs/:id` — replay the start once Colab answers. */
export async function pollQueuedJob(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const id = pathname.slice('/__kelaska/jobs/'.length);
  if (!JOB_ID.test(id)) return json({ status: 'not_found' }, 404);

  const raw = await env.STATE.get(`${JOB_PREFIX}${id}`);
  if (!raw) return json({ status: 'expired' }, 410);

  let job: QueuedJob;
  try {
    job = JSON.parse(raw) as QueuedJob;
  } catch {
    await env.STATE.delete(`${JOB_PREFIX}${id}`);
    return json({ status: 'expired' }, 410);
  }

  if (!secretEquals(job.secret, request.headers.get('x-kelaska-job-secret'))) {
    return json({ status: 'forbidden' }, 403);
  }
  if (Date.now() - job.createdAt > JOB_TTL_SECONDS * 1000) {
    await deleteJob(env, id);
    return json({ status: 'expired' }, 410);
  }

  // Legacy mode probes the Colab tunnel on demand; static-UI mode uses the
  // session status maintained by the API proxy (and skips the Colab-only probe).
  const backendOnline = staticUiEnabled(env)
    ? await sessionOnline(env)
    : await probeColabIfStale(env);
  if (!backendOnline) {
    return json(
      {
        status: 'queued',
        jobId: id,
        position: Math.max(1, await queueCount(env)),
        etaSeconds: 300,
      },
      202,
      { 'retry-after': '15' },
    );
  }

  // Replaying before the GPU services answer would fail the run at its first
  // image/TTS step. Hold the job until the Kaggle proxy reports healthy.
  if (job.needsGpu) {
    const gpuStatus = await env.STATE.get('gpu:status');
    if (gpuStatus !== 'online') {
      return json(
        {
          status: 'queued',
          jobId: id,
          position: Math.max(1, await queueCount(env)),
          etaSeconds: 300,
          waitingFor: 'gpu',
        },
        202,
        { 'retry-after': '15' },
      );
    }
  }

  const headers = new Headers();
  headers.set('content-type', job.contentType);
  headers.set('origin', 'https://kelaska.riau.ai');
  headers.set('referer', 'https://kelaska.riau.ai/');
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('user-agent', userAgent);

  const replay = new Request(new URL(job.path, 'https://kelaska.riau.ai'), {
    method: 'POST',
    headers,
    body: job.body,
  });

  let response: Response;
  try {
    response = await proxyRequest(replay, env, staticUiEnabled(env) ? 'session' : 'colab');
  } catch (error) {
    return json(
      {
        status: 'queued',
        jobId: id,
        position: 1,
        etaSeconds: 120,
        detail: errorMessage(error),
      },
      202,
      { 'retry-after': '15' },
    );
  }

  const rawBody = await response.text();
  if (response.status >= 500) {
    return json(
      {
        status: 'queued',
        jobId: id,
        position: 1,
        etaSeconds: 120,
        upstreamStatus: response.status,
      },
      202,
      { 'retry-after': '15' },
    );
  }

  await deleteJob(env, id);
  if (!response.ok) {
    return json({ status: 'failed', statusCode: response.status, body: rawBody });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ status: 'failed', statusCode: 502, body: rawBody });
  }
  const run = (payload as { run?: unknown }).run ?? payload;
  return json({ status: 'started', run });
}

/** Count the live keys, so an expired job whose browser never polled again
 * cannot leave a permanent phantom in the queue estimate. */
export async function queueCount(env: Env): Promise<number> {
  const listed = await env.STATE.list({ prefix: JOB_PREFIX });
  return listed.keys.length;
}

async function deleteJob(env: Env, id: string): Promise<void> {
  await env.STATE.delete(`${JOB_PREFIX}${id}`);
}
