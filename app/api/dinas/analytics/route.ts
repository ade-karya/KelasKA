/**
 * Analytics API — Dinas Pendidikan
 *
 * Statistik penggunaan platform untuk kepala dinas / pengawas.
 *
 * GET /api/dinas/analytics — Ringkasan statistik
 */

import { type NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { readCatalog } from '@/lib/server/dinas-store';
import { createLogger } from '@/lib/logger';
import type { AnalyticsSummary } from '@/lib/types/dinas';

const log = createLogger('AnalyticsAPI');

export async function GET(_req: NextRequest) {
  try {
    const catalog = await readCatalog();

    // Build distribution counts
    const distribusiJenjang: Record<string, number> = {};
    const distribusiFase: Record<string, number> = {};
    const distribusiMapel: Record<string, number> = {};

    for (const entry of catalog) {
      distribusiJenjang[entry.jenjang] = (distribusiJenjang[entry.jenjang] || 0) + 1;
      distribusiFase[entry.fase] = (distribusiFase[entry.fase] || 0) + 1;
      distribusiMapel[entry.mataPelajaran] = (distribusiMapel[entry.mataPelajaran] || 0) + 1;
    }

    // Recent 10 entries
    const sorted = [...catalog].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
    const recentEntries = sorted.slice(0, 10);

    const summary: AnalyticsSummary = {
      totalKelas: catalog.length,
      distribusiJenjang,
      distribusiFase,
      distribusiMapel,
      recentEntries,
    };

    return apiSuccess({
      analytics: summary,
      regulasi: 'Permendikdasmen No. 13 Tahun 2025 (Kurikulum Merdeka)',
    });
  } catch (error) {
    log.error('Analytics error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Gagal mengambil data analytics');
  }
}
