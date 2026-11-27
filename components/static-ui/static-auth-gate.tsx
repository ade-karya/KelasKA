'use client';

/**
 * Client-side replacement for the server page guards on the static (Vercel)
 * build. The API behind the gateway still enforces every rule; this only picks
 * the right surface for the browser and sends signed-out visitors to `/login`.
 */
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import {
  useAuthSession,
  type AuthSessionUser,
} from '@/components/auth/auth-session-provider';
import type { AuthRole } from '@/lib/server/auth/config';

export function FullPageLoading({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-sm text-gray-500 dark:bg-slate-950 dark:text-slate-400">
      <span className="animate-pulse">{label}</span>
    </div>
  );
}

export function StaticAuthGate({
  loginNext,
  roles,
  whenDisabled = 'redirect-home',
  children,
}: {
  readonly loginNext: string;
  readonly roles?: readonly AuthRole[];
  /** What a deployment without accounts does with this route. */
  readonly whenDisabled?: 'render' | 'redirect-home';
  readonly children: (user: AuthSessionUser | null) => ReactNode;
}) {
  const { status, user } = useAuthSession();
  const router = useRouter();
  const roleDenied = Boolean(roles && user && !roles.includes(user.role));

  useEffect(() => {
    if (status === 'signed-out') {
      router.replace(`/login?next=${encodeURIComponent(loginNext)}`);
      return;
    }
    if (status === 'disabled' && whenDisabled === 'redirect-home') {
      router.replace('/');
      return;
    }
    if (status === 'signed-in' && roleDenied) {
      router.replace('/');
    }
  }, [status, roleDenied, router, loginNext, whenDisabled]);

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'signed-out') return null;
  if (status === 'disabled') {
    return whenDisabled === 'render' ? <>{children(null)}</> : null;
  }
  if (roleDenied) return null;
  return <>{children(user)}</>;
}
