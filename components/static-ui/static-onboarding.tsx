'use client';

import { useSearchParams } from 'next/navigation';

import { ApiKeyOnboarding } from '@/components/onboarding/api-key-onboarding';
import { roleHomePath } from '@/lib/server/auth/config';

import { StaticAuthGate } from './static-auth-gate';

/** `/onboarding/api-key` on the static build: any signed-in role. */
export function StaticOnboarding({ workbench }: { readonly workbench: boolean }) {
  const params = useSearchParams();
  return (
    <StaticAuthGate loginNext="/onboarding/api-key">
      {(user) => {
        if (!user) return null;
        const requested = params.get('next');
        const next =
          requested && requested.startsWith('/') && !requested.startsWith('//')
            ? requested
            : roleHomePath(user.role, workbench);
        return <ApiKeyOnboarding userName={user.name} next={next} />;
      }}
    </StaticAuthGate>
  );
}
