/**
 * Which surface `/` shows on the static (Vercel) build.
 *
 * A signed-in student's role home is `/` (`roleHomePath`), so the classic
 * learning page must win there even when this build has the workbench flag
 * on: rendering the workspace would drop students into the teacher surface
 * without `/workspace`'s `StaticAuthGate` role check. Only a browser without
 * accounts uses the build-wide workbench entry.
 */
import type { AuthRole } from '@/lib/server/auth/config';

export type StaticSessionStatus = 'loading' | 'signed-in' | 'signed-out' | 'disabled';

export function staticHomeUsesWorkbench(
  status: StaticSessionStatus,
  workbench: boolean,
  role: AuthRole | null = null,
): boolean {
  if (status === 'signed-in' && role === 'student') return false;
  return status !== 'signed-in' && workbench;
}
