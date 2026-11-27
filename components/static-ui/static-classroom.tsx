'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';

import { FullPageLoading, StaticAuthGate } from './static-auth-gate';

function ClassroomById() {
  const params = useSearchParams();
  const id = params.get('id');
  if (!id) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-gray-500 dark:text-slate-400">
        Kelas tidak ditemukan.
      </div>
    );
  }
  return (
    <StaticAuthGate loginNext={`/classroom?id=${encodeURIComponent(id)}`}>
      {() => <ClassroomSurface classroomId={id} variant="page" />}
    </StaticAuthGate>
  );
}

/**
 * `/classroom` on the static build. The old `/classroom/<id>` links are
 * rewritten by Vercel to `?id=<id>` (see `vercel.json`).
 */
export function StaticClassroom() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <ClassroomById />
    </Suspense>
  );
}
