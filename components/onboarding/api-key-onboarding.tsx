'use client';

/**
 * The bring-your-own-key onboarding wizard.
 *
 * Step 1 picks a provider; step 2 shows exactly how to create a key there
 * (and what it costs), takes the key and a model, and verifies it against
 * the provider. Verification is the gate: until a key answers a real chat
 * call, every page and the app's API answer with a redirect or a 403, so
 * this screen is the only door in. The key is written server-side into the
 * account's sealed workspace configuration; it never comes back to the
 * browser (only its last four characters do, in Settings).
 *
 * Saving and verifying go through the same routes the settings UI uses, in
 * this order: GET the view (need the revision) → PUT the provider → POST the
 * verify probe (records the verification server-side) → PUT the slots that
 * make the account's chat and course generation actually use this key.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
} from 'lucide-react';

import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ONBOARDING_PROVIDERS, type OnboardingProvider } from '@/lib/config/api-key-onboarding';
import { PROVIDERS } from '@/lib/ai/providers';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ModelSettingsView } from '@/lib/model-settings/client';

type Step = 'choose' | 'configure';

interface WizardProps {
  readonly userName: string;
  /** Where to send the browser once the key verifies (already validated server-side). */
  readonly next: string;
}

type ApplyResult =
  | { ok: true }
  | { ok: false; code?: string; message?: string };

async function putModelConfig(body: unknown): Promise<ApplyResult & { view?: ModelSettingsView }> {
  const response = await fetch('/api/model-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as
    | (ModelSettingsView & { error?: { code?: string; message?: string }; errorCode?: string })
    | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    return {
      ok: false,
      code: err?.code ?? (data as { errorCode?: string }).errorCode,
      message: err?.message,
    };
  }
  return { ok: true, view: data as ModelSettingsView };
}

async function verifySavedModel(providerId: string, model: string): Promise<ApplyResult> {
  const response = await fetch('/api/verify-model', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ provider: providerId, model }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    return { ok: false, message: data.error ?? data.message ?? response.statusText };
  }
  return { ok: true };
}

export function ApiKeyOnboarding({ userName, next }: WizardProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('choose');
  const [provider, setProvider] = useState<OnboardingProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [done, setDone] = useState(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const models = useMemo(() => {
    if (!provider) return [];
    return PROVIDERS[provider.preset as keyof typeof PROVIDERS]?.models ?? [];
  }, [provider]);

  const pick = useCallback((entry: OnboardingProvider) => {
    setProvider(entry);
    setApiKey('');
    setModel(entry.defaultModel);
    setError(null);
    setStep('configure');
  }, []);

  const submit = useCallback(async () => {
    if (!provider || busy) return;
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length < 8) {
      setError(t('onboarding.keyTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1. Current revision (the PUT is a compare-and-swap).
      const get = await fetch('/api/model-config', { cache: 'no-store' });
      const view = (await get.json().catch(() => null)) as ModelSettingsView | null;
      if (!get.ok || !view) {
        setError(t('onboarding.errorLoadSettings'));
        return;
      }
      // 2. Save the provider (same call the settings panel makes).
      const saved = await putModelConfig({
        revision: view.revision ?? null,
        change: { kind: 'provider', id: provider.id, preset: provider.preset, apiKey: trimmedKey },
      });
      if (!saved.ok) {
        if (saved.code === 'CONFLICT') setError(t('onboarding.errorConflict'));
        else if (saved.code === 'PROVIDERS_NOT_ALLOWED') {
          setBlocked(true);
          setError(t('onboarding.errorNotAllowed'));
        } else setError(saved.message ?? t('onboarding.errorSave'));
        return;
      }
      // 3. Verify the stored key (records the verification server-side).
      const verified = await verifySavedModel(provider.id, model || provider.defaultModel);
      if (!verified.ok) {
        setError(verified.message ?? t('onboarding.errorVerify'));
        return;
      }
      // 4. Use this key for chat and course generation.
      const ref = `${provider.id}:${model || provider.defaultModel}`;
      const assigned = await putModelConfig({
        revision: saved.view?.revision ?? null,
        change: { kind: 'slots', set: { llm: ref, agent: ref } },
      });
      // Slot assignment failing must not report failure: the key is saved and
      // verified, which is what opens the gate. The slots fall back to
      // whatever the deployment sets.
      if (!assigned.ok) {
        console.warn('[onboarding] the llm/agent slots could not be assigned', assigned);
      }
      setDone(true);
      redirectTimer.current = setTimeout(() => {
        router.push(next);
        router.refresh();
      }, 1600);
    } finally {
      setBusy(false);
    }
  }, [apiKey, busy, model, next, provider, router, t]);

  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }, [router]);

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-violet-50 via-white to-sky-50 px-4 py-10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandLogo size="lg" />
          <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
            {t('onboarding.greeting', { name: userName })}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-400">
            {t('onboarding.badge')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
            {t('onboarding.title')}
          </h1>
          <p className="max-w-lg text-sm text-muted-foreground">
            {t('onboarding.subtitle', { name: userName })}
          </p>
        </div>

        {done ? (
          <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30">
            <CardHeader className="items-center text-center">
              <CheckCircle2 className="mb-1 h-10 w-10 text-emerald-600 dark:text-emerald-400" />
              <CardTitle>{t('onboarding.verifiedOk')}</CardTitle>
              <CardDescription>{t('onboarding.verifiedBody')}</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={() => { router.push(next); router.refresh(); }}>{t('onboarding.continue')}</Button>
            </CardContent>
          </Card>
        ) : step === 'choose' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {ONBOARDING_PROVIDERS.map((entry) => (
                <button
                  key={entry.preset}
                  type="button"
                  onClick={() => pick(entry)}
                  className="group flex items-start gap-3 rounded-2xl border border-gray-200 bg-white/80 p-4 text-left shadow-sm transition hover:border-violet-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-violet-800"
                >
                  <img
                    src={entry.logo}
                    alt=""
                    className="mt-0.5 h-9 w-9 shrink-0 object-contain"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 group-hover:text-violet-700 dark:text-gray-100 dark:group-hover:text-violet-300">
                      {entry.name}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                      {t(`onboarding.quota.${entry.preset}`)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-center text-[12px] text-muted-foreground">{t('onboarding.freeFirst')}</p>
          </div>
        ) : provider ? (
          <Card>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <Button variant="ghost" size="icon-sm" onClick={() => setStep('choose')} aria-label={t('onboarding.back')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <img src={provider.logo} alt="" className="h-8 w-8 object-contain" />
              <div className="min-w-0">
                <CardTitle className="text-base">
                  {provider.name}
                </CardTitle>
                <CardDescription>{t(`onboarding.quota.${provider.preset}`)}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Steps to create the key */}
              <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-[13px] leading-relaxed text-violet-950 dark:border-violet-950/60 dark:bg-violet-950/20 dark:text-violet-100">
                <p className="mb-1.5 font-semibold">{t('onboarding.stepsTitle')}</p>
                <p className="whitespace-pre-line">{t(`onboarding.steps.${provider.preset}`)}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <a
                    href={provider.signupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-violet-700 dark:hover:text-violet-300"
                  >
                    {t('onboarding.getKey')} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-violet-700 dark:hover:text-violet-300"
                  >
                    {t('onboarding.docs')} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              {/* Key + model */}
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-key">{t('onboarding.keyLabel')}</Label>
                <Input
                  id="onboarding-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('onboarding.keyPlaceholder')}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submit();
                  }}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">{t('onboarding.securityNote')}</p>
              </div>

              <div className="space-y-1.5">
                <Label>{t('onboarding.modelLabel')}</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{t('onboarding.modelHint')}</p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                >
                  {error}
                </div>
              )}
              {blocked && (
                <p className="text-[12px] text-muted-foreground">{t('onboarding.adminNote')}</p>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={() => void submit()}
                disabled={busy || !apiKey.trim()}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('onboarding.verifying')}
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {t('onboarding.verify')}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-4 flex items-center justify-center gap-4 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('onboarding.adminNote')}
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t('onboarding.signOut')}
          </button>
        </div>
      </div>
    </main>
  );
}
