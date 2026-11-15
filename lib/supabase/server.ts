/**
 * The server half of the Supabase sign-in handshake.
 *
 * `/api/auth/supabase/callback` builds a client bound to the incoming
 * request's cookies (which carry the PKCE code verifier the browser stored)
 * and exchanges the one-time code. The Supabase session is deliberately NOT
 * persisted: the `setAll` adapter is a no-op, so the browser never receives
 * Supabase tokens. The app maps the Supabase user onto its own revocable
 * `kelaska_session` cookie instead — see `lib/server/auth/config.ts`.
 *
 * Node-only. The Edge proxy never imports this module.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest } from 'next/server';

import { supabasePublishableKey, supabaseUrl } from '@/lib/server/auth/config';

export function createSupabaseHandshakeClient(request: NextRequest) {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  if (!url || !key) return null;
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(_cookies: Array<{ name: string; value: string; options?: CookieOptions }>) {
        // Discarded on purpose: see the module docstring.
      },
    },
  });
}
