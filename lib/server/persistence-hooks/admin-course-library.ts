/**
 * The fork's course library: an admin account sees every live course.
 *
 * `GET /api/stages` asks the registered {@link LibraryProvider} which course
 * ids to list. Without one it lists the caller's own courses; this provider
 * keeps exactly that for every account and widens only the `admin` role to
 * every live course in the deployment, whichever owner wrote it.
 *
 * The widening is a *read* widening on purpose. The listing is the read path
 * (`GET /api/stages/{id}` and the media it references are capability-by-id),
 * while every write — rename, delete, publish, agent edits — still goes
 * through the owner-bound store, which refuses an owner other than the one on
 * the course's `stage_meta` row. The workspace already renders such a course
 * read-only (`stage-meta` reports `isOwner: false`), so an admin opening a
 * teacher's course sees it as a viewer, not as its owner.
 *
 * Deleted courses are excluded: a tombstoned course is `404` on the read path,
 * and the listing drops any id the read path would refuse anyway.
 */
import { MAX_LIBRARY_STAGE_IDS } from '@/lib/persistence/library';
import { OWNER_ROLES, principalHasRole } from '@/lib/server/identity/types';

import { configurePersistenceHooks } from './registry';
import type { LibraryListContext, LibraryProvider } from './types';

/** Short label for the registration, logs and boot errors. */
export const ADMIN_COURSE_LIBRARY_NAME = 'kelaska-admin-course-library';

/**
 * Every live course id, newest first, capped at the listing's own maximum.
 *
 * A provider answer over {@link MAX_LIBRARY_STAGE_IDS} is refused as a host
 * bug (the route would answer 500), so a deployment with more courses than the
 * cap lists the newest ones instead of breaking the admin's home page.
 */
async function allLiveStageIds(context: LibraryListContext): Promise<string[]> {
  const result = await context.queryable.query<{ id: string } & Record<string, unknown>>(
    `SELECT stages.id
       FROM document_stages AS stages
       JOIN stage_meta AS meta ON meta.stage_id = stages.id
      WHERE meta.deleted_at IS NULL
      ORDER BY stages.updated_at DESC
      LIMIT $1`,
    [MAX_LIBRARY_STAGE_IDS],
  );
  return result.rows.map((row) => row.id);
}

export const adminCourseLibraryProvider: LibraryProvider = {
  name: ADMIN_COURSE_LIBRARY_NAME,
  async list(context) {
    const owned = await context.ownedStageIds();
    if (!principalHasRole(context.principal, OWNER_ROLES.admin)) return owned;

    // Own courses first: their `folderId` is the one the caller filed them in,
    // and a shell that groups folders expects its own courses before the rest.
    const seen = new Set(owned);
    const all = await allLiveStageIds(context);
    return [...owned, ...all.filter((id) => !seen.has(id))];
  },
};

/**
 * Register the provider once, at boot, beside the account layer. Accounts off
 * means nothing grants `admin`, so there is nothing to widen: the default
 * owner-only listing stays exactly as it was.
 */
export function registerAdminCourseLibrary(): void {
  configurePersistenceHooks({
    name: ADMIN_COURSE_LIBRARY_NAME,
    library: adminCourseLibraryProvider,
  });
}
