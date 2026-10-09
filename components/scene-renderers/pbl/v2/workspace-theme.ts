'use client';

import type { CSSProperties } from 'react';

export type PBLWorkspaceCSSVariables = CSSProperties & Record<`--${string}`, string | number>;

/** Deep-blue workspace theme, applied as inline CSS variables on the
 *  workspace root.
 *
 *  Lives in its own module (not `workspace.tsx`) so portaled UI that must
 *  render OUTSIDE the workspace frame — e.g. the submission modals, which
 *  escape the docked frame's `isolate` stacking context to stay clickable
 *  above presentation overlays — can carry the exact same variables on
 *  their own root. Keep both in sync by construction: there is only one
 *  definition, here. */
export const PBL_WORKSPACE_THEME: PBLWorkspaceCSSVariables = {
  '--background': 'oklch(0.205 0.055 264)',
  '--foreground': 'oklch(0.962 0.016 260)',
  '--card': 'oklch(0.285 0.055 263)',
  '--card-foreground': 'oklch(0.97 0.014 260)',
  '--popover': 'oklch(0.265 0.055 263)',
  '--popover-foreground': 'oklch(0.97 0.014 260)',
  '--primary': '#9d8cff',
  '--primary-foreground': 'oklch(0.99 0.005 260)',
  '--secondary': 'oklch(0.32 0.052 260)',
  '--secondary-foreground': 'oklch(0.95 0.016 260)',
  '--muted': 'oklch(0.305 0.046 262)',
  '--muted-foreground': 'oklch(0.78 0.04 258)',
  '--accent': 'oklch(0.37 0.07 260)',
  '--accent-foreground': 'oklch(0.965 0.014 260)',
  '--destructive': 'oklch(0.66 0.19 25)',
  '--border': 'oklch(0.74 0.055 262 / 0.22)',
  '--input': 'oklch(0.68 0.05 262 / 0.3)',
  '--ring': 'oklch(0.73 0.12 282)',
};
