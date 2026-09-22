/**
 * Centralized PG SSL resolution for Supabase / managed Postgres.
 *
 * Supabase (direct db.*.supabase.co and pooler *.pooler.supabase.com) requires
 * SSL. node-postgres does NOT enable it from `connectionString` alone in all
 * versions/configs, so every Pool/Client in this app must pass `ssl` explicitly.
 *
 * Rules (per supabase-postgres-best-practices conn- rules):
 * - supabase hosts, `sslmode=require` (or verify-ca/verify-full), or PGSSLMODE=require
 *   => `{ rejectUnauthorized: false }` (Supabase uses valid certs, but minimal
 *   containers may lack CA bundle; false avoids boot failure).
 * - otherwise => undefined (local docker postgres, no SSL).
 */
export function resolvePgSsl(
  connectionString: string | undefined | null,
): { rejectUnauthorized: boolean } | undefined {
  const raw = (connectionString ?? '').trim();
  const lowered = raw.toLowerCase();
  if (!raw) return undefined;
  if (
    lowered.includes('supabase.co') ||
    lowered.includes('pooler.supabase.com') ||
    lowered.includes('sslmode=require') ||
    lowered.includes('sslmode=verify-ca') ||
    lowered.includes('sslmode=verify-full')
  ) {
    return { rejectUnauthorized: false };
  }
  const envMode = process.env.PGSSLMODE?.trim().toLowerCase();
  if (envMode === 'require' || envMode === 'verify-ca' || envMode === 'verify-full') {
    return { rejectUnauthorized: false };
  }
  const pgssl = process.env.PGSSL?.trim().toLowerCase();
  if (pgssl === 'true' || pgssl === '1') {
    return { rejectUnauthorized: false };
  }
  return undefined;
}
