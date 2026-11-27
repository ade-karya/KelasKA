/**
 * `/account` — the signed-in account's own settings.
 *
 * Any role may open it: the display name and sign out. The e-mail, the role and
 * the Google binding are read-only here; they are administrative.
 */
import { notFound } from 'next/navigation';

import { AccountForms } from '@/components/auth/account-forms';
import { BrandLogo } from '@/components/brand-logo';
import { StaticAccount } from '@/components/static-ui/static-account';
import { isWorkbenchEnabled } from '@/lib/config/feature-flags';
import { authEnabled } from '@/lib/server/auth/config';
import { homeForRole, requirePageUser } from '@/lib/server/auth/guards';


export default async function AccountPage() {
  if (process.env.STATIC_UI === '1') {
    return <StaticAccount workbench={isWorkbenchEnabled()} />;
  }
  if (!authEnabled()) notFound();
  const user = await requirePageUser('/account');

  return (
    <main className="min-h-dvh bg-gray-50 px-4 py-8 dark:bg-slate-950 sm:px-6">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center">
          <BrandLogo size="sm" />
        </div>
        <AccountForms
          name={user.name}
          email={user.email}
          role={user.role}
          homePath={homeForRole(user.role)}
        />
      </div>
    </main>
  );
}
