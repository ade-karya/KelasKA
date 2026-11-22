/** Account view + logout for the static SPA. No browser globals used here. */

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AccountView {
  enabled: boolean;
  user: AccountUser | null;
  redirectTo: string | null;
}

export async function fetchAccount(fetchImpl: typeof fetch = fetch): Promise<AccountView> {
  const response = await fetchImpl('/api/auth/me', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Akun gagal dimuat (${response.status}).`);
  const body = (await response.json()) as Partial<AccountView>;
  return {
    enabled: body.enabled === true,
    user: body.user ?? null,
    redirectTo: body.redirectTo ?? null,
  };
}

export async function signOutApp(fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}
