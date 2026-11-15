/**
 * `/onboarding/api-key` — the bring-your-own-key wizard.
 *
 * The one surface a signed-in account may open without a verified key:
 * pick a provider, follow the steps to create a key, paste it, and get told
 * whether it works. Every other page (and the app's API) answers with a
 * redirect or a 403 until this wizard finishes, or an admin exempts the
 * account. An account that already passes the gate is sent home.
 */
import { notFound, redirect } from 'next/navigation';

import { ApiKeyOnboarding } from '@/components/onboarding/api-key-onboarding';
import { authEnabled } from '@/lib/server/auth/config';
import { homeForRole, requirePageUser, safeNextPath } from '@/lib/server/auth/guards';
import { apiKeyPassesForUser } from '@/lib/server/auth/api-key-gate';

export const dynamic = 'force-dynamic';

export default async function OnboardingApiKeyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (!authEnabled()) notFound();
  const user = await requirePageUser('/onboarding/api-key');
  const params = await searchParams;
  const next =
    typeof params.next === 'string'
      ? safeNextPath(params.next, user.role)
      : homeForRole(user.role);

  if (await apiKeyPassesForUser(user)) redirect(next);

  return <ApiKeyOnboarding userName={user.name} next={next} />;
}
