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

export function WorkbenchAuthDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/auth', { credentials: 'include' });
      const body = (await res.json().catch(() => ({}))) as { codex?: CodexAuthStatus };
      if (body.codex) setStatus(body.codex);
      else if (!res.ok) toast.error('Failed to read auth status');
    } catch {
      toast.error('Failed to read auth status');
    } finally {
      setLoading(false);
    }
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

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 shrink-0"
        onClick={() => setOpen(true)}
        title="Codex auth"
        aria-label="Codex auth"
      >
        <KeyRound className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Codex authentication</DialogTitle>
            <DialogDescription>
              Log in to the local Codex agent used by the Pro Workbench. The key is stored on the
              server (in the Codex CLI credentials) and never sent to the browser again.
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
                  Or run <code>codex login</code> on the server for browser/device auth.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
