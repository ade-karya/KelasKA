import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser-only Supabase client for the static SPA. This deliberately differs
 * from the web app's server-side PKCE exchange: with no server on Vercel Hobby
 * the browser must hold the short-lived access token. Keep the token in memory
 * via `persistSession: false` where possible; the URL code exchange still
 * works because Supabase keeps its verifier in localStorage.
 */
export function createSupabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'kelaska_spa_auth',
    },
  });
}
