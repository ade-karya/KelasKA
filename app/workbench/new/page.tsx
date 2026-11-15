/**
 * Backward-compatible bridge for historical `/workbench/new?prompt=&skill=`
 * links and rolling-deployment sessionStorage handoffs. New launches happen
 * directly inside `/workspace`; this route owns no composer or product UI.
 */
import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { isWorkbenchEntryEnabled } from '@/lib/workbench/entry-gate';
import { authEnabled } from '@/lib/server/auth/config';
import { currentPageUser } from '@/lib/server/auth/guards';
import { requireApiKeyPass } from '@/lib/server/auth/api-key-gate';
import { WorkbenchLaunchBridge } from './client';

export const dynamic = 'force-dynamic';

export default async function WorkbenchNewCompatibilityPage() {
  if (!isWorkbenchEntryEnabled()) notFound();
  if (authEnabled()) {
    const user = await currentPageUser();
    if (!user) redirect('/login?next=%2Fworkbench%2Fnew');
    await requireApiKeyPass(user);
  }

  return (
    <Suspense fallback={null}>
      <WorkbenchLaunchBridge />
    </Suspense>
  );
}
