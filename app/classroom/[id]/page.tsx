/**
 * `/classroom/[id]` — the classroom surface, server-gated.
 *
 * The page used to be a client component reading the id with `useParams`; it
 * is a server component now so the account layer can gate it like `/` and
 * `/workspace`: a signed-in account without a verified API key is sent to the
 * onboarding wizard before any classroom code runs.
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';
import { authEnabled } from '@/lib/server/auth/config';
import { currentPageUser } from '@/lib/server/auth/guards';
import { requireApiKeyPass } from '@/lib/server/auth/api-key-gate';

export const dynamic = 'force-dynamic';

export default async function ClassroomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (authEnabled()) {
    const user = await currentPageUser();
    if (!user) redirect(`/login?next=${encodeURIComponent(`/classroom/${id}`)}`);
    await requireApiKeyPass(user);
  }
  // Suspense covers `useSearchParams` in Header/CommandBar descendants.
  return (
    <Suspense fallback={null}>
      <ClassroomSurface classroomId={id} variant="page" />
    </Suspense>
  );
}
