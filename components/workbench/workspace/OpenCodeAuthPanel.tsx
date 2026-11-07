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
        toast.error('Gagal membaca status OpenCode Console.');
      }
    } catch {
      toast.error('Gagal membaca status OpenCode Console.');
    } finally {
      setLoading(false);
    }
  }, [onConnectionChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startLogin = useCallback(async () => {
    setActionError(null);
    setSaving(true);
    setDevice({ status: 'pending', url: null, code: null, message: 'Memulai…' });
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
        message: body.login?.message || 'Buka tautan dan ikuti langkah di browser.',
      });
    } catch (error) {
      setDevice({ status: 'idle', url: null, code: null, message: '' });
      setActionError(error instanceof Error ? error.message : 'Gagal memulai login.');
    } finally {
      setSaving(false);
    }
  }, [onConnectionChange]);

  const cancelLogin = useCallback(async () => {
    await fetch('/api/agent/auth/opencode', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    }).catch(() => {});
    setDevice({ status: 'idle', url: null, code: null, message: '' });
    setActionError(null);
  }, []);

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
            message: body.login.message || 'Login berhasil.',
          });
          toast.success('OpenCode Console berhasil terhubung.');
          void refresh();
        } else if (body.login?.status === 'failed') {
          setDevice({
            status: 'failed',
            url: null,
            code: null,
            message: body.login.message || 'Login gagal.',
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
      ? 'Memeriksa koneksi ke server…'
      : !status
        ? 'Status belum bisa dibaca.'
        : !status.installed
          ? 'OpenCode CLI belum terpasang di server.'
          : pending
            ? 'Menunggu login OpenCode Console selesai. Ikuti langkah di bawah.'
            : connected
              ? 'OpenCode Console siap dipakai di chat.'
              : 'Belum ada akun OpenCode Console. Mulai login lewat tombol di bawah.';

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
        <AuthNotice tone="error" title="OpenCode CLI belum terpasang">
          <p>Pasang di server, lalu periksa ulang:</p>
          <div className="mt-1.5 flex items-center gap-1 rounded-md border border-destructive/20 bg-background/70 px-2 py-1">
            <code className="min-w-0 flex-1 truncate text-[11px]">{INSTALL_COMMAND}</code>
            <CopyButton value={INSTALL_COMMAND} label="Salin perintah pemasangan" />
          </div>
        </AuthNotice>
      ) : null}

      {actionError ? <AuthNotice tone="error">{actionError}</AuthNotice> : null}

      {pending ? (
        <div className="rounded-xl border p-3">
          <ol className="m-0 list-none p-0">
            <AuthStep step={1} title="Buka halaman otorisasi OpenCode">
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
                      <span className="truncate">Buka halaman otorisasi</span>
                    </a>
                  </Button>
                  <CopyButton value={device.url} label="Salin tautan otorisasi" />
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Menyiapkan tautan…
                </p>
              )}
            </AuthStep>

            <AuthStep step={2} title="Masukkan kode ini">
              {device.code ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                  <span className="min-w-0 flex-1 text-center font-mono text-lg font-medium tracking-[0.2em]">
                    {device.code}
                  </span>
                  <CopyButton value={device.code} label="Salin kode" />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Menunggu kode…</p>
              )}
            </AuthStep>

            <AuthStep step={3} title="Selesai otomatis" last>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                Kami mendeteksi sendiri saat login berhasil.
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
              Buka OpenCode Console
              <ExternalLink className="size-3" aria-hidden />
            </a>
            <Button type="button" variant="ghost" size="sm" onClick={() => void cancelLogin()}>
              Batalkan
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
          {connected ? 'Kelola akun / login ulang' : 'Masuk dengan OpenCode Console'}
        </Button>
      )}
    </div>
  );
}
