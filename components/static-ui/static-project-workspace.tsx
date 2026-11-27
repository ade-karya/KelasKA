'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { ProjectWorkspace } from '@/components/sandbox/project-workspace';

import { FullPageLoading, StaticAuthGate } from './static-auth-gate';

function WorkspaceById() {
  const params = useSearchParams();
  const id = params.get('id') ?? params.get('workspaceId');
  if (!id || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-gray-500 dark:text-slate-400">
        Workspace tidak ditemukan.
      </div>
    );
  }
  return (
    <StaticAuthGate loginNext={`/project-workspace?id=${encodeURIComponent(id)}`}>
      {() => <ProjectWorkspace key={id} workspaceId={id} />}
    </StaticAuthGate>
  );
}

/** `/project-workspace` on the static build (`?id=` replaces the dynamic path). */
export function StaticProjectWorkspace() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <WorkspaceById />
    </Suspense>
  );
}
