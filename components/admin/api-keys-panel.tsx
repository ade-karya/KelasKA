'use client';

/**
 * The "API Keys" tab of the admin console: every account's stored keys.
 *
 * Sees what the account itself sees except the secrets (never the key — the
 * server masks it to its last four characters and never sends more). Shows
 * which providers hold a key, whether the stored key is the one a
 * verification succeeded with, and lets the admin
 *
 * - set or replace the key for the account (tested against the provider
 *   before anything is stored),
 * - revoke it (the chat providers are removed, the account is back in
 *   onboarding), and
 * - waive the requirement for the account entirely.
 *
 * Data comes from `GET /api/admin/users` (each user carries an `apiKey`
 * summary); mutations go to `/api/admin/users/[id]/api-key`; the parent
 * reloads the list afterwards, like the account mutations.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ONBOARDING_PROVIDERS, onboardingProvider } from '@/lib/config/api-key-onboarding';
import { PROVIDERS } from '@/lib/ai/providers';
import { useI18n } from '@/lib/hooks/use-i18n';

export type KeyStatus = 'exempt' | 'verified' | 'unverified' | 'none';

export interface AdminKeyView {
  id: string;
  preset: string;
  mask: string;
  isChat: boolean;
  verified: boolean;
  verifiedAt: string | null;
  modelId: string | null;
  unreadable: boolean;
}

export interface ApiKeySummary {
  exempt: boolean;
  status: KeyStatus;
  keys: AdminKeyView[];
}

export interface ApiKeyUser {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  apiKey?: ApiKeySummary;
}

const STATUS_VARIANT: Record<KeyStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  verified: 'default',
  exempt: 'secondary',
  unverified: 'outline',
  none: 'outline',
};

async function mutate(
  path: string,
  method: 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<{ ok: boolean; code?: string; message?: string; status: number }> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as {
    errorCode?: string;
    error?: { code?: string; message?: string } | string;
  };
  const message = typeof data.error === 'string' ? data.error : (data.error?.message ?? undefined);
  return {
    ok: response.ok,
    code: data.errorCode ?? (typeof data.error === 'object' ? data.error?.code : undefined),
    message,
    status: response.status,
  };
}

export function ApiKeysPanel({
  users,
  loading,
  onChanged,
}: {
  readonly users: readonly ApiKeyUser[];
  readonly loading: boolean;
  readonly onChanged: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ApiKeyUser | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle),
    );
  }, [users, query]);

  const toggleExempt = useCallback(
    async (user: ApiKeyUser, exempt: boolean) => {
      setBusyId(user.id);
      try {
        const result = await mutate(`/api/admin/users/${user.id}/api-key`, 'PATCH', { exempt });
        if (!result.ok) {
          toast.error(result.message ?? t('admin.invalidRequest'));
          return;
        }
        toast.success(t(exempt ? 'admin.exemptOn' : 'admin.exemptOff'));
        await onChanged();
      } catch {
        toast.error(t('admin.invalidRequest'));
      } finally {
        setBusyId(null);
      }
    },
    [onChanged, t],
  );

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{t('admin.apiKeysTab')}</CardTitle>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t('admin.apiKeysHint')}</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('admin.search')}
            className="pl-8"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('admin.empty')}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">{t('admin.nameColumn')}</th>
                  <th className="px-2 py-2 font-medium">{t('admin.keyColStatus')}</th>
                  <th className="px-2 py-2 font-medium">{t('admin.keyColKeys')}</th>
                  <th className="px-2 py-2 font-medium">{t('admin.keyColVerified')}</th>
                  <th className="px-2 py-2 font-medium">{t('admin.keyColExempt')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const summary = user.apiKey ?? {
                    exempt: false,
                    status: 'none' as KeyStatus,
                    keys: [],
                  };
                  const latest = summary.keys.reduce<string | null>(
                    (acc, key) =>
                      key.verifiedAt && (!acc || key.verifiedAt > acc) ? key.verifiedAt : acc,
                    null,
                  );
                  return (
                    <tr key={user.id} className="border-t border-gray-100 dark:border-slate-800">
                      <td className="px-2 py-3">
                        <p className="font-medium text-foreground">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </td>
                      <td className="px-2 py-3">
                        <Badge variant={STATUS_VARIANT[summary.status]}>
                          {t(
                            `admin.keyStatus${summary.status.charAt(0).toUpperCase()}${summary.status.slice(1)}`,
                          )}
                        </Badge>
                      </td>
                      <td className="px-2 py-3">
                        {summary.keys.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t('admin.noKeys')}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {summary.keys.map((key) => (
                              <span
                                key={key.id}
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200"
                                title={
                                  key.unreadable
                                    ? t('admin.keyUnreadable')
                                    : (key.modelId ?? key.preset)
                                }
                              >
                                {key.preset}
                                <span className="font-mono text-muted-foreground">{key.mask}</span>
                                {key.unreadable ? (
                                  <XCircle className="h-3 w-3 text-red-500" />
                                ) : key.verified ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-amber-500" />
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-xs text-muted-foreground">
                        {latest ? new Date(latest).toLocaleString() : t('admin.neverVerified')}
                      </td>
                      <td className="px-2 py-3">
                        <Switch
                          checked={summary.exempt}
                          disabled={busyId === user.id}
                          onCheckedChange={(checked) => void toggleExempt(user, checked)}
                          aria-label={t('admin.exemptLabel')}
                        />
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('admin.setKey')}
                            title={t('admin.setKey')}
                            onClick={() => setEditing(user)}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          {summary.keys.some((key) => key.isChat) && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('admin.revokeKey')}
                              title={t('admin.revokeKey')}
                              onClick={() => setRevoking(user)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <SetKeyDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void onChanged();
        }}
      />
      <RevokeKeyDialog
        user={revoking}
        onClose={() => setRevoking(null)}
        onRevoked={() => {
          setRevoking(null);
          void onChanged();
        }}
      />
    </Card>
  );
}

function SetKeyDialog({
  user,
  onClose,
  onSaved,
}: {
  readonly user: ApiKeyUser | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();
  const [preset, setPreset] = useState(ONBOARDING_PROVIDERS[0]!.preset);
  const provider = onboardingProvider(preset)!;
  const models = useMemo(
    () => PROVIDERS[provider.preset as keyof typeof PROVIDERS]?.models ?? [],
    [provider.preset],
  );
  const [model, setModel] = useState(provider.defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setPreset(ONBOARDING_PROVIDERS[0]!.preset);
    setModel(ONBOARDING_PROVIDERS[0]!.defaultModel);
    setApiKey('');
    setError(null);
  }, [user]);

  useEffect(() => {
    setModel(provider.defaultModel);
    setError(null);
  }, [preset, provider.defaultModel]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    const trimmed = apiKey.trim();
    if (trimmed.length < 8) {
      setError(t('onboarding.keyTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await mutate(`/api/admin/users/${user.id}/api-key`, 'PUT', {
        preset,
        apiKey: trimmed,
        model,
      });
      if (!result.ok) {
        setError(result.message ?? t('admin.verifyFailed'));
        return;
      }
      toast.success(t('admin.keySaved'));
      onSaved();
    } catch {
      setError(t('admin.verifyFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('admin.setKeyTitle', { email: user?.email ?? '' })}</DialogTitle>
          <DialogDescription>{t('admin.setKeyBody')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label>{t('admin.keyProviderLabel')}</Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ONBOARDING_PROVIDERS.map((entry) => (
                  <SelectItem key={entry.preset} value={entry.preset}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-key">{t('admin.keyFieldLabel')}</Label>
            <Input
              id="admin-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="font-mono"
              placeholder={t('onboarding.keyPlaceholder')}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.modelFieldLabel')}</Label>
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
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('admin.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !apiKey.trim()}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              {t('admin.saveAndVerify')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyDialog({
  user,
  onClose,
  onRevoked,
}: {
  readonly user: ApiKeyUser | null;
  readonly onClose: () => void;
  readonly onRevoked: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [user]);

  async function confirm() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mutate(`/api/admin/users/${user.id}/api-key`, 'DELETE');
      if (!result.ok) {
        setError(result.message ?? t('admin.invalidRequest'));
        return;
      }
      toast.success(t('admin.revoked'));
      onRevoked();
    } catch {
      setError(t('admin.invalidRequest'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('admin.revokeTitle')}</DialogTitle>
          <DialogDescription>
            {t('admin.revokeBody', { email: user?.email ?? '' })}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('admin.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('admin.revokeConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
