/**
 * Classroom Catalog API — Dinas Pendidikan
 *
 * Katalog/pustaka kelas untuk sharing antar guru di lingkungan dinas.
 *
 * GET  /api/dinas/catalog — Daftar kelas yang dipublikasikan
 * POST /api/dinas/catalog — Publikasi kelas ke katalog
 */

import { type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { readCatalog, addCatalogEntry } from '@/lib/server/dinas-store';
import { readClassroom, isValidClassroomId } from '@/lib/server/classroom-storage';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { FASE_PEMBELAJARAN, type Fase, type Jenjang } from '@/lib/data/kurikulum-merdeka';
import type { CatalogPublishRequest, CatalogEntry, CatalogFilterParams } from '@/lib/types/dinas';

const log = createLogger('CatalogAPI');

// ---------------------------------------------------------------------------
// GET — Daftar katalog kelas
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const params: CatalogFilterParams = {
      jenjang: (req.nextUrl.searchParams.get('jenjang') as Jenjang) || undefined,
      fase: (req.nextUrl.searchParams.get('fase') as Fase) || undefined,
      mataPelajaran: req.nextUrl.searchParams.get('mataPelajaran') || undefined,
      search: req.nextUrl.searchParams.get('search') || undefined,
      page: parseInt(req.nextUrl.searchParams.get('page') || '1', 10),
      limit: parseInt(req.nextUrl.searchParams.get('limit') || '20', 10),
    };

    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 20));

    let catalog = await readCatalog();

    // Apply filters
    if (params.jenjang) {
      catalog = catalog.filter((e) => e.jenjang === params.jenjang);
    }
    if (params.fase) {
      catalog = catalog.filter((e) => e.fase === params.fase);
    }
    if (params.mataPelajaran) {
      catalog = catalog.filter((e) =>
        e.mataPelajaran.toLowerCase().includes(params.mataPelajaran!.toLowerCase()),
      );
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      catalog = catalog.filter(
        (e) =>
          e.judul.toLowerCase().includes(q) ||
          e.deskripsi.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Sort by publishedAt descending
    catalog.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    // Paginate
    const total = catalog.length;
    const totalPages = Math.ceil(total / limit);
    const startIdx = (page - 1) * limit;
    const entries = catalog.slice(startIdx, startIdx + limit);

    return apiSuccess({
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    log.error('Catalog list error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Gagal mengambil katalog kelas');
  }
}

// ---------------------------------------------------------------------------
// POST — Publikasi kelas ke katalog
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let classroomIdSnippet: string | undefined;
  try {
    const body = (await req.json()) as CatalogPublishRequest;
    classroomIdSnippet = body.classroomId?.substring(0, 20);

    // Validate required fields
    if (!body.classroomId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "classroomId" wajib diisi');
    }
    if (!body.judul) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "judul" wajib diisi');
    }
    if (!body.jenjang) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "jenjang" wajib diisi (PAUD/SD/SMP/SMA/SMK)');
    }
    if (!body.fase) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "fase" wajib diisi (Fondasi/A/B/C/D/E/F)');
    }
    if (!body.mataPelajaran) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "mataPelajaran" wajib diisi');
    }
    if (!body.kelas) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "kelas" wajib diisi (e.g., "VII", "X")');
    }

    // Validate fase
    const faseInfo = FASE_PEMBELAJARAN[body.fase];
    if (!faseInfo) {
      return apiError('INVALID_REQUEST', 400, `Fase "${body.fase}" tidak valid`);
    }

    // Verify classroom exists
    if (!isValidClassroomId(body.classroomId)) {
      return apiError('INVALID_REQUEST', 400, 'Format classroomId tidak valid');
    }

    const classroom = await readClassroom(body.classroomId);
    if (!classroom) {
      return apiError('INVALID_REQUEST', 404, 'Classroom tidak ditemukan');
    }

    const baseUrl = buildRequestOrigin(req);

    const entry: CatalogEntry = {
      id: nanoid(10),
      classroomId: body.classroomId,
      judul: body.judul,
      deskripsi: body.deskripsi || '',
      jenjang: body.jenjang,
      fase: body.fase,
      mataPelajaran: body.mataPelajaran,
      kelas: body.kelas,
      tags: body.tags || [],
      url: `${baseUrl}/classroom/${body.classroomId}`,
      publishedAt: new Date().toISOString(),
    };

    const saved = await addCatalogEntry(entry);
    log.info(`Catalog entry published: ${saved.id} for classroom ${body.classroomId}`);

    return apiSuccess({ entry: saved }, 201);
  } catch (error) {
    log.error(
      `Catalog publish failed [classroom="${classroomIdSnippet ?? 'unknown'}"]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Gagal mempublikasikan kelas ke katalog',
      error instanceof Error ? error.message : String(error),
    );
  }
}
