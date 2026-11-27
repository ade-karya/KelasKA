'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';
import { useAuthSession } from '@/components/auth/auth-session-provider';
import { roleHomePath, supabaseBrowserConfigured } from '@/lib/server/auth/config';

import { FullPageLoading } from './static-auth-gate';

/**
 * `/login` on the static build. The query string carries the deep link and the
 * refusal reason exactly as the server page used to receive them.
 */
export function StaticLogin({ workbench }: { readonly workbench: boolean }) {
  const { status, user } = useAuthSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? undefined;
  const error = params.get('error') ?? undefined;
  const home = user ? roleHomePath(user.role, workbench) : '/';

  useEffect(() => {
    if (status === 'signed-in' && user) router.replace(home);
  }, [status, user, home, router]);

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'signed-in' && user) return null;
  return <LoginForm next={next} error={error} supabaseEnabled={supabaseBrowserConfigured()} />;
}
