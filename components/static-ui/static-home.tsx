'use client';

/**
 * `/` on the static (Vercel) build. The server page cannot read the session
 * cookie at build time, so the same role routing the server does happens after
 * hydration: a signed-in account lands on its role home, a signed-out browser
 * goes to `/login`, and the workbench/classic decision is baked at build time.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { ClassicHomePage } from '@/app/classic-home';
import { useAuthSession } from '@/components/auth/auth-session-provider';
import { WorkspaceEntry } from '@/components/workbench/WorkspaceEntry';
import { roleHomePath } from '@/lib/server/auth/config';

import { FullPageLoading } from './static-auth-gate';

export function StaticHome({ workbench }: { readonly workbench: boolean }) {
  const { status, user } = useAuthSession();
  const router = useRouter();
  const home = user ? roleHomePath(user.role, workbench) : '/';

  useEffect(() => {
    if (status === 'signed-out') {
      router.replace('/login');
      return;
    }
    if (status === 'signed-in' && home !== '/') {
      router.replace(home);
    }
  }, [status, home, router]);

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'signed-out') return null;
  if (status === 'signed-in' && home !== '/') return null;
  return workbench ? <WorkspaceEntry /> : <ClassicHomePage />;
}
