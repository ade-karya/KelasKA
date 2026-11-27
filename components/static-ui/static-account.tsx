'use client';

import { AccountForms } from '@/components/auth/account-forms';
import { BrandLogo } from '@/components/brand-logo';
import { roleHomePath } from '@/lib/server/auth/config';

import { StaticAuthGate } from './static-auth-gate';

/** `/account` on the static build: any signed-in role. */
export function StaticAccount({ workbench }: { readonly workbench: boolean }) {
  return (
    <StaticAuthGate loginNext="/account">
      {(user) =>
        user ? (
          <main className="min-h-dvh bg-gray-50 px-4 py-8 dark:bg-slate-950 sm:px-6">
            <div className="mx-auto w-full max-w-xl">
              <div className="mb-6 flex items-center justify-center">
                <BrandLogo size="sm" />
              </div>
              <AccountForms
                name={user.name}
                email={user.email}
                role={user.role}
                homePath={roleHomePath(user.role, workbench)}
              />
            </div>
          </main>
        ) : null
      }
    </StaticAuthGate>
  );
}
