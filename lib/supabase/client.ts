/**
 * The browser half of the Supabase sign-in handshake: the client the login
 * screen uses to start the Google consent. Uses the browser-baked
 * `NEXT_PUBLIC_SUPABASE_*` values (see `supabaseBrowserConfigured()`); the
 * service-role key is never shipped to the browser.
 */
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
