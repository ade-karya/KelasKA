'use client';

/**
 * Page-level Error Boundary — catches errors in page rendering.
 * Unlike global-error.tsx, this renders within the root layout (styles available).
 */

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[PageError]', error);
  }, [error]);

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="mx-auto size-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-3xl">
          ⚠️
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-foreground">Terjadi Kesalahan</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Halaman ini mengalami error. Silakan coba lagi atau kembali ke halaman utama.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Coba Lagi
          </button>

          <a
            href="/"
            className="px-5 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Halaman Utama
          </a>
        </div>

        {/* Error details (collapsed) */}
        {error.message && (
          <details className="mt-4 text-left">
            <summary className="text-xs text-muted-foreground/50 cursor-pointer hover:text-muted-foreground/70 transition-colors">
              Detail teknis
            </summary>
            <pre className="mt-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground overflow-auto max-h-40 font-mono">
              {error.message}
              {error.digest && `\n\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
