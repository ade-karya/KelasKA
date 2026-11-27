/** Generation run calls used by the static SPA preview. */

export interface RunSnapshot {
  id: string;
  state: string;
  step: string | null;
  seq: number;
  stageId: string | null;
  progress?: unknown;
  error?: { message?: string } | null;
  updatedAt?: string;
}

export interface StartRunInput {
  requirement: string;
  materialIds?: string[];
  interactive?: boolean;
  taskEngine?: boolean;
}

function failure(status: number): Error {
  return new Error(
    status === 401 || status === 403
      ? 'Sesi aplikasi belum aktif atau kunci API belum diverifikasi.'
      : `Permintaan gagal (${status}).`,
  );
}

/**
 * Wake the on-demand Kaggle worker before a run is enqueued. The worker boots
 * in several minutes, so the run simply waits in `preparing` until it claims
 * the row; a wake failure is deliberately swallowed here (the next start or
 * command retries it).
 */
export async function wakeWorker(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/kaggle/wake', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startRun(
  input: StartRunInput,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSnapshot> {
  const response = await fetchImpl('/api/generation-runs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(input),
  });
  if (!response.ok) throw failure(response.status);
  const body = (await response.json()) as { run: RunSnapshot };
  return body.run;
}

export async function fetchRun(id: string, fetchImpl: typeof fetch = fetch): Promise<RunSnapshot> {
  const response = await fetchImpl(`/api/generation-runs/${encodeURIComponent(id)}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw failure(response.status);
  const body = (await response.json()) as { run: RunSnapshot };
  return body.run;
}
