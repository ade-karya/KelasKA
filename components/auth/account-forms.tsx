'use client';

/**
 * The signed-in account's own page: display name, identity and sign out.
 *
 * The address and role are administrative: the address is the Google account
 * an admin approved, and the role is set in `/admin`. Password changes belong
 * to Google, which is also why there is no password field here.
 */
import { useState, type FormEvent } from 'react';
import Link from 'next/link';

import { ArrowLeft, KeyRound, LogOut, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';
import { authRoleLabelKey, type AuthRole } from '@/lib/server/auth/config';

import { useAuthSession } from './auth-session-provider';

export function AccountForms({
  name: initialName,
  email,
  role,
  homePath,
}: {
  readonly name: string;
  readonly email: string;
  readonly role: AuthRole;
  readonly homePath: string;
}) {
  const { t } = useI18n();
  const { refresh, signOut } = useAuthSession();

  const [name, setName] = useState(initialName);
  const [savingName, setSavingName] = useState(false);

  async function onSaveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingName) return;
    setSavingName(true);
    try {
      const response = await fetch('/api/auth/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        toast.error(t('auth.loginFailed'));
        return;
      }
      toast.success(t('auth.nameSaved'));
      await refresh();
    } catch {
      toast.error(t('auth.loginFailed'));
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={homePath}>
          <ArrowLeft className="h-4 w-4" />
          {t('auth.backHome')}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            {t('auth.accountTitle')}
          </CardTitle>
          <CardDescription>{t('auth.accountSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{email}</span>
            <Badge variant="secondary">{t(authRoleLabelKey(role))}</Badge>
          </div>

          <form className="space-y-3" onSubmit={onSaveName}>
            <div className="space-y-1.5">
              <Label htmlFor="account-name">{t('auth.name')}</Label>
              <Input
                id="account-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="outline" disabled={savingName}>
              <Save className="h-4 w-4" />
              {t('auth.save')}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">{t('auth.googleAccountHint')}</p>
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" />
        {t('auth.signOut')}
      </Button>
    </div>
  );
}
