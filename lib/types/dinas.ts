/**
 * Type definitions for Dinas Pendidikan APIs
 *
 * Aligned with Permendikdasmen No. 13 Tahun 2025
 * (Perubahan atas Permendikbudristek No. 12 Tahun 2024 — Kurikulum Merdeka)
 */

import type { Fase, Jenjang } from '@/lib/data/kurikulum-merdeka';

// ---------------------------------------------------------------------------
// Curriculum Alignment
// ---------------------------------------------------------------------------

export interface CurriculumAlignmentRequest {
  /** Deskripsi materi/requirement yang akan dianalisis */
  requirement: string;
  /** Fase pembelajaran target */
  fase: Fase;
  /** Mata pelajaran yang relevan */
  mataPelajaran: string;
  /** Bahasa output */
  language?: string;
}

export interface CurriculumAlignmentResult {
  /** Skor keselarasan 0-100 */
  skorKeselarasan: number;
  /** Ringkasan analisis */
  ringkasan: string;
  /** Capaian Pembelajaran yang tercakup */
  capaianPembelajaran: string[];
  /** Dimensi Profil Lulusan terkait (8 dimensi, Pasal 17) */
  dimensiProfilLulusan: string[];
  /** Rekomendasi perbaikan */
  rekomendasi: string[];
  /** Kompetensi yang kurang */
  kompetensiKurang: string[];
}

// ---------------------------------------------------------------------------
// Exam Generator
// ---------------------------------------------------------------------------

export type TingkatKesulitan = 'mudah' | 'sedang' | 'sulit' | 'campuran';
export type TipeSoal = 'pilihan_ganda' | 'essay' | 'campuran';
export type TaksonomiBloom = 'mengingat' | 'memahami' | 'menerapkan' | 'menganalisis' | 'mengevaluasi' | 'mencipta';

export interface ExamGeneratorRequest {
  /** Topik/materi ujian */
  topik: string;
  /** Fase pembelajaran */
  fase: Fase;
  /** Mata pelajaran */
  mataPelajaran: string;
  /** Jumlah soal */
  jumlahSoal: number;
  /** Tingkat kesulitan */
  tingkatKesulitan: TingkatKesulitan;
  /** Tipe soal */
  tipeSoal: TipeSoal;
  /** Dimensi Profil Lulusan yang ingin diukur (opsional) */
  dimensiProfilLulusan?: string[];
  /** Bahasa soal */
  language?: string;
}

export interface ExamQuestion {
  /** Nomor soal */
  nomor: number;
  /** Tipe soal */
  tipe: 'pilihan_ganda' | 'essay';
  /** Teks soal */
  soal: string;
  /** Opsi jawaban (untuk pilihan ganda) */
  opsi?: { label: string; teks: string }[];
  /** Kunci jawaban */
  kunciJawaban: string;
  /** Pembahasan */
  pembahasan: string;
  /** Capaian Pembelajaran terkait */
  capaianPembelajaran: string;
  /** Level Taksonomi Bloom */
  taksonomiBloom: TaksonomiBloom;
  /** Skor */
  skor: number;
}

export interface ExamGeneratorResult {
  /** Metadata ujian */
  metadata: {
    topik: string;
    fase: Fase;
    mataPelajaran: string;
    jumlahSoal: number;
    totalSkor: number;
    tingkatKesulitan: TingkatKesulitan;
  };
  /** Daftar soal */
  soal: ExamQuestion[];
}

// ---------------------------------------------------------------------------
// Classroom Catalog
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  /** ID entri katalog */
  id: string;
  /** ID classroom (referensi ke classroom storage) */
  classroomId: string;
  /** Judul kelas */
  judul: string;
  /** Deskripsi */
  deskripsi: string;
  /** Jenjang */
  jenjang: Jenjang;
  /** Fase */
  fase: Fase;
  /** Mata pelajaran */
  mataPelajaran: string;
  /** Kelas (e.g., "VII", "X") */
  kelas: string;
  /** Tags */
  tags: string[];
  /** URL classroom */
  url: string;
  /** Tanggal publikasi */
  publishedAt: string;
  /** Pembuat */
  publishedBy?: string;
}

export interface CatalogPublishRequest {
  classroomId: string;
  judul: string;
  deskripsi?: string;
  jenjang: Jenjang;
  fase: Fase;
  mataPelajaran: string;
  kelas: string;
  tags?: string[];
}

export interface CatalogFilterParams {
  jenjang?: Jenjang;
  fase?: Fase;
  mataPelajaran?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface AnalyticsSummary {
  totalKelas: number;
  distribusiJenjang: Record<string, number>;
  distribusiFase: Record<string, number>;
  distribusiMapel: Record<string, number>;
  recentEntries: CatalogEntry[];
}
