'use client';

/**
 * The classic home's account button.
 *
 * A student's home has no rail and no workspace account block, so this small
 * pill in the corner carries the same essentials: who is signed in, the way to
 * the account page, the workspace or the admin console when the role has one,
 * and sign out. It renders nothing when accounts are off, which keeps an
 * upstream deployment's home exactly as it was.
 */
import { KeyRound, LayoutGrid, LogIn, LogOut, Users } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/hooks/use-i18n';
import { authRoleLabelKey } from '@/lib/server/auth/config';

import { useAuthSession } from './auth-session-provider';

const BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-gray-500 transition-all ' +
  'hover:bg-white hover:text-gray-800 hover:shadow-sm dark:text-gray-400 dark:hover:bg-gray-700 ' +
  'dark:hover:text-gray-100';

export function AccountControl() {
  const { status, user, signOut } = useAuthSession();
  const { t } = useI18n();

  if (status === 'disabled' || status === 'loading') return null;

  if (!user) {
    return (
      <button
        type="button"
        className={BUTTON}
        onClick={() => window.location.assign('/login')}
        aria-label={t('auth.signIn')}
      >
        <LogIn className="h-4 w-4" />
        <span className="hidden sm:inline">{t('auth.signIn')}</span>
      </button>
    );
  }

  const initial = user.name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={BUTTON}
          aria-label={t('auth.myAccount')}
          title={`${user.name} — ${t(authRoleLabelKey(user.role))}`}
        >
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-violet-600 text-[11px] font-semibold text-white">
            {initial}
          </span>
          <span className="hidden max-w-24 truncate sm:inline">{user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            {t(authRoleLabelKey(user.role))}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.location.assign('/account')}>
          <KeyRound className="h-4 w-4" />
          {t('auth.myAccount')}
        </DropdownMenuItem>
        {user.role !== 'student' && (
          <DropdownMenuItem onSelect={() => window.location.assign('/workspace')}>
            <LayoutGrid className="h-4 w-4" />
            {t('auth.openWorkspace')}
          </DropdownMenuItem>
        )}
        {user.role === 'admin' && (
          <DropdownMenuItem onSelect={() => window.location.assign('/admin')}>
            <Users className="h-4 w-4" />
            {t('auth.adminConsole')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
