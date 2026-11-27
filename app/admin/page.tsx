/**
 * `/admin` — the user console, for admins only.
 *
 * It is deliberately independent of the workbench: the admin exists even when
 * the workspace flag is off, and the console links to the workspace when the
 * admin has one.
 */
import { notFound } from 'next/navigation';

import { AdminConsole } from '@/components/admin/admin-console';
import { StaticAdmin } from '@/components/static-ui/static-admin';
import { authEnabled } from '@/lib/server/auth/config';
import { requirePageRole } from '@/lib/server/auth/guards';
import { requireApiKeyPass } from '@/lib/server/auth/api-key-gate';


export default async function AdminPage() {
  if (process.env.STATIC_UI === '1') return <StaticAdmin />;
  if (!authEnabled()) notFound();
  const user = await requirePageRole(['admin'], '/admin');
  await requireApiKeyPass(user);
  return <AdminConsole currentUser={{ id: user.id, name: user.name }} />;
}
