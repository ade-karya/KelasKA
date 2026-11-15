/**
 * `/` — the home page.
 *
 * With the workbench entry on, the home page is the workspace itself: the same
 * shell `/workspace` renders, entered with the sidebar folded (see
 * `defaultNavCollapsed`). With it off — the default — the classic home stays
 * exactly as it was, every option on it included.
 *
 * The decision is the server-side gate `/workspace` already uses, so the two
 * routes cannot disagree: a disabled `/workspace` redirects here and lands on
 * the classic home rather than looping. The gate is read per request because
 * the root layout reads the request's cookies and headers, which already makes
 * every page dynamic. That is also what lets the shell go without a Suspense
 * boundary here; `/workspace` explains why an empty-fallback boundary around
 * the whole shell blanked the page.
 *
 * The workspace keeps its own URLs: once something is open the shell mirrors
 * it to `/workspace?…`, so existing deep links and their query keep working.
 */
import { redirect } from 'next/navigation';
import { isWorkbenchEntryEnabled } from '@/lib/workbench/entry-gate';
import { authEnabled } from '@/lib/server/auth/config';
import { currentPageUser, homeForRole } from '@/lib/server/auth/guards';
import { WorkspaceEntry } from '@/components/workbench/WorkspaceEntry';
import { ClassicHomePage } from './classic-home';

export default async function Page() {
  // With accounts on, `/` is the student home. A teacher is sent to the
  // workspace and an admin to the user console; when the workbench is not part
  // of this build, `homeForRole` answers `/` for both, and the classic home is
  // all there is to show.
  if (authEnabled()) {
    const user = await currentPageUser();
    if (!user) redirect('/login');
    const home = homeForRole(user.role);
    if (home !== '/') redirect(home);
    return <ClassicHomePage />;
  }

  if (!isWorkbenchEntryEnabled()) return <ClassicHomePage />;

  return <WorkspaceEntry />;
}
