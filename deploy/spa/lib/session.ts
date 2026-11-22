/** Edge helpers shared by the SPA shell and its tests. No React/Next APIs. */

export interface EdgeStatus {
  ok?: boolean;
  session?: string | null;
  gpu?: { status?: string | null } | null;
  colab?: { status?: string | null } | null;
  queue?: number;
}

export type SessionState = 'online' | 'starting' | 'offline';

/** The Worker's /__kelaska/status is public; use its session field when set. */
export function sessionState(status: EdgeStatus): SessionState {
  // The Worker treats an explicit `session:status` as authoritative; only a
  // missing/unknown value falls back to the older GPU/Colab health keys.
  if (
    status.session === 'online' ||
    status.session === 'starting' ||
    status.session === 'offline'
  ) {
    return status.session;
  }
  if (status.gpu?.status === 'online' || status.colab?.status === 'online') return 'online';
  return 'offline';
}

export async function fetchEdgeStatus(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<EdgeStatus> {
  const response = await fetchImpl('/__kelaska/status', {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return (await response.json()) as EdgeStatus;
}

export interface StartResult {
  ok: boolean;
  status: number;
  retryAfterSeconds: number | null;
}

/** POST /api/session/start is answered by the Worker, not by the session. */
export async function startSession(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StartResult> {
  const response = await fetchImpl('/api/session/start', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const raw = response.headers.get('retry-after');
  const parsed = raw ? Number(raw) : NaN;
  return {
    ok: response.ok,
    status: response.status,
    retryAfterSeconds: Number.isFinite(parsed) ? parsed : null,
  };
}

/** Exchange the Supabase token for an HttpOnly app cookie via the session app. */
export async function exchangeAppSession(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  const response = await fetchImpl('/api/auth/spa/session', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  return { ok: response.ok, status: response.status };
}

export function startFailureMessage(status: number): string {
  if (status === 401) return 'Masuk dengan Google terlebih dahulu.';
  if (status === 429) return 'Terlalu banyak permintaan mulai sesi. Tunggu sebentar.';
  return 'Sesi gagal dimulai. Coba lagi.';
}
