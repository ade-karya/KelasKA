'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { WorkbenchLaunchBridge } from '@/app/workbench/new/client';

import { FullPageLoading, StaticAuthGate } from './static-auth-gate';

function Bridge() {
  return (
    <StaticAuthGate loginNext="/workbench/new" roles={['teacher', 'admin']}>
      {() => <WorkbenchLaunchBridge />}
    </StaticAuthGate>
  );
}

/** `/workbench/new` on the static build; disabled when the workbench is off. */
export function StaticWorkbenchNew({ workbench }: { readonly workbench: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!workbench) router.replace('/');
  }, [workbench, router]);

  if (!workbench) return null;
  return (
    <Suspense fallback={<FullPageLoading />}>
      <Bridge />
    </Suspense>
  );
}
