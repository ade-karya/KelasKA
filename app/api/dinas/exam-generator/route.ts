/**
 * Exam Generator API — Dinas Pendidikan
 *
 * Generate soal ujian/assessment sesuai Kurikulum Merdeka
 * (Permendikdasmen No. 13 Tahun 2025)
 *
 * POST /api/dinas/exam-generator — Generate soal ujian
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
  getStrukturByFase,
} from '@/lib/data/kurikulum-merdeka';
import type {
  ExamGeneratorRequest,
  ExamGeneratorResult,
  ExamQuestion,
} from '@/lib/types/dinas';

const log = createLogger('ExamGeneratorAPI');

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

export async function POST(req: NextRequest) {
  let topikSnippet: string | undefined;
  try {
    const body = (await req.json()) as ExamGeneratorRequest;
    topikSnippet = body.topik?.substring(0, 60);

    // Validate required fields
    if (!body.topik) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Field "topik" wajib diisi');
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

    const jumlahSoal = body.jumlahSoal || 10;
    if (jumlahSoal < 1 || jumlahSoal > 50) {
      return apiError('INVALID_REQUEST', 400, 'jumlahSoal harus antara 1-50');
    }

    const tingkatKesulitan = body.tingkatKesulitan || 'campuran';
    const tipeSoal = body.tipeSoal || 'campuran';

    // Resolve model
    const pinToken = getPinTokenFromRequest(req) || undefined;
    const { model: languageModel } = resolveModel({ pinToken });

    // Build context
    const struktur = getStrukturByFase(body.fase);
    const dimensiLulusan = PROFIL_LULUSAN.map((d) => `- ${d.label}`).join('\n');
    const dimensiFilter = body.dimensiProfilLulusan?.length
      ? `\nFokus pada dimensi Profil Lulusan: ${body.dimensiProfilLulusan.join(', ')}`
      : '';

    const strukturInfo = struktur
      .map((s) => `Kelas ${s.kelas}: ${s.asumsiMinggu} minggu, 1 JP = ${s.asumsiJPMenit} menit`)
      .join('; ');

    const tipeSoalInstruction =
      tipeSoal === 'pilihan_ganda'
        ? 'Buat semua soal dalam format pilihan ganda (A, B, C, D).'
        : tipeSoal === 'essay'
          ? 'Buat semua soal dalam format essay/uraian.'
          : `Buat campuran soal: sekitar ${Math.ceil(jumlahSoal * 0.6)} pilihan ganda dan ${Math.floor(jumlahSoal * 0.4)} essay.`;

    const systemPrompt = `Kamu adalah ahli penyusun soal ujian pendidikan Indonesia yang menguasai Kurikulum Merdeka (Permendikdasmen No. 13 Tahun 2025).

KONTEKS:
- Fase: ${body.fase} (${faseInfo.label}) — ${faseInfo.deskripsi}
- Jenjang: ${faseInfo.jenjang} (${strukturInfo})
- Mata Pelajaran: ${body.mataPelajaran}
- Topik: ${body.topik}
- Tingkat Kesulitan: ${tingkatKesulitan}
- Jumlah Soal: ${jumlahSoal}
${dimensiFilter}

8 DIMENSI PROFIL LULUSAN (Pasal 17):
${dimensiLulusan}

TAKSONOMI BLOOM:
- mengingat (C1), memahami (C2), menerapkan (C3), menganalisis (C4), mengevaluasi (C5), mencipta (C6)

PEDOMAN PEMBUATAN SOAL:
1. Soal harus sesuai dengan Capaian Pembelajaran fase ${body.fase}
2. ${tipeSoalInstruction}
3. Tingkat kesulitan "${tingkatKesulitan}" — sesuaikan distribusi level Taksonomi Bloom
4. Setiap soal harus memiliki pembahasan yang jelas
5. Mapping ke Capaian Pembelajaran yang relevan
6. Skor: pilihan ganda = 2 poin, essay = 5 poin

Return ONLY valid JSON dengan format:
{
  "soal": [
    {
      "nomor": 1,
      "tipe": "pilihan_ganda" | "essay",
      "soal": "<teks soal>",
      "opsi": [{"label": "A", "teks": "<opsi>"}, ...],
      "kunciJawaban": "<kunci>",
      "pembahasan": "<pembahasan>",
      "capaianPembelajaran": "<CP terkait>",
      "taksonomiBloom": "mengingat" | "memahami" | "menerapkan" | "menganalisis" | "mengevaluasi" | "mencipta",
      "skor": <skor>
    }
  ]
}`;

    const userPrompt = `Buatlah ${jumlahSoal} soal ujian untuk:
Topik: ${body.topik}
Mata Pelajaran: ${body.mataPelajaran}
Fase: ${body.fase} (${faseInfo.label})
Tingkat Kesulitan: ${tingkatKesulitan}
Bahasa: ${body.language || 'id-ID'}`;

    const result = await callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      },
      'exam-generator',
    );

    // Parse LLM response
    const rawText = stripCodeFences(result.text);
    let soalList: ExamQuestion[];

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      const rawSoal = Array.isArray(parsed.soal) ? parsed.soal : [];

      soalList = rawSoal.map(
        (s: Record<string, unknown>, i: number): ExamQuestion => ({
          nomor: Number(s.nomor) || i + 1,
          tipe: s.tipe === 'essay' ? 'essay' : 'pilihan_ganda',
          soal: String(s.soal || ''),
          opsi: Array.isArray(s.opsi)
            ? (s.opsi as Array<{ label: string; teks: string }>).map((o) => ({
                label: String(o.label || ''),
                teks: String(o.teks || ''),
              }))
            : undefined,
          kunciJawaban: String(s.kunciJawaban || ''),
          pembahasan: String(s.pembahasan || ''),
          capaianPembelajaran: String(s.capaianPembelajaran || ''),
          taksonomiBloom: (['mengingat', 'memahami', 'menerapkan', 'menganalisis', 'mengevaluasi', 'mencipta'].includes(
            String(s.taksonomiBloom),
          )
            ? String(s.taksonomiBloom)
            : 'memahami') as ExamQuestion['taksonomiBloom'],
          skor: Number(s.skor) || (s.tipe === 'essay' ? 5 : 2),
        }),
      );
    } catch {
      log.warn('Failed to parse exam LLM response');
      return apiError('GENERATION_FAILED', 500, 'Gagal men-generate soal ujian. Silakan coba lagi.');
    }

    const totalSkor = soalList.reduce((sum, s) => sum + s.skor, 0);

    const examResult: ExamGeneratorResult = {
      metadata: {
        topik: body.topik,
        fase: body.fase,
        mataPelajaran: body.mataPelajaran,
        jumlahSoal: soalList.length,
        totalSkor,
        tingkatKesulitan,
      },
      soal: soalList,
    };

    return apiSuccess({
      exam: examResult,
      regulasi: 'Permendikdasmen No. 13 Tahun 2025 (Kurikulum Merdeka)',
    });
  } catch (error) {
    log.error(
      `Exam generation failed [topik="${topikSnippet ?? 'unknown'}..."]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Gagal men-generate soal ujian',
      error instanceof Error ? error.message : String(error),
    );
  }
}
