/**
 * Curriculum Alignment API — Dinas Pendidikan
 *
 * Berdasarkan Permendikdasmen No. 13 Tahun 2025 (Perubahan atas Permendikbudristek No. 12/2024)
 *
 * POST /api/dinas/curriculum — Analisis kesesuaian materi dengan Kurikulum Merdeka
 * GET  /api/dinas/curriculum — Ambil struktur kurikulum (referensi)
 */

import { type NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';
import { getPinTokenFromRequest } from '@/lib/server/pin-auth';
import { createLogger } from '@/lib/logger';
import {
  FASE_PEMBELAJARAN,
  PROFIL_LULUSAN,
  STRUKTUR_KURIKULUM,
  getStrukturByJenjang,
  getStrukturByFase,
  getMataPelajaranByJenjang,
  type Fase,
  type Jenjang,
} from '@/lib/data/kurikulum-merdeka';
import type { CurriculumAlignmentRequest, CurriculumAlignmentResult } from '@/lib/types/dinas';

const log = createLogger('CurriculumAPI');

// ---------------------------------------------------------------------------
// GET — Referensi struktur kurikulum
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const jenjang = req.nextUrl.searchParams.get('jenjang') as Jenjang | null;
    const fase = req.nextUrl.searchParams.get('fase') as Fase | null;

    if (fase) {
      const faseInfo = FASE_PEMBELAJARAN[fase];
      if (!faseInfo) {
        return apiError('INVALID_REQUEST', 400, `Fase "${fase}" tidak valid. Gunakan: Fondasi, A, B, C, D, E, F`);
      }
      return apiSuccess({
        fase: { kode: fase, ...faseInfo },
        struktur: getStrukturByFase(fase),
        profilLulusan: PROFIL_LULUSAN,
        komponenKurikulum: STRUKTUR_KURIKULUM.komponen,
      });
    }

    if (jenjang) {
      const struktur = getStrukturByJenjang(jenjang);
      if (struktur.length === 0) {
        return apiError('INVALID_REQUEST', 400, `Jenjang "${jenjang}" tidak valid. Gunakan: PAUD, SD, SMP, SMA, SMK`);
      }
      return apiSuccess({
        jenjang,
        struktur,
        mataPelajaran: getMataPelajaranByJenjang(jenjang),
        profilLulusan: PROFIL_LULUSAN,
      });
    }

    // Return full reference
    return apiSuccess({
      fasePembelajaran: FASE_PEMBELAJARAN,
      profilLulusan: PROFIL_LULUSAN,
      komponenKurikulum: STRUKTUR_KURIKULUM.komponen,
      jenjangTersedia: ['PAUD', 'SD', 'SMP', 'SMA', 'SMK'],
      faseTersedia: ['Fondasi', 'A', 'B', 'C', 'D', 'E', 'F'],
      petunjuk: 'Gunakan query parameter ?jenjang=SD atau ?fase=D untuk data spesifik.',
    });
  } catch (error) {
    log.error('Curriculum reference error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Gagal mengambil data referensi kurikulum');
  }
}

// ---------------------------------------------------------------------------
// POST — Analisis keselarasan kurikulum
// ---------------------------------------------------------------------------

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

export async function POST(req: NextRequest) {
  let requirementSnippet: string | undefined;
  try {
    const body = (await req.json()) as CurriculumAlignmentRequest;
    requirementSnippet = body.requirement?.substring(0, 60);

    // Validate required fields
    if (!body.requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "requirement" wajib diisi');
    }
    if (!body.fase) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "fase" wajib diisi (Fondasi/A/B/C/D/E/F)');
    }
    if (!body.mataPelajaran) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "mataPelajaran" wajib diisi');
    }

    const faseInfo = FASE_PEMBELAJARAN[body.fase];
    if (!faseInfo) {
      return apiError('INVALID_REQUEST', 400, `Fase "${body.fase}" tidak valid`);
    }

    // Resolve model
    const pinToken = getPinTokenFromRequest(req) || undefined;
    const { model: languageModel } = resolveModel({ pinToken });

    // Build the context from Kurikulum Merdeka data
    const struktur = getStrukturByFase(body.fase);
    const dimensiLulusan = PROFIL_LULUSAN.map((d) => `- ${d.label}: ${d.deskripsi}`).join('\n');

    const strukturContext = struktur
      .map((s) => {
        const mapelList = s.mataPelajaranWajib.map((m) => `  - ${m.nama}: ${m.jpTotal} JP/tahun`).join('\n');
        return `Kelas ${s.kelas} (${s.asumsiMinggu} minggu, 1 JP = ${s.asumsiJPMenit} menit):\n${mapelList}`;
      })
      .join('\n\n');

    const systemPrompt = `Kamu adalah ahli kurikulum pendidikan Indonesia yang menguasai Permendikdasmen No. 13 Tahun 2025 (Perubahan atas Permendikbudristek No. 12/2024) tentang Kurikulum Merdeka.

Tugasmu adalah menganalisis kesesuaian materi pembelajaran dengan Kurikulum Merdeka.

KONTEKS REGULASI:
- Fase: ${body.fase} (${faseInfo.label}) — ${faseInfo.deskripsi}
- Jenjang: ${faseInfo.jenjang}
- Mata Pelajaran: ${body.mataPelajaran}

STRUKTUR KURIKULUM FASE ${body.fase}:
${strukturContext}

8 DIMENSI PROFIL LULUSAN (Pasal 17):
${dimensiLulusan}

KOMPONEN KURIKULUM (Pasal 7-8, 16):
1. Intrakurikuler — pembelajaran untuk mencapai Capaian Pembelajaran
2. Kokurikuler — pembelajaran kolaboratif lintas disiplin ilmu, gerakan 7 kebiasaan anak Indonesia hebat, dan/atau cara lainnya
3. Ekstrakurikuler — pengembangan minat dan bakat, bersifat sukarela

INSTRUKSI:
Analisis materi yang diberikan dan kembalikan hasil dalam format JSON berikut:
{
  "skorKeselarasan": <0-100>,
  "ringkasan": "<ringkasan analisis>",
  "capaianPembelajaran": ["<CP yang tercakup>"],
  "dimensiProfilLulusan": ["<dimensi profil lulusan yang terkait>"],
  "rekomendasi": ["<saran perbaikan>"],
  "kompetensiKurang": ["<kompetensi yang belum tercakup>"]
}

Jawab dalam bahasa Indonesia. Return ONLY valid JSON.`;

    const userPrompt = `Analisis kesesuaian materi berikut dengan Kurikulum Merdeka Fase ${body.fase} untuk mata pelajaran ${body.mataPelajaran}:

${body.requirement}`;

    const result = await callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      },
      'curriculum-alignment',
    );

    // Parse LLM response
    const rawText = stripCodeFences(result.text);
    let analysis: CurriculumAlignmentResult;

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      analysis = {
        skorKeselarasan: Math.max(0, Math.min(100, Math.round(Number(parsed.skorKeselarasan) || 0))),
        ringkasan: String(parsed.ringkasan || ''),
        capaianPembelajaran: Array.isArray(parsed.capaianPembelajaran) ? parsed.capaianPembelajaran.map(String) : [],
        dimensiProfilLulusan: Array.isArray(parsed.dimensiProfilLulusan ?? parsed.dimensiP5) ? (parsed.dimensiProfilLulusan ?? parsed.dimensiP5).map(String) : [],
        rekomendasi: Array.isArray(parsed.rekomendasi) ? parsed.rekomendasi.map(String) : [],
        kompetensiKurang: Array.isArray(parsed.kompetensiKurang) ? parsed.kompetensiKurang.map(String) : [],
      };
    } catch {
      log.warn('Failed to parse LLM response, returning raw text');
      analysis = {
        skorKeselarasan: 50,
        ringkasan: rawText.substring(0, 500),
        capaianPembelajaran: [],
        dimensiProfilLulusan: [],
        rekomendasi: ['Tidak dapat menganalisis secara otomatis. Silakan review manual.'],
        kompetensiKurang: [],
      };
    }

    return apiSuccess({
      analysis,
      metadata: {
        fase: body.fase,
        faseLabel: faseInfo.label,
        jenjang: faseInfo.jenjang,
        mataPelajaran: body.mataPelajaran,
        regulasi: 'Permendikdasmen No. 13 Tahun 2025',
      },
    });
  } catch (error) {
    log.error(
      `Curriculum alignment failed [requirement="${requirementSnippet ?? 'unknown'}..."]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Gagal menganalisis keselarasan kurikulum',
      error instanceof Error ? error.message : String(error),
    );
  }
}
