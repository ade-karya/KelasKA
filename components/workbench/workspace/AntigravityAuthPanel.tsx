'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Boxes,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlugZap,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { AuthStatusCard, AuthStep, CopyButton } from './agent-auth-ui';

interface AntigravityStatus {
  bridge: boolean;
  installed: boolean;
  authenticated: boolean;
  message: string;
}

interface LoginState {
  active: boolean;
  url: string | null;
  done: boolean;
  error: string | null;
  output: string;
}

interface DriverModel {
  provider: string;
  id: string;
  modelString: string;
  name: string;
}

export function AntigravityAuthPanel({
  onConnectionChange,
}: {
  onConnectionChange?: (connected: boolean) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AntigravityStatus | null>(null);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [models, setModels] = useState<DriverModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setModelsLoading(true);
    try {
      const [authRes, modelsRes] = await Promise.all([
        fetch('/api/agent/auth', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/agent/models', { credentials: 'include', cache: 'no-store' }),
      ]);
      const authBody = (await authRes.json().catch(() => ({}))) as {
        antigravity?: AntigravityStatus;
      };
      const modelsBody = (await modelsRes.json().catch(() => ({}))) as { models?: DriverModel[] };
      if (authBody.antigravity) {
        setStatus(authBody.antigravity);
        onConnectionChange?.(
          Boolean(authBody.antigravity.installed && authBody.antigravity.authenticated),
        );
      }
      if (Array.isArray(modelsBody.models)) {
        setModels(modelsBody.models.filter((m) => m.provider === 'antigravity'));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setModelsLoading(false);
    }
  }, [onConnectionChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll login status while a login is in progress.
  useEffect(() => {
    if (!login?.active) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/agent/auth/antigravity-cli', { credentials: 'include', cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as {
          login?: LoginState;
          auth?: AntigravityStatus;
        };
        if (body.login) setLogin(body.login);
        if (body.auth) {
          setStatus(body.auth);
          onConnectionChange?.(Boolean(body.auth.installed && body.auth.authenticated));
          if (body.auth.authenticated) {
            toast.success(t('workspace.auth.loginSuccessToast', { provider: 'Antigravity' }));
            setLogin(null);
            void refresh();
          }
        }
        if (body.login?.error) setActionError(body.login.error);
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [login?.active, onConnectionChange, refresh, t]);

  const startLogin = useCallback(async () => {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/agent/auth/antigravity-cli', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        login?: LoginState;
        auth?: AntigravityStatus;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.login) setLogin(body.login);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('workspace.auth.startFailed', { provider: 'Antigravity' }));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const submitCode = useCallback(async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/agent/auth/antigravity-cli', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit', code: code.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        login?: LoginState;
        auth?: AntigravityStatus;
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
      if (body.login) setLogin(body.login);
      if (body.auth) {
        setStatus(body.auth);
        onConnectionChange?.(Boolean(body.auth.installed && body.auth.authenticated));
      }
      setCode('');
      if (body.auth?.authenticated) {
        toast.success(t('workspace.auth.loginSuccessToast', { provider: 'Antigravity' }));
        setLogin(null);
        void refresh();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('workspace.auth.verifyFailed'));
    } finally {
      setBusy(false);
    }
  }, [code, onConnectionChange, refresh, t]);

  const cancelLogin = useCallback(async () => {
    await fetch('/api/agent/auth/antigravity-cli', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    }).catch(() => {});
    setLogin(null);
    setCode('');
    setActionError(null);
  }, []);

  const ready = Boolean(status?.installed && status?.authenticated);
  const loginPending = Boolean(login?.active);
  const description =
    loading && !status
      ? t('workspace.auth.checkingConnection')
      : !status
        ? t('workspace.auth.statusUnreadable')
        : !status.installed
          ? t('workspace.auth.cliMissingTitle', { provider: 'Antigravity' }) + ' (agy).'
          : ready
            ? t('workspace.auth.connectedDesc', { provider: 'Antigravity' })
            : t('workspace.auth.idleDesc', { provider: 'Antigravity' });

  return (
    <div className="space-y-4" data-testid="antigravity-auth-panel">
      <AuthStatusCard
        connected={ready}
        title="Antigravity"
        description={description}
        loading={loading}
        checking={!status && loading}
        pending={loginPending}
        onRefresh={() => void refresh()}
      />

      {status && !status.installed ? (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('workspace.auth.installRecheckBody')}
          </p>
          <div className="flex items-center gap-1 rounded-md border bg-background/70 px-2 py-1">
            <code className="min-w-0 flex-1 truncate text-[11px]">
              curl -fsSL https://antigravity.google/cli/install.sh | bash
            </code>
          </div>
        </div>
      ) : null}

      {status && status.installed && !ready ? (
        loginPending ? (
          <div className="rounded-xl border p-3">
            <ol className="m-0 list-none p-0">
              <AuthStep step={1} title={t('workspace.auth.openAuthPageTitle')}>
                {login?.url ? (
                  <div className="flex items-center gap-1">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="min-w-0 flex-1 justify-start"
                    >
                      <a href={login.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">accounts.google.com</span>
                      </a>
                    </Button>
                    <CopyButton value={login.url} label={t('workspace.auth.copyAuthLink')} />
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {t('workspace.auth.preparingLink')}
                  </p>
                )}
              </AuthStep>

              <AuthStep step={2} title={t('workspace.auth.enterCodeTitle')}>
                {login?.url ? (
                  <div className="flex gap-2">
                    <Input
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void submitCode();
                      }}
                      placeholder={t('workspace.auth.enterCodePlaceholder')}
                      className="font-mono"
                      autoComplete="one-time-code"
                      aria-label={t('workspace.auth.enterCodeAria')}
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      onClick={() => void submitCode()}
                      disabled={busy || !code.trim()}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                      {t('workspace.auth.sendCode')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('workspace.auth.preparingLink')}</p>
                )}
              </AuthStep>

              <AuthStep step={3} title={t('workspace.auth.doneAutoTitle')} last>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                  {t('workspace.auth.detectingAuto')}
                </p>
              </AuthStep>
            </ol>
            <div className="mt-3 flex justify-end border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void cancelLogin()}
                disabled={busy}
              >
                {t('workspace.auth.cancel')}
              </Button>
            </div>
            {actionError ? <p className="mt-2 text-xs text-destructive">{actionError}</p> : null}
            {login?.error ? <p className="mt-2 text-xs text-destructive">{login.error}</p> : null}
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Terminal className="size-4" aria-hidden />
              {t('workspace.auth.signInWith', { provider: 'Antigravity' })}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('workspace.auth.signInBody')}
            </p>
            <Button
              type="button"
              onClick={() => void startLogin()}
              disabled={busy}
              className="w-full"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Terminal className="size-4" aria-hidden />
              )}
              {t('workspace.auth.startLogin')}
            </Button>
            {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
          </div>
        )
      ) : null}

      <Collapsible open={modelsOpen} onOpenChange={setModelsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="flex items-center gap-2">
              <Boxes className="size-4 text-muted-foreground" aria-hidden />
              {t('workspace.auth.availableModels')}
              <Badge variant="secondary" className="font-normal">
                {modelsLoading && models.length === 0 ? '…' : models.length}
              </Badge>
            </span>
            <RefreshCw
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                modelsOpen && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {modelsLoading && models.length === 0 ? (
            <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t('workspace.auth.loadingModels')}
            </p>
          ) : models.length ? (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {models.map((model) => (
                <div
                  key={model.modelString}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5"
                  title={model.modelString}
                >
                  <span className="truncate text-xs font-medium">{model.name || model.id}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              {t('workspace.auth.noModelsYet', { provider: 'Antigravity' })}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
