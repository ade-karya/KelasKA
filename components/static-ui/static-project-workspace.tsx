'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { ProjectWorkspace } from '@/components/sandbox/project-workspace';

import { FullPageLoading, StaticAuthGate } from './static-auth-gate';
import { staticRouteId, staticRouteLoginNext } from './static-deep-link';

function WorkspaceById() {
  const params = useSearchParams();
  const routePathname = usePathname();
  // Same Vercel rewrite as the classroom: keep reading the visible path.
  const pathname = typeof window === 'undefined' ? routePathname : window.location.pathname;
  const id = staticRouteId(params, pathname, 'project-workspace', ['id', 'workspaceId']);
  if (!id || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-gray-500 dark:text-slate-400">
        Workspace tidak ditemukan.
      </div>
    );
  }
  return (
    <StaticAuthGate
      loginNext={staticRouteLoginNext(params, 'project-workspace', id, ['id', 'workspaceId'])}
    >
      {() => <ProjectWorkspace key={id} workspaceId={id} />}
    </StaticAuthGate>
  );
}

/** `/project-workspace` on the static build (`?id=` or the rewritten path). */
export function StaticProjectWorkspace() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <WorkspaceById />
    </Suspense>
  );
}
