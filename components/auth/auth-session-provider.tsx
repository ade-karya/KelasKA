'use client';

/**
 * The signed-in account, available to every surface.
 *
 * It answers `/api/auth/me` once, exposes the result through context, and
 * feeds the workspace shell's host extension slots: the account block shows the
 * account's name and role, the menu gains "Akun saya" (and "Kelola pengguna"
 * for an admin), and signing out is wired to the real logout route. The classic
 * home reads the same context for its corner account button.
 *
 * On a deployment without accounts the provider is transparent: the status is
 * `disabled`, no shell extension is provided, and the workspace keeps showing
 * the local learner profile it always had.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { LayoutGrid, KeyRound, ShieldCheck, Users } from 'lucide-react';

import { useI18n } from '@/lib/hooks/use-i18n';
import {
  WorkbenchShellExtensionsProvider,
  type WorkbenchShellExtensions,
} from '@/lib/workbench/shell-extensions';
import { authRoleLabelKey, type AuthRole } from '@/lib/server/auth/config';

export interface AuthSessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AuthRole;
  readonly active: boolean;
}

export type AuthSessionStatus = 'loading' | 'disabled' | 'signed-out' | 'signed-in';

export interface AuthSessionContextValue {
  readonly status: AuthSessionStatus;
  readonly user: AuthSessionUser | null;
  /** Re-read `/api/auth/me` (after a name change, or a sign-in in another tab). */
  readonly refresh: () => Promise<void>;
  /** End this browser's session and land on the login page. */
  readonly signOut: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionContextValue>({
  status: 'loading',
  user: null,
  refresh: async () => {},
  signOut: async () => {},
});

export function useAuthSession(): AuthSessionContextValue {
  return useContext(AuthSessionContext);
}

interface MeResponse {
  enabled?: boolean;
  user?: AuthSessionUser | null;
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AuthSessionStatus>('loading');
  const [user, setUser] = useState<AuthSessionUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      const body = (await response.json()) as MeResponse;
      if (!body.enabled) {
        setStatus('disabled');
        setUser(null);
        return;
      }
      setUser(body.user ?? null);
      setStatus(body.user ? 'signed-in' : 'signed-out');
    } catch {
      // An unreachable probe must not strand the UI on `loading`: the sign-out
      // state is the safe assumption (the API itself still enforces the gate).
      setStatus('signed-out');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } finally {
      setUser(null);
      setStatus('signed-out');
      window.location.assign('/login');
    }
  }, []);

  const extensions = useMemo<WorkbenchShellExtensions>(() => {
    if (status === 'disabled') return {};
    if (status === 'signed-in' && user) {
      return {
        identity: {
          signedIn: true,
          name: user.name,
          detail: `${user.email} · ${t(authRoleLabelKey(user.role))}`,
          onSignOut: signOut,
        },
        accountMenuItems: [
          {
            id: 'account',
            label: t('auth.myAccount'),
            icon: KeyRound,
            href: '/account',
          },
          ...(user.role === 'admin'
            ? [
                {
                  id: 'admin-users',
                  label: t('auth.adminConsole'),
                  icon: Users,
                  href: '/admin',
                },
              ]
            : []),
          ...(user.role === 'student'
            ? []
            : [
                {
                  id: 'workspace',
                  label: t('auth.openWorkspace'),
                  icon: LayoutGrid,
                  href: '/workspace',
                },
              ]),
        ],
      };
    }
    return {
      identity: {
        signedIn: false,
        detail: t('auth.signInHint'),
        signIn: {
          label: t('auth.signIn'),
          hint: t('auth.signInHint'),
          onSelect: () => window.location.assign('/login'),
        },
      },
      accountMenuItems: [],
    };
  }, [status, user, t, signOut]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({ status, user, refresh, signOut }),
    [status, user, refresh, signOut],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      <WorkbenchShellExtensionsProvider value={extensions}>
        {children}
      </WorkbenchShellExtensionsProvider>
    </AuthSessionContext.Provider>
  );
}

/** A small glyph for the account's role, for the admin console header. */
export function roleGlyph(role: AuthRole) {
  return role === 'admin' ? ShieldCheck : role === 'teacher' ? Users : KeyRound;
}
