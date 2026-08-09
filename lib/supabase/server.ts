import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazily initialized to avoid module-level errors during Next.js build
// when Supabase env vars are not available (e.g., Vercel CI without env vars configured).
let _client: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl) throw new Error('SUPABASE_URL env var is not set');
  if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is not set');
  _client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
  return _client;
}

/** @deprecated Use getSupabaseServer() instead */
export const supabaseServer = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getSupabaseServer()[prop as keyof SupabaseClient];
  },
});
