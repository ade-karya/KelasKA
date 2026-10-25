'use client';

/**
 * Codex login panel for the Pro Workbench.
 *
 * Two server-side flows are exposed by the existing routes:
 *
 * - `POST /api/agent/auth` stores an OpenAI API key through `codex login`.
 * - `POST /api/agent/auth/device` starts the ChatGPT device-code hand-off.
 *
 * The UI mirrors the Antigravity panel: status first, method cards, then a
 * numbered hand-off for the device flow.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquare,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  AuthMethodCard,
  AuthNotice,
  AuthStatusCard,
  AuthStep,
  CopyButton,
  SecretInput,
} from './agent-auth-ui';

interface CodexAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  message: string;
}

interface DeviceAuthState {
  url: string | null;
  code: string | null;
  status: 'idle' | 'pending' | 'success' | 'failed';
  message: string;
}

const INSTALL_COMMAND = 'npm install @openai/codex';
const API_KEY_URL = 'https://platform.openai.com/api-keys';
const DEVICE_SETTINGS_URL = 'https://chatgpt.com/#settings/Security';

export function CodexAuthPanel({
  onConnectionChange,
}: {
  onConnectionChange?: (connected: boolean) => void;
}) {
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<'key' | 'device'>('key');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [device, setDevice] = useState<DeviceAuthState>({
    url: null,
    code: null,
    status: 'idle',
    message: '',
  });

  const onConnectionChangeRef = useRef(onConnectionChange);
  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/auth', { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as { codex?: CodexAuthStatus };
      if (body.codex) {
        setStatus(body.codex);
        onConnectionChangeRef.current?.(body.codex.loggedIn);
      } else if (!res.ok) {
        toast.error('Gagal membaca status login Codex.');
      }
    } catch {
      toast.error('Gagal membaca status login Codex.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async () => {
    if (!key.trim()) return;
    setActionError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/agent/auth', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: key.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        codex?: CodexAuthStatus;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      if (body.codex) setStatus(body.codex);
      setKey('');
      setShowForm(false);
      toast.success(body.message || 'Codex berhasil terhubung.');
      void refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Login gagal.');
    } finally {
      setSaving(false);
    }
  }, [key, refresh]);

  const logout = useCallback(async () => {
    setActionError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/agent/auth', { method: 'DELETE', credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as {
        codex?: CodexAuthStatus;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      if (body.codex) setStatus(body.codex);
      toast.success(body.message || 'Codex terputus.');
      void refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Logout gagal.');
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const startDevice = useCallback(async () => {
    setActionError(null);
    setSaving(true);
    setDevice({ url: null, code: null, status: 'pending', message: 'Memulai…' });
    try {
      const res = await fetch('/api/agent/auth/device', { method: 'POST', credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string | null;
        code?: string | null;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      setDevice((prev) => {
        // Polling may already have received the URL/code while this request was
        // in flight; keep them, and never undo a login that just finished.
        if (prev.status === 'success') return prev;
        return {
          url: body.url ?? prev.url,
          code: body.code ?? prev.code,
          status: 'pending',
          message: body.message || prev.message || 'Buka tautan dan masukkan kode.',
        };
      });
    } catch (error) {
      setDevice({
        url: null,
        code: null,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Gagal memulai login device.',
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const cancelDevice = useCallback(async () => {
    await fetch('/api/agent/auth/device', { method: 'DELETE', credentials: 'include' }).catch(
      () => {},
    );
    setDevice({ url: null, code: null, status: 'idle', message: '' });
    setActionError(null);
  }, []);

  useEffect(() => {
    if (device.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/agent/auth/device', { credentials: 'include' });
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          message?: string;
          url?: string | null;
          code?: string | null;
        };
        if (body.status === 'success') {
          setDevice({
            url: null,
            code: null,
            status: 'success',
            message: body.message || 'Login berhasil.',
          });
          toast.success('Login ChatGPT berhasil.');
          setShowForm(false);
          void refresh();
        } else if (body.status === 'failed') {
          setDevice({
            url: null,
            code: null,
            status: 'failed',
            message: body.message || 'Login gagal.',
          });
        } else if (body.url || body.code) {
          setDevice((prev) => ({
            ...prev,
            url: body.url ?? prev.url,
            code: body.code ?? prev.code,
          }));
        }
      } catch {
        // ignore transient network errors and keep polling
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [device.status, refresh]);

  const connected = Boolean(status?.installed && status.loggedIn);
  const devicePending = device.status === 'pending';
  const description =
    !status && loading
      ? 'Memeriksa koneksi ke server…'
      : !status
        ? 'Status belum bisa dibaca.'
        : !status.installed
          ? 'Codex CLI belum terpasang di server.'
          : devicePending
            ? 'Menunggu login ChatGPT selesai. Ikuti langkah di bawah.'
            : connected
              ? 'Codex siap dipakai di chat.'
              : 'Belum ada kredensial. Pilih salah satu metode di bawah.';

  const startDeviceFlow = useCallback(() => {
    setMethod('device');
    setActionError(null);
    void startDevice();
  }, [startDevice]);

  return (
    <div className="space-y-4" data-testid="codex-auth-panel">
      <AuthStatusCard
        connected={connected}
        title="Codex"
        description={description}
        loading={loading}
        checking={!status && loading}
        pending={devicePending}
        onRefresh={() => void refresh()}
      />

      {status && !status.installed ? (
        <AuthNotice tone="error" title="Codex CLI belum terpasang">
          <p>Pasang di server, lalu periksa ulang:</p>
          <div className="mt-1.5 flex items-center gap-1 rounded-md border border-destructive/20 bg-background/70 px-2 py-1">
            <code className="min-w-0 flex-1 truncate text-[11px]">{INSTALL_COMMAND}</code>
            <CopyButton value={INSTALL_COMMAND} label="Salin perintah pemasangan" />
          </div>
        </AuthNotice>
      ) : null}

      {connected && !showForm ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void logout()}
            disabled={saving}
          >
            <LogOut className="size-3.5" aria-hidden />
            Putuskan koneksi
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setActionError(null);
              setShowForm(true);
            }}
          >
            Ganti metode
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {connected && showForm ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground"
              onClick={() => {
                setActionError(null);
                setShowForm(false);
              }}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Kembali ke ringkasan
            </Button>
          ) : null}

          {/* Hidden during hand-off so the code panel stays the only thing to
              act on; "Batalkan" is the way out. */}
          {devicePending ? null : (
            <div role="radiogroup" aria-label="Metode koneksi Codex" className="space-y-2">
              <AuthMethodCard
                selected={method === 'key'}
                onSelect={() => {
                  setMethod('key');
                  setActionError(null);
                }}
                icon={KeyRound}
                title="Pakai OpenAI API key"
                description="Tempel kunci dari platform OpenAI. Paling cepat dan stabil."
                badge="Disarankan"
                disabled={status ? !status.installed : false}
              />
              <AuthMethodCard
                selected={method === 'device'}
                onSelect={() => {
                  setMethod('device');
                  setActionError(null);
                }}
                icon={MessageSquare}
                title="Masuk dengan ChatGPT"
                description="Pakai kode sekali pakai. Membutuhkan device-code sign-in yang aktif."
                disabled={status ? !status.installed : false}
              />
            </div>
          )}

          {actionError ? <AuthNotice tone="error">{actionError}</AuthNotice> : null}

          {method === 'key' ? (
            <div className="space-y-3 rounded-xl border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="codex-api-key" className="text-xs">
                  OpenAI API key
                </Label>
                <SecretInput
                  id="codex-api-key"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void login();
                  }}
                  placeholder="sk-…"
                  autoComplete="off"
                  disabled={saving}
                  aria-label="OpenAI API key"
                />
              </div>
              <Button
                type="button"
                onClick={() => void login()}
                disabled={saving || !key.trim()}
                className="w-full"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <KeyRound className="size-4" aria-hidden />
                )}
                Simpan &amp; hubungkan
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Kunci disimpan di server dan tidak pernah dikirim balik ke browser.{' '}
                <a
                  href={API_KEY_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
                >
                  Dapatkan API key
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </p>
            </div>
          ) : device.status === 'pending' ? (
            <div className="rounded-xl border p-3">
              <ol className="m-0 list-none p-0">
                <AuthStep step={1} title="Buka halaman login ChatGPT">
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
                          <span className="truncate">Buka halaman login</span>
                        </a>
                      </Button>
                      <CopyButton value={device.url} label="Salin tautan login" />
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
                  href={DEVICE_SETTINGS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2"
                >
                  Pengaturan keamanan
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void cancelDevice()}
                  disabled={saving}
                >
                  Batalkan
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Kode sekali pakai akan muncul di sini. Pastikan device-code sign-in aktif di
                pengaturan keamanan ChatGPT.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={startDeviceFlow}
                disabled={saving || (status !== null && !status.installed)}
                className="w-full"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Terminal className="size-4" aria-hidden />
                )}
                Mulai login dengan ChatGPT
              </Button>
              {device.status === 'failed' ? (
                <AuthNotice tone="error" title="Login device gagal">
                  {device.message}
                  <p className="mt-1">
                    Aktifkan device-code sign-in di pengaturan keamanan, atau pakai API key.
                  </p>
                </AuthNotice>
              ) : null}
              {device.status === 'success' ? (
                <AuthNotice tone="success">Login berhasil. Menyegarkan status…</AuthNotice>
              ) : null}
            </div>
          )}
        </div>
      )}

      <details className="group rounded-lg border px-3 py-2 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">
          Info teknis
          <ChevronDown
            className="size-3.5 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
          <p>
            API key disimpan lewat <code>codex login --with-api-key</code> di server.
          </p>
          <p>Device code memakai alur login ChatGPT dan memerlukan pengaturan keamanan akun.</p>
          <p>
            CLI: <code>{INSTALL_COMMAND}</code>.
          </p>
          {status?.message ? <p className="break-words opacity-70">{status.message}</p> : null}
        </div>
      </details>
    </div>
  );
}
