import { describe, expect, it } from 'vitest';

import { PBL_WORKSPACE_THEME } from '@/components/scene-renderers/pbl/v2/workspace-theme';

describe('PBL v2 — workspace theme contract', () => {
  it('exposes every CSS variable the portaled submission dialogs depend on', () => {
    // SubmissionModal / SubmissionViewer render OUTSIDE the workspace frame
    // (body/fullscreen-element portal, escaping the docked `isolate`
    // stacking trap), so they carry PBL_WORKSPACE_THEME on their own root.
    // If a variable below goes missing, the dialogs silently fall back to
    // the app-wide theme and visually regress — fail loudly instead.
    const vars = PBL_WORKSPACE_THEME as Record<string, string>;
    for (const key of [
      '--background',
      '--foreground',
      '--card',
      '--primary',
      '--primary-foreground',
      '--muted',
      '--muted-foreground',
      '--destructive',
      '--border',
      '--input',
      '--ring',
    ]) {
      expect(vars[key], key).toBeTruthy();
    }
    expect(vars['--primary']).toBe('#9d8cff');
  });
});
