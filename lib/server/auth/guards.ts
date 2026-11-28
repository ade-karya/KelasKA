/**
 * Page and route guards for the account layer.
 *
 * Pages call these from their server component so a wrong role never renders
 * a page it should not: the middleware already refuses a signed-out request,
 * but only the database knows the role, and the role may have changed since
 * the cookie was minted. The Edge proxy therefore proves *authentication*, and
 * these guards decide *authorization*.
 */
import { redirect } from 'next/navigation';

import type { AuthUser } from '@/lib/persistence/auth-accounts';
import { isWorkbenchEntryEnabled } from '@/lib/workbench/entry-gate';

import { authEnabled, roleHomePath, type AuthRole } from './config';
import { currentSessionUser } from './session';

/** Whether the workspace is part of this build (server-authoritative). */
export function workbenchAvailable(): boolean {
  try {
    return isWorkbenchEntryEnabled();
  } catch {
    return false;
  }
}

/** Where an account of `role` belongs after signing in. */
export function homeForRole(role: AuthRole): string {
  return roleHomePath(role, workbenchAvailable());
}

/** The signed-in account of this page render, if accounts are on. */
export async function currentPageUser(): Promise<AuthUser | null> {
  if (!authEnabled()) return null;
  return currentSessionUser();
}

/** A page requires a signed-in account; unsigned visitors go to `/login`. */
export async function requirePageUser(nextPath?: string): Promise<AuthUser> {
  const user = await currentPageUser();
  if (user) return user;
  const next = nextPath && nextPath !== '/' ? `?next=${encodeURIComponent(nextPath)}` : '';
  redirect(`/login${next}`);
}

/** A page requires one of `roles`; everyone else lands on their own home. */
export async function requirePageRole(
  roles: readonly AuthRole[],
  nextPath?: string,
): Promise<AuthUser> {
  const user = await requirePageUser(nextPath);
  if (!roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

export function isAdminUser(user: Pick<AuthUser, 'role'> | null | undefined): boolean {
  return user?.role === 'admin';
}

/**
 * The `next` a signed-in account may be sent to. Only a path on this site, and
 * only one its role can open: a student deep link to `/workspace` (or anything
 * under `/admin`) falls back to the student home instead of bouncing through a
 * redirect chain. Query strings and hashes are ignored for the check — a link
 * like `/workspace?course=abc` is the same surface as `/workspace`.
 */
export function safeNextPath(next: string | null | undefined, role: AuthRole): string {
  const home = homeForRole(role);
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.length > 2_000) {
    return home;
  }
  const path = next.split(/[?#]/, 1)[0] ?? '/';
  if (path === '/login') return home;
  if (
    role === 'student' &&
    (path === '/workspace' ||
      path.startsWith('/workspace/') ||
      path === '/admin' ||
      path.startsWith('/admin/'))
  ) {
    return home;
  }
  if (role !== 'admin' && (path === '/admin' || path.startsWith('/admin/'))) return home;
  return next;
}
