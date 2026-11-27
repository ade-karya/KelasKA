/**
 * Internal worker status for the on-demand Kaggle kernel.
 *
 * The kernel that Vercel starts must know when to stop, or it burns the
 * weekly GPU quota while the queue is empty. This endpoint reports how many
 * runs are claimable and how many are being executed right now. It is not a
 * public API: without `WORKER_STATUS_TOKEN` (or with a wrong token) it answers
 * 404, exactly like an unknown route. The Kaggle kernel calls it over the
 * loopback address with the token from its own `.env.local`.
 */
import { timingSafeEqual } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { generationRunConfig } from '@/lib/server/generation/run/config';
import { EXECUTABLE_RUN_STATES } from '@/lib/server/generation/run/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function providedToken(request: NextRequest): string {
  const header = request.headers.get('x-kelaska-worker-token')?.trim();
  if (header) return header;
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? '';
}

function tokenMatches(request: NextRequest): boolean {
  const expected = process.env.WORKER_STATUS_TOKEN?.trim();
  if (!expected) return false;
  const provided = providedToken(request);
  if (!provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!tokenMatches(request)) {
    return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 });
  }

  const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  const leaseTtlMs = generationRunConfig().leaseTtlMs;
  const staleBefore = Date.now() - leaseTtlMs;
  const { rows } = await pool.query<{ claimable: string; active: string }>(
    `SELECT
       count(*) FILTER (
         WHERE (state = ANY($1::text[])
                OR (media_pending AND state IN ('paused', 'completed')))
           AND (lease_worker_id IS NULL
                OR lease_heartbeat_at IS NULL
                OR lease_heartbeat_at < $2)
       ) AS claimable,
       count(*) FILTER (
         WHERE lease_worker_id IS NOT NULL AND lease_heartbeat_at >= $2
       ) AS active
     FROM generation_runs`,
    [[...EXECUTABLE_RUN_STATES], staleBefore],
  );

  return NextResponse.json({
    success: true,
    claimable: Number(rows[0]?.claimable ?? 0),
    active: Number(rows[0]?.active ?? 0),
    leaseTtlMs,
    now: Date.now(),
  });
}
