'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore } from '@/lib/store/user-profile';

/**
 * Fetches server-configured providers on mount and merges into settings store.
 * Renders nothing — purely a side-effect component.
 */
export function ServerProvidersInit() {
  const fetchServerProviders = useSettingsStore((state) => state.fetchServerProviders);
  const syncUserConfigs = useSettingsStore((state) => state.syncUserConfigs);
  const email = useUserProfileStore((state) => state.email);

  useEffect(() => {
    async function init() {
      await fetchServerProviders();
      if (email) {
        await syncUserConfigs(email);
      }
    }
    init();
  }, [fetchServerProviders, syncUserConfigs, email]);

  return null;
}
