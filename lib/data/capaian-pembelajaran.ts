/**
 * Capaian Pembelajaran (CP) Lookup
 *
 * Data extracted from KepKaBSKAP No. 046/H/KR/2025 tentang
 * Capaian Pembelajaran pada Pendidikan Anak Usia Dini,
 * Jenjang Pendidikan Dasar, dan Jenjang Pendidikan Menengah.
 *
 * Provides CP text per mata pelajaran and fase (A-F).
 */

import cpData from './capaian-pembelajaran.json';
import type { Fase, Jenjang } from './kurikulum-merdeka';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mapping of subject → fase → CP text */
type CPDatabase = Record<string, Record<string, string>>;

const CP_DB: CPDatabase = cpData as CPDatabase;

// ---------------------------------------------------------------------------
// Fase ↔ Jenjang/Kelas mapping
// ---------------------------------------------------------------------------

const KELAS_TO_FASE: Record<string, Fase> = {
  // SD
  'I': 'A', 'II': 'A',
  'III': 'B', 'IV': 'B', 'III-IV': 'B',
  'V': 'C', 'VI': 'C',
  // SMP
  'VII': 'D', 'VIII': 'D', 'IX': 'D', 'VII-VIII': 'D',
  // SMA
  'X': 'E',
  'XI': 'F', 'XII': 'F', 'XI-XII': 'F',
};

// ---------------------------------------------------------------------------
// Subject name normalization (handles different naming between kurikulum data
// and CP PDF extraction)
// ---------------------------------------------------------------------------

const SUBJECT_ALIASES: Record<string, string> = {
  // Kurikulum uses shorter names, CP JSON uses full names
  'Pendidikan Agama dan Budi Pekerti': 'Pendidikan Agama Islam dan Budi Pekerti',
  'Seni, Budaya, dan Prakarya': 'Seni dan Budaya',
  'Seni dan Prakarya': 'Seni dan Budaya',
  'Pendidikan Jasmani, Olahraga, dan Kesehatan': 'Pendidikan Jasmani Olahraga dan Kesehatan',
  'Pendidikan Jasmani dan Olahraga': 'Pendidikan Jasmani Olahraga dan Kesehatan',
  // Note: "Ilmu Pengetahuan Alam dan Sosial" (IPAS) is a SEPARATE mapel for SD
  // It has its own CP data (Fase B-C). "Ilmu Pengetahuan Alam" (IPA) is for SMP/SMA.
};

function normalizeSubject(mapel: string): string {
  return SUBJECT_ALIASES[mapel] ?? mapel;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get Capaian Pembelajaran text for a given subject and fase.
 */
export function getCapaianPembelajaran(
  mapel: string,
  fase: Fase,
): string | null {
  const key = normalizeSubject(mapel);
  return CP_DB[key]?.[fase] ?? null;
}

/**
 * Get Capaian Pembelajaran text for a given subject and kelas.
 */
export function getCapaianPembelajaranByKelas(
  mapel: string,
  kelas: string,
): string | null {
  const fase = KELAS_TO_FASE[kelas];
  if (!fase) return null;
  return getCapaianPembelajaran(mapel, fase);
}

/**
 * Get the fase for a given kelas string.
 */
export function getFaseFromKelas(kelas: string): Fase | null {
  return KELAS_TO_FASE[kelas] ?? null;
}

/**
 * List all available subjects in the CP database.
 */
export function getAvailableCPSubjects(): string[] {
  return Object.keys(CP_DB);
}

/**
 * List all available fases for a given subject.
 */
export function getAvailableFases(mapel: string): Fase[] {
  const key = normalizeSubject(mapel);
  const entry = CP_DB[key];
  if (!entry) return [];
  return Object.keys(entry) as Fase[];
}

/**
 * Check if CP data exists for a given subject and fase combination.
 */
export function hasCapaianPembelajaran(
  mapel: string,
  fase: Fase,
): boolean {
  const key = normalizeSubject(mapel);
  return !!CP_DB[key]?.[fase];
}

/**
 * Build a formatted CP context string suitable for inclusion in AI prompts.
 */
export function buildCPContext(
  mapel: string,
  kelas: string,
): string | null {
  const fase = KELAS_TO_FASE[kelas];
  if (!fase) return null;

  const cpText = getCapaianPembelajaran(mapel, fase);
  if (!cpText) return null;

  return [
    `📋 CAPAIAN PEMBELAJARAN (KepKaBSKAP No. 046/H/KR/2025)`,
    `Mata Pelajaran: ${mapel}`,
    `Fase: ${fase} (Kelas ${kelas})`,
    ``,
    cpText,
  ].join('\n');
}
