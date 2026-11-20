/**
 * POST /api/internal/maintenance
 *
 * Called by the Cloudflare Cron Worker (every 5 minutes) to check that the
 * database is reachable and to summarise the on-demand worker queue. The
 * route is exempted from the user-auth gate in `proxy.ts` because the caller
 * is a machine, not a browser: it authenticates with a shared secret in the
 * `x-kelaska-cron-secret` header instead of a session cookie.
 *
 * It deliberately uses a short-lived raw `pg` pool rather than the shared
 * persistence provider: a maintenance probe must not bootstrap every store's
 * schema on every poll, and it must never read a gateway identity header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function countOrNull(rows: unknown): number | null {
  const value = Array.isArray(rows) ? (rows[0] as { n?: number } | undefined)?.n : undefined;
  return typeof value === 'number' ? value : null;
}

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get('x-kelaska-cron-secret') ?? '';
  if (!expected || !secretMatches(provided, expected)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return NextResponse.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5_000 });
  try {
    const ping = await pool.query('select 1 as ok');
    const dbOk = (ping.rowCount ?? 0) === 1;

    // worker_jobs / worker_heartbeats are added by the worker migration. Until
    // it has run, report null instead of failing the whole maintenance probe.
    let queued: number | null = null;
    let stuck: number | null = null;
    let workersOnline: number | null = null;
    try {
      const q = await pool.query(
        "select count(*)::int as n from worker_jobs where status = 'queued'",
      );
      const s = await pool.query(
        'select count(*)::int as n from worker_jobs ' +
          "where status in ('leased','running') and lease_expires_at < now()",
      );
      const w = await pool.query(
        "select count(*)::int as n from worker_heartbeats where last_seen_at > now() - interval '10 minutes'",
      );
      queued = countOrNull(q.rows);
      stuck = countOrNull(s.rows);
      workersOnline = countOrNull(w.rows);
    } catch {
      // Migration not applied yet; keep the database health result.
    }

    return NextResponse.json({
      ok: dbOk,
      dbOk,
      queued,
      stuck,
      workersOnline,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, dbOk: false, error: error instanceof Error ? error.message : 'DB_ERROR' },
      { status: 503 },
    );
  } finally {
    await pool.end().catch(() => {});
  }
}
