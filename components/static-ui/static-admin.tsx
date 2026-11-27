'use client';

import { AdminConsole } from '@/components/admin/admin-console';

import { StaticAuthGate } from './static-auth-gate';

/** `/admin` on the static build: admins only. */
export function StaticAdmin() {
  return (
    <StaticAuthGate loginNext="/admin" roles={['admin']}>
      {(user) =>
        user ? <AdminConsole currentUser={{ id: user.id, name: user.name }} /> : null
      }
    </StaticAuthGate>
  );
}
