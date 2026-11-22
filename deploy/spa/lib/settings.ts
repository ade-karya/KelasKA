/** Read-only model settings view for the static SPA. */

export interface SettingsView {
  revision: number | null;
  allowUserKeys?: boolean;
  providers: Array<{
    id: string;
    preset: string;
    presetName?: string;
    source?: string;
    key?: { set?: boolean; mask?: string };
  }>;
  slots: Array<{
    slot: string;
    locked?: boolean;
    source?: { kind?: string };
  }>;
}

export async function fetchSettings(fetchImpl: typeof fetch = fetch): Promise<SettingsView> {
  const response = await fetchImpl('/api/model-config', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Sesi aplikasi belum aktif atau kunci API belum diverifikasi.'
        : `Pengaturan model gagal dimuat (${response.status}).`,
    );
  }
  const body = (await response.json()) as Partial<SettingsView>;
  return {
    revision: body.revision ?? null,
    allowUserKeys: body.allowUserKeys,
    providers: Array.isArray(body.providers) ? body.providers : [],
    slots: Array.isArray(body.slots) ? body.slots : [],
  };
}
