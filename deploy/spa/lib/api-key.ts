/**
 * Bring-your-own-key onboarding calls. Kept pure so the static SPA can test
 * the compare-and-swap sequence without a browser or the session app.
 *
 * The provider list mirrors `lib/config/api-key-onboarding.ts` in the app; both
 * must stay in sync (id/preset/defaultModel are sent to /api/model-config).
 */

export interface OnboardingProvider {
  id: string;
  preset: string;
  name: string;
  signupUrl: string;
  defaultModel: string;
}

export const ONBOARDING_PROVIDERS: readonly OnboardingProvider[] = [
  {
    id: 'onboarding-google',
    preset: 'google',
    name: 'Gemini',
    signupUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.5-flash-lite',
  },
  {
    id: 'onboarding-openrouter',
    preset: 'openrouter',
    name: 'OpenRouter',
    signupUrl: 'https://openrouter.ai/keys',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'onboarding-coarena',
    preset: 'coarena',
    name: 'Coarena',
    signupUrl: 'https://coarena.ai',
    defaultModel: 'deepseek-v4-1-flash-1017',
  },
  {
    id: 'onboarding-crowllm',
    preset: 'crowllm',
    name: 'CrowLLM',
    signupUrl: 'https://crowllm.com',
    defaultModel: 'gpt-5.6-sol:free',
  },
];

export interface ModelSettingsView {
  revision: number | null;
}

export interface ApplyResult {
  ok: boolean;
  status: number;
  view: ModelSettingsView | null;
  message: string;
}

function failure(status: number, message: string): ApplyResult {
  return { ok: false, status, view: null, message };
}

export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function fetchModelView(fetchImpl: typeof fetch = fetch): Promise<ModelSettingsView> {
  const response = await fetchImpl('/api/model-config', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Pengaturan model gagal dimuat (${response.status}).`);
  const body = (await response.json()) as ModelSettingsView;
  return { revision: body.revision ?? null };
}

export async function applyChange(
  revision: number | null,
  change: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ApplyResult> {
  const response = await fetchImpl('/api/model-config', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ revision, change }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    revision?: number;
    error?: { code?: string; message?: string };
    errorCode?: string;
  };
  if (!response.ok) {
    return failure(
      response.status,
      data.error?.message ??
        data.error?.code ??
        data.errorCode ??
        `Perubahan ditolak (${response.status}).`,
    );
  }
  return {
    ok: true,
    status: response.status,
    view: { revision: data.revision ?? null },
    message: '',
  };
}

export async function verifySavedModel(
  providerId: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  const response = await fetchImpl('/api/verify-model', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ provider: providerId, model }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    return {
      ok: false,
      message: data.error ?? data.message ?? `Verifikasi gagal (${response.status}).`,
    };
  }
  return { ok: true, message: '' };
}

/** The full wizard sequence: CAS provider → verify → assign llm/agent slots. */
export async function onboardKey(
  provider: OnboardingProvider,
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  const view = await fetchModelView(fetchImpl);
  const saved = await applyChange(
    view.revision,
    { kind: 'provider', id: provider.id, preset: provider.preset, apiKey },
    fetchImpl,
  );
  if (!saved.ok) return { ok: false, message: saved.message };
  const verified = await verifySavedModel(provider.id, model, fetchImpl);
  if (!verified.ok) return { ok: false, message: verified.message };
  const ref = `${provider.id}:${model}`;
  // A slot assignment failure is not fatal: the verified key already opens
  // the gate; the deployment's own slots remain in place otherwise.
  await applyChange(
    saved.view?.revision ?? null,
    { kind: 'slots', set: { llm: ref, agent: ref } },
    fetchImpl,
  );
  return { ok: true, message: '' };
}
