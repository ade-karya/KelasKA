/** Admin account console calls for the static SPA. The API enforces the role. */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  active: boolean;
  createdAt: string;
  apiKeyExempt?: boolean;
  apiKey?: { status?: string; exempt?: boolean; keys?: unknown[] };
}

export interface UserPatch {
  name?: string;
  role?: AdminUser['role'];
  active?: boolean;
}

function failure(response: Response): Error {
  return new Error(
    response.status === 403
      ? 'Hanya admin yang dapat mengelola akun.'
      : `Permintaan gagal (${response.status}).`,
  );
}

export async function fetchUsers(fetchImpl: typeof fetch = fetch): Promise<AdminUser[]> {
  const response = await fetchImpl('/api/admin/users', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw failure(response);
  const body = (await response.json()) as { users?: AdminUser[] };
  return Array.isArray(body.users) ? body.users : [];
}

export async function updateUser(
  id: string,
  patch: UserPatch,
  fetchImpl: typeof fetch = fetch,
): Promise<AdminUser> {
  const response = await fetchImpl(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw failure(response);
  const body = (await response.json()) as { user: AdminUser };
  return body.user;
}

export async function createUser(
  email: string,
  name: string,
  role: AdminUser['role'],
  fetchImpl: typeof fetch = fetch,
): Promise<AdminUser> {
  const response = await fetchImpl('/api/admin/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name, role }),
  });
  if (!response.ok) throw failure(response);
  const body = (await response.json()) as { user: AdminUser };
  return body.user;
}
