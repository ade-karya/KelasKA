/**
 * `/classroom` — the static-build entry for the classroom surface.
 *
 * The Vercel branch has no dynamic route segments (a static export cannot
 * generate `/classroom/<id>` for arbitrary ids), so Vercel rewrites
 * `/classroom/<id>` to `/classroom?id=<id>` (see `vercel.json`). The Kaggle
 * build keeps the canonical `/classroom/[id]` page and redirects here only
 * when someone opens the bare path.
 */
import { redirect } from 'next/navigation';

import { StaticClassroom } from '@/components/static-ui/static-classroom';

export default function ClassroomIndexPage() {
  if (process.env.STATIC_UI === '1') return <StaticClassroom />;
  redirect('/');
}
