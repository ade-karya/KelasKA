'use client';

/**
 * OpenCode Console login panel for the Pro Workbench.
 *
 * Uses the CLI's own device-code flow: `opencode auth login opencode
 * --method device` prints an authorization URL and a one-time code, then
 * blocks until the user signs in at opencode.ai. The CLI owns the stored
 * credential; the app never sees a token, only the URL/code to hand to the
 * browser and the "saved account" signal from `opencode auth list`.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Loader2, SquareTerminal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { AuthNotice, AuthStatusCard, AuthStep, CopyButton } from './agent-auth-ui';

interface OpencodeAuthStatus {
  installed: boolean;
  authenticated: boolean;
  message: string;
}

interface DeviceLoginState {
  status: 'idle' | 'pending' | 'success' | 'failed';
  url: string | null;
  code: string | null;
  message: string;
}

const INSTALL_COMMAND = 'curl -fsSL https://opencode.ai/v2/install | bash';
const CONSOLE_URL = 'https://opencode.ai/console';

export function OpenCodeAuthPanel({
  onConnectionChange,
}: {
  onConnectionChange?: (connected: boolean) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<OpencodeAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceLoginState>({
    status: 'idle',
    url: null,
    code: null,
    message: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/auth/opencode', { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as { auth?: OpencodeAuthStatus };
      if (body.auth) {
        setStatus(body.auth);
        onConnectionChange?.(Boolean(body.auth.installed && body.auth.authenticated));
      } else if (!res.ok) {
        toast.error(t('workspace.auth.statusReadFailed', { provider: 'OpenCode Console' }));
      }
    } catch {
      toast.error(t('workspace.auth.statusReadFailed', { provider: 'OpenCode Console' }));
    } finally {
      setLoading(false);
    }
  }, [onConnectionChange, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startLogin = useCallback(async () => {
    setActionError(null);
    setSaving(true);
    setDevice({ status: 'pending', url: null, code: null, message: t('workspace.auth.preparingLink') });
    try {
      const res = await fetch('/api/agent/auth/opencode', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        login?: {
          ok?: boolean;
          url?: string | null;
          code?: string | null;
          message?: string;
        };
        auth?: OpencodeAuthStatus;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || body.login?.message || `HTTP ${res.status}`);
      if (body.auth) {
        setStatus(body.auth);
        onConnectionChange?.(Boolean(body.auth.installed && body.auth.authenticated));
      }
      setDevice({
        status: 'pending',
        url: body.login?.url ?? null,
        code: body.login?.code ?? null,
        message: body.login?.message || t('workspace.auth.openAuthPageTitle'),
      });
    } catch (error) {
      setDevice({ status: 'idle', url: null, code: null, message: '' });
      setActionError(error instanceof Error ? error.message : t('workspace.auth.startFailed', { provider: 'OpenCode Console' }));
    } finally {
      setSaving(false);
    }
  }, [onConnectionChange, t]);

  const cancelLogin = useCallback(async () => {
    await fetch('/api/agent/auth/opencode', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    }).catch(() => {});
    setDevice({ status: 'idle', url: null, code: null, message: '' });
    setActionError(null);
  }, [t]);

  useEffect(() => {
    if (device.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/agent/auth/opencode', { credentials: 'include' });
        const body = (await res.json().catch(() => ({}))) as {
          login?: {
            status?: string;
            message?: string;
            url?: string | null;
            code?: string | null;
          };
          auth?: OpencodeAuthStatus;
        };
        if (body.auth) {
          setStatus(body.auth);
          onConnectionChange?.(Boolean(body.auth.installed && body.auth.authenticated));
        }
        if (body.login?.status === 'success') {
          setDevice({
            status: 'success',
            url: null,
            code: null,
            message: body.login.message || t('workspace.auth.loginSuccessToast', { provider: 'OpenCode Console' }),
          });
          toast.success(t('workspace.auth.loginSuccessToast', { provider: 'OpenCode Console' }));
          void refresh();
        } else if (body.login?.status === 'failed') {
          setDevice({
            status: 'failed',
            url: null,
            code: null,
            message: body.login.message || t('workspace.auth.verifyFailed'),
          });
        } else if (body.login?.url || body.login?.code) {
          setDevice((prev) => ({
            ...prev,
            url: body.login?.url ?? prev.url,
            code: body.login?.code ?? prev.code,
          }));
        }
      } catch {
        // Transient network error — keep polling.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [device.status, onConnectionChange, refresh]);

  const connected = Boolean(status?.installed && status.authenticated);
  const pending = device.status === 'pending';
  const description =
    loading && !status
      ? t('workspace.auth.checkingConnection')
      : !status
        ? t('workspace.auth.statusUnreadable')
        : !status.installed
          ? t('workspace.auth.cliMissingTitle', { provider: 'OpenCode' }) + '.'
          : pending
            ? t('workspace.auth.pendingDesc', { provider: 'OpenCode Console' })
            : connected
              ? t('workspace.auth.connectedDesc', { provider: 'OpenCode Console' })
              : t('workspace.auth.idleDesc', { provider: 'OpenCode Console' });

  return (
    <div className="space-y-4" data-testid="opencode-auth-panel">
      <AuthStatusCard
        connected={connected}
        title="OpenCode Console"
        description={description}
        loading={loading}
        checking={!status && loading}
        pending={pending}
        onRefresh={() => void refresh()}
      />

      {status && !status.installed ? (
        <AuthNotice tone="error" title={t('workspace.auth.cliMissingTitle', { provider: 'OpenCode' })}>
          <p>{t('workspace.auth.installRecheckBody')}</p>
          <div className="mt-1.5 flex items-center gap-1 rounded-md border border-destructive/20 bg-background/70 px-2 py-1">
            <code className="min-w-0 flex-1 truncate text-[11px]">{INSTALL_COMMAND}</code>
            <CopyButton value={INSTALL_COMMAND} label={t('workspace.auth.copyInstallCommand')} />
          </div>
        </AuthNotice>
      ) : null}

      {actionError ? <AuthNotice tone="error">{actionError}</AuthNotice> : null}

      {pending ? (
        <div className="rounded-xl border p-3">
          <ol className="m-0 list-none p-0">
            <AuthStep step={1} title={t('workspace.auth.openAuthPageTitle')}>
              {device.url ? (
                <div className="flex items-center gap-1">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="min-w-0 flex-1 justify-start"
                  >
                    <a href={device.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{t('workspace.auth.openAuthPageButton')}</span>
                    </a>
                  </Button>
                  <CopyButton value={device.url} label={t('workspace.auth.copyAuthLink')} />
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {t('workspace.auth.preparingLink')}
                </p>
              )}
            </AuthStep>

            <AuthStep step={2} title={t('workspace.auth.enterCodeTitle')}>
              {device.code ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                  <span className="min-w-0 flex-1 text-center font-mono text-lg font-medium tracking-[0.2em]">
                    {device.code}
                  </span>
                  <CopyButton value={device.code} label={t('workspace.auth.copyCode')} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('workspace.auth.waitingCode')}</p>
              )}
            </AuthStep>

            <AuthStep step={3} title={t('workspace.auth.doneAutoTitle')} last>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                {t('workspace.auth.detectingAuto')}
              </p>
            </AuthStep>
          </ol>
          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
            <a
              href={CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2"
            >
              {t('workspace.auth.consoleLink', { console: 'OpenCode Console' })}
              <ExternalLink className="size-3" aria-hidden />
            </a>
            <Button type="button" variant="ghost" size="sm" onClick={() => void cancelLogin()}>
              {t('workspace.auth.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          className="w-full"
          onClick={() => void startLogin()}
          disabled={saving || (status ? !status.installed : false)}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <SquareTerminal className="size-4" aria-hidden />
          )}
          {connected
            ? t('workspace.auth.manageButton')
            : t('workspace.auth.loginButton', { provider: 'OpenCode Console' })}
        </Button>
      )}
    </div>
  );
}
