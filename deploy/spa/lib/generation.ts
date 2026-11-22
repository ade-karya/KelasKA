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
