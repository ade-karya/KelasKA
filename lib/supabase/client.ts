import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazily initialized to avoid errors when env vars are not available at module evaluation.
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL env var is not set');
  _client = createClient(supabaseUrl, supabaseAnonKey);
  return _client;
}

/** @deprecated Use getSupabase() instead */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getSupabase()[prop as keyof SupabaseClient];
  },
});
