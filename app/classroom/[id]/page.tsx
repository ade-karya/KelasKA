'use client';

import { Suspense } from 'react';
import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';
import { useParams } from 'next/navigation';

export default function ClassroomDetailPage() {
  const params = useParams<{ id: string }>();

  // Suspense covers `useSearchParams` in Header/CommandBar descendants
  // (see app/workspace/page.tsx, app/workbench/new/page.tsx pattern).
  return (
    <Suspense fallback={null}>
      <ClassroomSurface classroomId={params.id} variant="page" />
    </Suspense>
  );
}
