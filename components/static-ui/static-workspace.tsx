'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { WorkspaceShell } from '@/components/workbench/workspace/WorkspaceShell';

import { StaticAuthGate } from './static-auth-gate';

/** `/workspace` on the static build: teachers and admins only. */
export function StaticWorkspace({ workbench }: { readonly workbench: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!workbench) router.replace('/');
  }, [workbench, router]);

  if (!workbench) return null;
  return (
    <StaticAuthGate loginNext="/workspace" roles={['teacher', 'admin']} whenDisabled="render">
      {() => <WorkspaceShell />}
    </StaticAuthGate>
  );
}
