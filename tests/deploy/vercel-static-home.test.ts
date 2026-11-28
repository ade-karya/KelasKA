import { describe, expect, it } from 'vitest';

import { staticHomeUsesWorkbench } from '@/components/static-ui/home-surface';
import { roleHomePath } from '@/lib/server/auth/config';
import { safeNextPath } from '@/lib/server/auth/guards';

/**
 * The static Vercel home cannot read the session cookie at build time, so the
 * role routing runs after hydration. A student's role home is `/`; rendering
 * the workbench there would bypass `/workspace`'s teacher/admin gate.
 */
describe('static home role routing', () => {
  it('keeps a signed-in student on the classic home in a workbench build', () => {
    expect(roleHomePath('student', true)).toBe('/');
    expect(staticHomeUsesWorkbench('signed-in', true, 'student')).toBe(false);
    expect(staticHomeUsesWorkbench('signed-in', false, 'student')).toBe(false);
  });

  it('does not render the workbench at `/` for other signed-in roles either', () => {
    // Teacher and admin are redirected to their own role home; `/` never
    // becomes their landing surface.
    expect(roleHomePath('teacher', true)).toBe('/workspace');
    expect(roleHomePath('admin', true)).toBe('/admin');
    expect(staticHomeUsesWorkbench('signed-in', true, 'teacher')).toBe(false);
    expect(staticHomeUsesWorkbench('signed-in', true, 'admin')).toBe(false);
  });

  it('uses the build-wide workbench entry only without accounts', () => {
    expect(staticHomeUsesWorkbench('disabled', true)).toBe(true);
    expect(staticHomeUsesWorkbench('disabled', false)).toBe(false);
  });

  it('sends a student with a workspace deep link back to the classic home', () => {
    expect(safeNextPath('/workspace?course=abc', 'student')).toBe('/');
  });
});
