'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';

interface CodexAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  message: string;
}

interface AntigravityStatus {
  bridge: boolean;
  installed: boolean;
  authenticated: boolean;
  message: string;
}

interface GoogleAuthStatus {
  status: 'idle' | 'pending' | 'success' | 'failed';
  url: string | null;
  message: string;
  project: string | null;
  location: string | null;
  loggedIn: boolean;
}

interface DeviceAuthState {
  url: string | null;
  code: string | null;
  status: 'idle' | 'pending' | 'success' | 'failed';
  message: string;
}

export function WorkbenchAuthDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [antigravity, setAntigravity] = useState<AntigravityStatus | null>(null);
  const [google, setGoogle] = useState<GoogleAuthStatus | null>(null);
  const [googleProject, setGoogleProject] = useState('');
  const [googleLocation, setGoogleLocation] = useState('');
  const [googleCode, setGoogleCode] = useState('');
  const [googleSaving, setGoogleSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [agKey, setAgKey] = useState('');
  const [agSaving, setAgSaving] = useState(false);
  const [device, setDevice] = useState<DeviceAuthState>({
    url: null,
    code: null,
    status: 'idle',
    message: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/auth', { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as {
        codex?: CodexAuthStatus;
        antigravity?: AntigravityStatus;
      };
      if (body.codex) setStatus(body.codex);
      if (body.antigravity) setAntigravity(body.antigravity);
      else if (!res.ok) toast.error('Failed to read auth status');
    } catch {
      toast.error('Failed to read auth status');
    } finally {
      setLoading(false);
    }
    // Google/Vertex status is served by a dedicated route.
    void (async () => {
      try {
        const r = await fetch('/api/agent/auth/google', { credentials: 'include' });
        const b = (await r.json().catch(() => ({}))) as { google?: GoogleAuthStatus };
        if (b.google) {
          setGoogle(b.google);
          if (b.google.project) setGoogleProject(b.google.project);
          if (b.google.location) setGoogleLocation(b.google.location);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const login = useCallback(async () => {
    if (!key.trim()) return;
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
      toast.success(body.message || 'Logged in.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSaving(false);
    }
  }, [key]);

  const logout = useCallback(async () => {
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
      toast.success(body.message || 'Logged out.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Logout failed.');
    } finally {
      setSaving(false);
    }
  }, []);

  const loginAntigravity = useCallback(async () => {
    if (!agKey.trim()) return;
    setAgSaving(true);
    try {
      const res = await fetch('/api/agent/auth', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'antigravity', apiKey: agKey.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        antigravity?: AntigravityStatus;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      if (body.antigravity) setAntigravity(body.antigravity);
      setAgKey('');
      toast.success(body.message || 'Saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setAgSaving(false);
    }
  }, [agKey]);

  const logoutAntigravity = useCallback(async () => {
    setAgSaving(true);
    try {
      const res = await fetch('/api/agent/auth', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'antigravity' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        antigravity?: AntigravityStatus;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      if (body.antigravity) setAntigravity(body.antigravity);
      toast.success(body.message || 'Removed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed.');
    } finally {
      setAgSaving(false);
    }
  }, []);

  const startGoogle = useCallback(async () => {
    setGoogleSaving(true);
    try {
      const res = await fetch('/api/agent/auth/google', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          project: googleProject.trim() || undefined,
          location: googleLocation.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { google?: GoogleAuthStatus; error?: string; message?: string };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      if (body.google) setGoogle(body.google);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start Google login.');
    } finally {
      setGoogleSaving(false);
    }
  }, [googleProject, googleLocation]);

  const submitGoogleCode = useCallback(async () => {
    if (!googleCode.trim()) return;
    setGoogleSaving(true);
    try {
      const res = await fetch('/api/agent/auth/google', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit', code: googleCode.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { google?: GoogleAuthStatus; error?: string; message?: string };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      if (body.google) setGoogle(body.google);
      setGoogleCode('');
      if (body.google?.status === 'success') toast.success('Logged in with Google.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setGoogleSaving(false);
    }
  }, [googleCode]);

  const cancelGoogle = useCallback(async () => {
    await fetch('/api/agent/auth/google', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    }).catch(() => {});
    setGoogle((prev) => (prev ? { ...prev, status: 'idle', url: null, message: '' } : prev));
  }, []);

  const logoutGoogle = useCallback(async () => {
    setGoogleSaving(true);
    try {
      const res = await fetch('/api/agent/auth/google', { method: 'DELETE', credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as { google?: GoogleAuthStatus; message?: string; error?: string };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      if (body.google) setGoogle(body.google);
      toast.success(body.message || 'Removed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed.');
    } finally {
      setGoogleSaving(false);
    }
  }, []);

  useEffect(() => {
    if (google?.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/agent/auth/google', { credentials: 'include' });
        const body = (await res.json().catch(() => ({}))) as { google?: GoogleAuthStatus };
        if (body.google) setGoogle(body.google);
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [google?.status]);

  const startDevice = useCallback(async () => {
    setSaving(true);
    setDevice({ url: null, code: null, status: 'pending', message: 'Starting…' });
    try {
      const res = await fetch('/api/agent/auth/device', { method: 'POST', credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string | null;
        code?: string | null;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      setDevice({
        url: body.url ?? null,
        code: body.code ?? null,
        status: 'pending',
        message: body.message || 'Open the link and enter the code.',
      });
    } catch (err) {
      setDevice({
        url: null,
        code: null,
        status: 'failed',
        message: err instanceof Error ? err.message : 'Failed.',
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
            message: body.message || 'Logged in.',
          });
          void refresh();
          void (async () => {
            const r = await fetch('/api/agent/auth', { credentials: 'include' });
            const b = (await r.json().catch(() => ({}))) as { codex?: CodexAuthStatus };
            if (b.codex) setStatus(b.codex);
          })();
        } else if (body.status === 'failed') {
          setDevice({
            url: null,
            code: null,
            status: 'failed',
            message: body.message || 'Login failed.',
          });
        } else if (body.url || body.code) {
          setDevice((prev) => ({
            ...prev,
            url: body.url ?? prev.url,
            code: body.code ?? prev.code,
          }));
        }
      } catch {
        // ignore transient
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [device.status, refresh]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 shrink-0"
        onClick={() => setOpen(true)}
        title="Agent auth"
        aria-label="Agent auth"
      >
        <KeyRound className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agent authentication</DialogTitle>
            <DialogDescription>
              Log in to the local agents used by the Pro Workbench. Codex keys are stored on the
              server (in the Codex CLI credentials) and never sent to the browser again;
              Antigravity reads GEMINI_API_KEY / GOOGLE_API_KEY from the server environment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">Status</span>
              <span className={status?.loggedIn ? 'text-green-600' : 'text-muted-foreground'}>
                {loading ? 'Checking…' : (status?.message ?? 'Unknown')}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            {!status?.installed ? (
              <p className="text-sm text-muted-foreground">
                Codex CLI is not installed. Install <code>@openai/codex</code> on the server first.
              </p>
            ) : status.loggedIn ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void logout()}
                disabled={saving}
                className="w-full"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </Button>
            ) : (
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="sk-… (OpenAI API key)"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={saving}
                />
                <Button
                  type="button"
                  onClick={() => void login()}
                  disabled={saving || !key.trim()}
                  className="w-full"
                >
                  Log in
                </Button>
                <p className="text-xs text-muted-foreground">
                  Recommended: an OpenAI API key. Device code (below) requires enabling device-code
                  sign-in in your ChatGPT Security Settings.
                </p>
              </div>
            )}
            {status?.installed && !status.loggedIn ? (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Login with ChatGPT (device code)</p>
                {device.status === 'idle' ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void startDevice()}
                      disabled={saving}
                      className="w-full"
                    >
                      Start device login
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Requires device-code sign-in enabled in your ChatGPT Security Settings. If it
                      is disabled, use the API key above instead.
                    </p>
                  </>
                ) : null}
                {device.status === 'pending' ? (
                  <div className="space-y-2">
                    {device.url ? (
                      <a
                        href={device.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-sm text-blue-600 underline break-all"
                      >
                        {device.url}
                      </a>
                    ) : null}
                    {device.code ? (
                      <div className="rounded border bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest">
                        {device.code}
                      </div>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{device.message}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void cancelDevice()}
                      className="w-full"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null}
                {device.status === 'success' ? (
                  <p className="text-sm text-green-600">{device.message}</p>
                ) : null}
                {device.status === 'failed' ? (
                  <div className="space-y-1">
                    <p className="text-sm text-red-600">{device.message}</p>
                    <p className="text-xs text-muted-foreground">
                      If device-code sign-in is disabled for your account, enable it in ChatGPT
                      Security Settings, or use the API key method above.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1 border-t pt-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Antigravity SDK</span>
                <span
                  className={
                    antigravity?.installed && antigravity.authenticated
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }
                >
                  {antigravity
                    ? antigravity.installed && antigravity.authenticated
                      ? 'Ready'
                      : 'Not ready'
                    : 'Unknown'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {loading ? 'Checking…' : (antigravity?.message ?? 'Unknown')}
              </p>
              <p className="text-xs text-muted-foreground">
                Install with <code>pip install google-antigravity</code> (or run{' '}
                <code>./install.sh</code>). Authenticate with a Gemini API key (stored on the
                server) or with Vertex AI credentials in the server environment.
              </p>
              {antigravity?.installed && !antigravity.authenticated ? (
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="AIza… (Gemini API key)"
                    value={agKey}
                    onChange={(e) => setAgKey(e.target.value)}
                    disabled={agSaving}
                  />
                  <Button
                    type="button"
                    onClick={() => void loginAntigravity()}
                    disabled={agSaving || !agKey.trim()}
                    className="w-full"
                  >
                    Save key
                  </Button>
                </div>
              ) : null}
              {antigravity?.installed && antigravity.authenticated ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void logoutAntigravity()}
                  disabled={agSaving}
                  className="w-full"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Remove key
                </Button>
              ) : null}
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Login with Google (Vertex AI)</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="GCP project id"
                    value={googleProject}
                    onChange={(e) => setGoogleProject(e.target.value)}
                    disabled={googleSaving}
                  />
                  <Input
                    placeholder="location (e.g. us-central1)"
                    value={googleLocation}
                    onChange={(e) => setGoogleLocation(e.target.value)}
                    disabled={googleSaving}
                  />
                </div>
                {google?.loggedIn ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void logoutGoogle()}
                    disabled={googleSaving}
                    className="w-full"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out Google
                  </Button>
                ) : google?.status === 'pending' ? (
                  <div className="space-y-2">
                    {google.url ? (
                      <a
                        href={google.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-sm text-blue-600 underline break-all"
                      >
                        {google.url}
                      </a>
                    ) : null}
                    <Input
                      placeholder="Verification code"
                      value={googleCode}
                      onChange={(e) => setGoogleCode(e.target.value)}
                      disabled={googleSaving}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => void submitGoogleCode()}
                        disabled={googleSaving || !googleCode.trim()}
                        className="flex-1"
                      >
                        Submit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void cancelGoogle()}
                        disabled={googleSaving}
                      >
                        Cancel
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{google.message}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      onClick={() => void startGoogle()}
                      disabled={googleSaving || !googleProject.trim() || !googleLocation.trim()}
                      className="w-full"
                    >
                      Login with Google
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {google?.message || 'Requires gcloud installed on the server.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
