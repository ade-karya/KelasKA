'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';

import { FullPageLoading, StaticAuthGate } from './static-auth-gate';
import { staticRouteId, staticRouteLoginNext } from './static-deep-link';

function ClassroomById() {
  const params = useSearchParams();
  const routePathname = usePathname();
  // The Vercel rewrite keeps the path URL in the address bar. Read the
  // browser's pathname so `/classroom/<id>` links still resolve to an id.
  const pathname = typeof window === 'undefined' ? routePathname : window.location.pathname;
  const id = staticRouteId(params, pathname, 'classroom');
  if (!id) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-gray-500 dark:text-slate-400">
        Kelas tidak ditemukan.
      </div>
    );
  }
  return (
    <StaticAuthGate loginNext={staticRouteLoginNext(params, 'classroom', id)}>
      {() => <ClassroomSurface classroomId={id} variant="page" />}
    </StaticAuthGate>
  );
}

/**
 * `/classroom` on the static build. Vercel rewrites `/classroom/<id>` to
 * `?id=<id>`, but the browser keeps the path form; both are resolved above.
 */
export function StaticClassroom() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <ClassroomById />
    </Suspense>
  );
}
