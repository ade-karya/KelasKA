/**
 * `/login` — the Google sign-in page (through Supabase Auth).
 *
 * A browser with a live session is sent to its role's home, so the form is
 * never a dead end. The query carries the deep link the browser asked for and,
 * when the callback refused a sign-in, the reason (`pending`, `google_denied`,
 * …) the form shows in the visitor's language.
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';
import { StaticLogin } from '@/components/static-ui/static-login';
import { FullPageLoading } from '@/components/static-ui/static-auth-gate';
import { isWorkbenchEnabled } from '@/lib/config/feature-flags';
import { authEnabled, supabaseBrowserConfigured } from '@/lib/server/auth/config';
import { currentPageUser, homeForRole } from '@/lib/server/auth/guards';


export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  if (process.env.STATIC_UI === '1') {
    return (
      <Suspense fallback={<FullPageLoading />}>
        <StaticLogin workbench={isWorkbenchEnabled()} />
      </Suspense>
    );
  }

  if (!authEnabled()) redirect('/');

  const user = await currentPageUser();
  if (user) redirect(homeForRole(user.role));

  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;
  return <LoginForm next={next} error={error} supabaseEnabled={supabaseBrowserConfigured()} />;
}
