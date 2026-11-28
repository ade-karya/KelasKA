'use client';

/**
 * The admin console: every account, with approve, create, edit, promote,
 * deactivate and delete.
 *
 * Sign-in is Google-only, so the list is where a new account is decided: a
 * first sign-in creates a *pending* row (`active=false`, never signed in) and
 * the admin approves it here, which is also where its role is chosen. The
 * server owns the invariants (no self-demotion, the last admin stays), so this
 * surface just presents them and reports a refusal in the admin's own
 * language. Data comes from `/api/admin/users`; mutations go back to the same
 * route or `/api/admin/users/[id]` and refresh the list from the response.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import {
  CheckCircle2,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
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
import { adminMutationInit } from '@/lib/admin/mutation-request';
import { useI18n } from '@/lib/hooks/use-i18n';
import { authRoleLabelKey, AUTH_ROLES, type AuthRole } from '@/lib/server/auth/config';

import { cn } from '@/lib/utils';
import { ApiKeysPanel, type ApiKeySummary } from './api-keys-panel';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  apiKey?: ApiKeySummary;
}

interface AdminConsoleProps {
  readonly currentUser: { readonly id: string; readonly name: string };
}

const ROLE_BADGE: Record<AuthRole, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  teacher: 'secondary',
  student: 'outline',
};

const ERROR_KEYS: Record<string, string> = {
  EMAIL_TAKEN: 'admin.emailTaken',
  LAST_ADMIN: 'admin.lastAdmin',
  SELF_EDIT_REFUSED: 'admin.selfEdit',
  FORBIDDEN: 'admin.forbidden',
  INVALID_REQUEST: 'admin.invalidRequest',
  INTERNAL_ERROR: 'admin.invalidRequest',
};

interface MutationResult {
  ok: boolean;
  code?: string;
  body?: { user?: AdminUser };
}

async function mutate(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<MutationResult> {
  const response = await fetch(path, adminMutationInit(method, body));
  const data = (await response.json().catch(() => ({}))) as {
    user?: AdminUser;
    errorCode?: string;
    users?: AdminUser[];
  };
  return {
    ok: response.ok,
    code: data.errorCode,
    body: {
      user: data.user,
      ...(data.users ? { users: data.users } : {}),
    } as MutationResult['body'],
  };
}

export function AdminConsole({ currentUser }: AdminConsoleProps) {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [tab, setTab] = useState<'users' | 'keys'>('users');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await mutate('/api/admin/users', 'GET');
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      setUsers((result.body as { users?: AdminUser[] } | undefined)?.users ?? []);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      total: users.length,
      pending: users.filter((user) => !user.active && !user.lastLoginAt).length,
      students: users.filter((user) => user.role === 'student').length,
      teachers: users.filter((user) => user.role === 'teacher').length,
      admins: users.filter((user) => user.role === 'admin').length,
    }),
    [users],
  );

  const approve = useCallback(
    async (user: AdminUser) => {
      try {
        const result = await mutate(`/api/admin/users/${user.id}`, 'PATCH', { active: true });
        if (!result.ok) {
          toast.error(t(ERROR_KEYS[result.code ?? ''] ?? 'admin.invalidRequest'));
          return;
        }
        toast.success(t('admin.approved', { email: user.email }));
        await load();
      } catch {
        toast.error(t('admin.invalidRequest'));
      }
    },
    [load, t],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle),
    );
  }, [users, query]);

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-400">
              {t('admin.consoleLabel')}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
              {t('admin.title')}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('admin.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.location.assign('/workspace')}>
              <LayoutGrid className="h-4 w-4" />
              {t('auth.openWorkspace')}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('admin.addUser')}
            </Button>
          </div>
        </header>

        <div
          className="flex gap-1 overflow-x-auto"
          role="tablist"
          aria-label={t('admin.consoleLabel')}
        >
          {(
            [
              { id: 'users', label: t('admin.userList') },
              { id: 'keys', label: t('admin.apiKeysTab') },
            ] as const
          ).map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                'inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs transition-colors',
                tab === entry.id
                  ? 'bg-primary/10 font-medium text-primary ring-1 ring-inset ring-primary/15'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === 'keys' ? (
          <ApiKeysPanel users={users} loading={loading} onChanged={load} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat
                icon={<Users className="h-4 w-4" />}
                label={t('admin.total')}
                value={counts.total}
              />
              <Stat
                icon={<CheckCircle2 className="h-4 w-4" />}
                label={t('admin.pending')}
                value={counts.pending}
              />
              <Stat label={t('admin.students')} value={counts.students} />
              <Stat label={t('admin.teachers')} value={counts.teachers} />
              <Stat
                icon={<ShieldCheck className="h-4 w-4" />}
                label={t('admin.admins')}
                value={counts.admins}
              />
            </div>

            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>{t('admin.userList')}</CardTitle>
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
                ) : loadFailed ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    <p>{t('admin.loadFailed')}</p>
                    <Button variant="outline" className="mt-3" onClick={() => void load()}>
                      {t('common.retry')}
                    </Button>
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {t('admin.empty')}
                  </p>
                ) : (
                  <div className="-mx-2 overflow-x-auto">
                    <table className="w-full min-w-[680px] border-collapse text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-2 py-2 font-medium">{t('admin.nameColumn')}</th>
                          <th className="px-2 py-2 font-medium">{t('admin.role')}</th>
                          <th className="px-2 py-2 font-medium">{t('admin.status')}</th>
                          <th className="px-2 py-2 font-medium">{t('admin.lastLogin')}</th>
                          <th className="px-2 py-2 text-right font-medium">{t('admin.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((user) => (
                          <tr
                            key={user.id}
                            className="border-t border-gray-100 dark:border-slate-800"
                          >
                            <td className="px-2 py-3">
                              <p className="font-medium text-foreground">
                                {user.name}
                                {user.id === currentUser.id && (
                                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                    ({t('common.you')})
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </td>
                            <td className="px-2 py-3">
                              <Badge variant={ROLE_BADGE[user.role]}>
                                {t(authRoleLabelKey(user.role))}
                              </Badge>
                            </td>
                            <td className="px-2 py-3">
                              {user.active ? (
                                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  {t('admin.active')}
                                </span>
                              ) : user.lastLoginAt ? (
                                <span className="text-xs font-medium text-gray-400">
                                  {t('admin.inactive')}
                                </span>
                              ) : (
                                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                  {t('admin.pending')}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-3 text-xs text-muted-foreground">
                              {user.lastLoginAt
                                ? new Date(user.lastLoginAt).toLocaleString()
                                : t('admin.never')}
                            </td>
                            <td className="px-2 py-3">
                              <div className="flex justify-end gap-1">
                                {!user.active && (
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('admin.approve')}
                                    title={t('admin.approve')}
                                    onClick={() => void approve(user)}
                                  >
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t('admin.edit')}
                                  title={t('admin.edit')}
                                  onClick={() => setEditing(user)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t('admin.delete')}
                                  title={t('admin.delete')}
                                  onClick={() => setDeleting(user)}
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          void load();
        }}
      />
      <EditUserDialog
        user={editing}
        isSelf={editing?.id === currentUser.id}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
      <DeleteUserDialog
        user={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          void load();
        }}
      />
    </main>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function RoleField({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: AuthRole;
  readonly onChange: (role: AuthRole) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as AuthRole)} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AUTH_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {t(authRoleLabelKey(role))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AuthRole>('student');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setRole('student');
    setError(null);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      // The person signs in with this Google address; no password is set or
      // mailed. Creating the row here is the approval.
      const result = await mutate('/api/admin/users', 'POST', { name, email, role });
      if (!result.ok) {
        setError(t(ERROR_KEYS[result.code ?? ''] ?? 'admin.invalidRequest'));
        return;
      }
      toast.success(t('admin.created', { email }));
      onSaved();
    } catch {
      setError(t('admin.invalidRequest'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('admin.createTitle')}</DialogTitle>
          <DialogDescription>{t('admin.createDescription')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="create-name">{t('auth.name')}</Label>
            <Input
              id="create-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-email">{t('auth.email')}</Label>
            <Input
              id="create-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.role')}</Label>
            <RoleField value={role} onChange={setRole} />
          </div>
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
            {t('admin.googleApprovalHint')}
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('admin.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {t('admin.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  readonly user: AdminUser | null;
  readonly isSelf: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [role, setRole] = useState<AuthRole>('student');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setRole(user.role);
    setActive(user.active);
    setError(null);
  }, [user]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await mutate(`/api/admin/users/${user.id}`, 'PATCH', { name, role, active });
      if (!result.ok) {
        setError(t(ERROR_KEYS[result.code ?? ''] ?? 'admin.invalidRequest'));
        return;
      }
      toast.success(t('admin.updated'));
      onSaved();
    } catch {
      setError(t('admin.invalidRequest'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('admin.editTitle')}</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">{t('auth.name')}</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.role')}</Label>
            <RoleField value={role} onChange={setRole} disabled={isSelf} />
            {isSelf && <p className="text-xs text-muted-foreground">{t('admin.selfEditHint')}</p>}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium">{t('admin.active')}</p>
              <p className="text-xs text-muted-foreground">{t('admin.activeHint')}</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} disabled={isSelf} />
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
            <Button type="submit" disabled={busy}>
              {t('admin.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  user,
  onClose,
  onDeleted,
}: {
  readonly user: AdminUser | null;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
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
      const result = await mutate(`/api/admin/users/${user.id}`, 'DELETE');
      if (!result.ok) {
        setError(t(ERROR_KEYS[result.code ?? ''] ?? 'admin.invalidRequest'));
        return;
      }
      toast.success(t('admin.deleted'));
      onDeleted();
    } catch {
      setError(t('admin.invalidRequest'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('admin.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('admin.deleteBody', { name: user?.name ?? '', email: user?.email ?? '' })}
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
            <Trash2 className="h-4 w-4" />
            {t('admin.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
