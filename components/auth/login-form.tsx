'use client';

/**
 * The sign-in screen: one Google button.
 *
 * There is no password form. A sign-in is a navigation to
 * `/api/auth/google/start` (the deep link rides along as `next`), Google
 * returns to the callback, and that route either sets the session and sends
 * the browser to its role's home or returns here with a reason — most often
 * `pending`, because a new Google address waits for an admin's approval.
 */
import { AlertCircle, CheckCircle2, LogIn } from 'lucide-react';

import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';

const ERROR_KEYS: Record<string, string> = {
  google_not_configured: 'auth.errorGoogleNotConfigured',
  google_denied: 'auth.errorGoogleDenied',
  google_state: 'auth.errorGoogleFailed',
  google_failed: 'auth.errorGoogleFailed',
};

export function LoginForm({
  next,
  error,
  googleEnabled,
}: {
  readonly next?: string;
  readonly error?: string;
  readonly googleEnabled: boolean;
}) {
  const { t } = useI18n();
  const pending = error === 'pending';
  const errorKey = error && !pending ? ERROR_KEYS[error] : undefined;
  const startHref = next
    ? `/api/auth/google/start?next=${encodeURIComponent(next)}`
    : '/api/auth/google/start';

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-violet-50 via-white to-sky-50 px-4 py-10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 size-[420px] rounded-full bg-violet-300/30 blur-3xl dark:bg-violet-700/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-24 size-[420px] rounded-full bg-sky-300/30 blur-3xl dark:bg-sky-700/20"
      />

      <section className="relative w-full max-w-md rounded-2xl border border-gray-200/70 bg-white/90 p-7 shadow-xl backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/90">
        <div className="flex justify-center">
          <BrandLogo size="md" />
        </div>

        <h1 className="mt-6 text-center text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
          {t('auth.loginTitle')}
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('auth.loginSubtitle')}
        </p>

        <div className="mt-6 space-y-4">
          {pending && (
            <div
              role="status"
              className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {t('auth.pendingTitle')}
              </p>
              <p className="mt-1">{t('auth.pendingBody')}</p>
            </div>
          )}

          {errorKey && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t(errorKey)}</span>
            </p>
          )}

          {googleEnabled ? (
            <Button asChild className="w-full">
              <a href={startHref}>
                <GoogleMark />
                {t('auth.signInWithGoogle')}
              </a>
            </Button>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {t('auth.errorGoogleNotConfigured')}
            </p>
          )}

          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            {t('auth.accountCreatedByAdmin')}
          </p>
        </div>

        {next && (
          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-gray-400 dark:text-gray-500">
            <LogIn className="h-3.5 w-3.5" />
            {t('auth.redirectedAfterSignIn')}
          </p>
        )}
      </section>
    </main>
  );
}

/** Google's four-colour "G"; inline so the sign-in screen has no extra asset. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-4 w-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
