/**
 * `/project-workspace` — the static-build entry for the sandbox workspace.
 * Vercel rewrites `/project-workspace/<id>` to `?id=<id>`; the Kaggle build
 * keeps the canonical dynamic route.
 */
import { redirect } from 'next/navigation';

import { StaticProjectWorkspace } from '@/components/static-ui/static-project-workspace';

export default function ProjectWorkspaceIndexPage() {
  if (process.env.STATIC_UI === '1') return <StaticProjectWorkspace />;
  redirect('/');
}
