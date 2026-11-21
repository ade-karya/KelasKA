'use client';

import { useEffect, useState } from 'react';
import { Loader2, ServerOff } from 'lucide-react';

import { useI18n } from '@/lib/hooks/use-i18n';

/**
 * A quiet status strip for the split deployment. It only appears when the
 * Cloudflare Worker is actually in front of the app (`/__kelaska/status` is
 * its own endpoint) and it says something is waking up or down. On a plain
 * Vercel/Colab deployment the endpoint is a 404 and this renders nothing.
 */
interface EdgeStatus {
  colab?: { status?: string };
  gpu?: { status?: string };
  kaggle?: { status?: string } | null;
  queue?: number;
}

const REFRESH_MS = 30_000;

export function BackendStatusBanner() {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch('/__kelaska/status', { cache: 'no-store' });
        if (!response.ok) {
          if (!cancelled) setMessage(null);
          return;
        }
        const status = (await response.json()) as EdgeStatus;
        if (cancelled) return;
        const queue = typeof status.queue === 'number' ? status.queue : 0;
        if (status.colab?.status === 'offline' || status.colab?.status === 'unknown') {
          setMessage(t('backendStatus.offline'));
        } else if (queue > 0) {
          setMessage(t('backendStatus.queued', { count: queue }));
        } else if (status.kaggle?.status === 'starting') {
          setMessage(t('backendStatus.gpuStarting'));
        } else {
          setMessage(null);
        }
      } catch {
        // The Worker is optional; a failed probe must never disturb the UI.
        if (!cancelled) setMessage(null);
      }
    };

    void check();
    const timer = setInterval(check, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [t]);

  if (!message) return null;

  const gpu = message === t('backendStatus.gpuStarting');
  return (
    <div
      role="status"
      data-testid="backend-status-banner"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-xs text-foreground shadow-lg backdrop-blur"
    >
      {gpu ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <ServerOff className="size-3.5 shrink-0 text-primary" />
      )}
      <span className="whitespace-nowrap">{message}</span>
    </div>
  );
}
