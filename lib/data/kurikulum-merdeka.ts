/**
 * Data Referensi Kurikulum Merdeka
 *
 * Berdasarkan Peraturan Menteri Pendidikan Dasar dan Menengah
 * Republik Indonesia Nomor 13 Tahun 2025 tentang Perubahan atas
 * Peraturan Menteri Pendidikan, Kebudayaan, Riset, dan Teknologi
 * Nomor 12 Tahun 2024 tentang Kurikulum pada Pendidikan
 * Anak Usia Dini, Jenjang Pendidikan Dasar, dan Jenjang Pendidikan Menengah.
 *
 * Sumber: jdih.kemdikbud.go.id
 */

// ---------------------------------------------------------------------------
// Jenjang Pendidikan (Pasal 6)
// ---------------------------------------------------------------------------

export type Jenjang = 'PAUD' | 'SD' | 'SMP' | 'SMA' | 'SMK';

export const JENJANG_PENDIDIKAN: Record<
  Jenjang,
  { label: string; aliases: string[]; kelasRange: string }
> = {
  PAUD: {
    label: 'Pendidikan Anak Usia Dini',
    aliases: ['TK', 'RA', 'Kelompok Bermain', 'TPA'],
    kelasRange: 'Usia 3-6 tahun',
  },
  SD: {
    label: 'Sekolah Dasar / Madrasah Ibtidaiyah',
    aliases: ['SD', 'MI', 'Paket A', 'SDLB'],
    kelasRange: 'Kelas I - VI',
  },
  SMP: {
    label: 'Sekolah Menengah Pertama / Madrasah Tsanawiyah',
    aliases: ['SMP', 'MTs', 'Paket B', 'SMPLB'],
    kelasRange: 'Kelas VII - IX',
  },
  SMA: {
    label: 'Sekolah Menengah Atas / Madrasah Aliyah',
    aliases: ['SMA', 'MA', 'Paket C', 'SMALB'],
    kelasRange: 'Kelas X - XII',
  },
  SMK: {
    label: 'Sekolah Menengah Kejuruan / Madrasah Aliyah Kejuruan',
    aliases: ['SMK', 'MAK'],
    kelasRange: 'Kelas X - XII/XIII',
  },
};

// ---------------------------------------------------------------------------
// Fase Pembelajaran (Pasal 9)
// ---------------------------------------------------------------------------

export type Fase = 'Fondasi' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface FaseInfo {
  label: string;
  jenjang: Jenjang;
  kelas: string;
  deskripsi: string;
}

export const FASE_PEMBELAJARAN: Record<Fase, FaseInfo> = {
  Fondasi: {
    label: 'Fase Fondasi',
    jenjang: 'PAUD',
    kelas: 'Usia 3-6 tahun',
    deskripsi: 'Pendidikan Anak Usia Dini (TK/RA/Kelompok Bermain/TPA)',
  },
  A: {
    label: 'Fase A',
    jenjang: 'SD',
    kelas: 'Kelas I - II',
    deskripsi: 'Sekolah Dasar / MI kelas I sampai kelas II',
  },
  B: {
    label: 'Fase B',
    jenjang: 'SD',
    kelas: 'Kelas III - V',
    deskripsi: 'Sekolah Dasar / MI kelas III sampai kelas V',
  },
  C: {
    label: 'Fase C',
    jenjang: 'SD',
    kelas: 'Kelas V - VI',
    deskripsi: 'Sekolah Dasar / MI kelas V sampai kelas VI',
  },
  D: {
    label: 'Fase D',
    jenjang: 'SMP',
    kelas: 'Kelas VII - IX',
    deskripsi: 'SMP / MTs / Paket B kelas VII sampai kelas IX',
  },
  E: {
    label: 'Fase E',
    jenjang: 'SMA',
    kelas: 'Kelas X',
    deskripsi: 'SMA/MA/SMK/MAK/Paket C kelas X',
  },
  F: {
    label: 'Fase F',
    jenjang: 'SMA',
    kelas: 'Kelas XI - XII',
    deskripsi: 'SMA/MA kelas XI-XII, SMK/MAK kelas XI-XII/XIII',
  },
};

// ---------------------------------------------------------------------------
// Profil Lulusan — 8 Dimensi (Pasal 17 Permendikdasmen 13/2025)
// ---------------------------------------------------------------------------

export interface DimensiProfilLulusan {
  id: string;
  label: string;
  deskripsi: string;
}

/** @deprecated Use PROFIL_LULUSAN instead */
export type DimensiP5 = DimensiProfilLulusan;

export const PROFIL_LULUSAN: DimensiProfilLulusan[] = [
  {
    id: 'keimanan',
    label: 'Keimanan dan Ketakwaan kepada Tuhan Yang Maha Esa',
    deskripsi:
      'Peserta didik yang beriman dan bertakwa kepada Tuhan Yang Maha Esa, mewujudkan keimanan dalam perilaku sehari-hari.',
  },
  {
    id: 'kewargaan',
    label: 'Kewargaan',
    deskripsi:
      'Kemampuan untuk memahami hak dan kewajiban sebagai warga negara, berpartisipasi aktif dalam kehidupan bermasyarakat, berbangsa, dan bernegara.',
  },
  {
    id: 'penalaran-kritis',
    label: 'Penalaran Kritis',
    deskripsi:
      'Kemampuan untuk secara objektif memproses informasi baik kualitatif maupun kuantitatif, membangun keterkaitan antara berbagai informasi, menganalisis informasi, mengevaluasi dan menyimpulkan.',
  },
  {
    id: 'kreativitas',
    label: 'Kreativitas',
    deskripsi:
      'Kemampuan untuk memodifikasi dan menghasilkan sesuatu yang orisinal, bermakna, bermanfaat, dan berdampak.',
  },
  {
    id: 'kolaborasi',
    label: 'Kolaborasi',
    deskripsi:
      'Kemampuan untuk melakukan kegiatan secara bersama-sama dengan sukarela agar kegiatan yang dikerjakan dapat berjalan lancar, mudah, dan ringan.',
  },
  {
    id: 'kemandirian',
    label: 'Kemandirian',
    deskripsi:
      'Kemampuan untuk bertanggung jawab atas proses dan hasil belajarnya.',
  },
  {
    id: 'kesehatan',
    label: 'Kesehatan',
    deskripsi:
      'Kemampuan untuk menjaga dan meningkatkan kesehatan fisik dan mental, serta menerapkan gaya hidup sehat dalam kehidupan sehari-hari.',
  },
  {
    id: 'komunikasi',
    label: 'Komunikasi',
    deskripsi:
      'Kemampuan untuk menyampaikan gagasan, pikiran, dan perasaan secara efektif dalam berbagai konteks dan media.',
  },
];

/** @deprecated Use PROFIL_LULUSAN instead */
export const PROFIL_PELAJAR_PANCASILA = PROFIL_LULUSAN;

// ---------------------------------------------------------------------------
// Struktur Kurikulum (Pasal 7-8, 16-19, 21)
// ---------------------------------------------------------------------------

export const STRUKTUR_KURIKULUM = {
  komponen: [
    {
      id: 'intrakurikuler',
      label: 'Intrakurikuler',
      pasal: 'Pasal 8',
      deskripsi:
        'Kegiatan pembelajaran untuk mencapai tujuan belajar sesuai jadwal dan beban belajar pada struktur Kurikulum. Memuat kompetensi (Capaian Pembelajaran), muatan pembelajaran, dan beban belajar.',
    },
    {
      id: 'kokurikuler',
      label: 'Kokurikuler',
      pasal: 'Pasal 16-19',
      deskripsi:
        'Pembelajaran kolaboratif lintas disiplin ilmu, gerakan 7 (tujuh) kebiasaan anak Indonesia hebat, dan/atau cara lainnya. Dikembangkan oleh Satuan Pendidikan mengacu pada panduan pejabat pimpinan tinggi madya di bidang Kurikulum.',
    },
    {
      id: 'ekstrakurikuler',
      label: 'Ekstrakurikuler',
      pasal: 'Pasal 21-24',
      deskripsi:
        'Kegiatan pengembangan karakter dalam rangka perluasan potensi, bakat, minat, kemampuan, kepribadian, kerja sama, dan kemandirian peserta didik secara optimal. Sekurang-kurangnya menyediakan Ekstrakurikuler kepramukaan atau kepanduan lainnya.',
    },
  ],
} as const;

// ---------------------------------------------------------------------------
// Mata Pelajaran & Alokasi JP per Jenjang/Kelas (Lampiran II)
// ---------------------------------------------------------------------------

export interface MataPelajaranInfo {
  nama: string;
  /** Alokasi Intrakurikuler JP per tahun */
  jpIntrakurikuler: number;
  /** Alokasi Kokurikuler JP per tahun */
  jpKokurikuler: number;
  /** Total JP per tahun */
  jpTotal: number;
  /** Catatan khusus */
  catatan?: string;
}

export interface StrukturKurikulumKelas {
  jenjang: Jenjang;
  kelas: string;
  fase: Fase;
  asumsiMinggu: number;
  asumsiJPMenit: number;
  mataPelajaranWajib: MataPelajaranInfo[];
  totalJPWajib: number;
  totalJPWajibPlusLokal: number;
  /** Mata pelajaran pilihan */
  mataPelajaranPilihan?: string[];
}

/**
 * Struktur Kurikulum SD (Tabel 1-5 Lampiran II Permendikdasmen 13/2025)
 */
export const KURIKULUM_SD: StrukturKurikulumKelas[] = [
  // Tabel 1 — Kelas I
  {
    jenjang: 'SD',
    kelas: 'I',
    fase: 'A',
    asumsiMinggu: 36,
    asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 144, jpKokurikuler: 36, jpTotal: 180 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 252, jpKokurikuler: 36, jpTotal: 288 },
      { nama: 'Matematika', jpIntrakurikuler: 144, jpKokurikuler: 36, jpTotal: 180 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144, catatan: 'Pilih 1: Seni Musik/Rupa/Teater/Tari' },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72, catatan: 'Paling banyak 2 JP per minggu' },
    ],
    totalJPWajib: 1080,
    totalJPWajibPlusLokal: 1152,
  },
  // Tabel 2 — Kelas II
  {
    jenjang: 'SD',
    kelas: 'II',
    fase: 'A',
    asumsiMinggu: 36,
    asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 144, jpKokurikuler: 36, jpTotal: 180 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 288, jpKokurikuler: 36, jpTotal: 324 },
      { nama: 'Matematika', jpIntrakurikuler: 180, jpKokurikuler: 36, jpTotal: 216 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1152,
    totalJPWajibPlusLokal: 1224,
  },
  // Tabel 3 — Kelas III-IV (Fase B)
  {
    jenjang: 'SD',
    kelas: 'III-IV',
    fase: 'B',
    asumsiMinggu: 36,
    asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 144, jpKokurikuler: 36, jpTotal: 180 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 216, jpKokurikuler: 36, jpTotal: 252 },
      { nama: 'Matematika', jpIntrakurikuler: 180, jpKokurikuler: 36, jpTotal: 216 },
      { nama: 'Ilmu Pengetahuan Alam dan Sosial', jpIntrakurikuler: 180, jpKokurikuler: 36, jpTotal: 216 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1368,
    totalJPWajibPlusLokal: 1440,
  },
  // Tabel 4 — Kelas V (Fase B — tabel terpisah, termasuk mapel pilihan Koding & AI)
  {
    jenjang: 'SD',
    kelas: 'V',
    fase: 'B',
    asumsiMinggu: 36,
    asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 144, jpKokurikuler: 36, jpTotal: 180 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 216, jpKokurikuler: 36, jpTotal: 252 },
      { nama: 'Matematika', jpIntrakurikuler: 180, jpKokurikuler: 36, jpTotal: 216 },
      { nama: 'Ilmu Pengetahuan Alam dan Sosial', jpIntrakurikuler: 180, jpKokurikuler: 36, jpTotal: 216 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1368,
    totalJPWajibPlusLokal: 1440,
    mataPelajaranPilihan: ['Koding dan Kecerdasan Artifisial'],
  },
  // Tabel 5 — Kelas VI (Fase C)
  {
    jenjang: 'SD',
    kelas: 'VI',
    fase: 'C',
    asumsiMinggu: 32,
    asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 128, jpKokurikuler: 32, jpTotal: 160 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 192, jpKokurikuler: 32, jpTotal: 224 },
      { nama: 'Matematika', jpIntrakurikuler: 160, jpKokurikuler: 32, jpTotal: 192 },
      { nama: 'Ilmu Pengetahuan Alam dan Sosial', jpIntrakurikuler: 160, jpKokurikuler: 32, jpTotal: 192 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
    ],
    totalJPWajib: 1216,
    totalJPWajibPlusLokal: 1280,
    mataPelajaranPilihan: ['Koding dan Kecerdasan Artifisial'],
  },
];

/**
 * Struktur Kurikulum SMP (Tabel 6-7 Lampiran II Permendikdasmen 13/2025)
 */
export const KURIKULUM_SMP: StrukturKurikulumKelas[] = [
  // Tabel 6 — Kelas VII-VIII
  {
    jenjang: 'SMP',
    kelas: 'VII-VIII',
    fase: 'D',
    asumsiMinggu: 36,
    asumsiJPMenit: 40,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 180, jpKokurikuler: 36, jpTotal: 216 },
      { nama: 'Matematika', jpIntrakurikuler: 144, jpKokurikuler: 36, jpTotal: 180 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 144, jpKokurikuler: 36, jpTotal: 180 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Informatika', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Seni, Budaya, dan Prakarya', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108, catatan: 'Pilih 1: Seni Musik/Rupa/Teater/Tari/Prakarya Budi Daya/Kerajinan/Rekayasa/Pengolahan' },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1404,
    totalJPWajibPlusLokal: 1476,
    mataPelajaranPilihan: ['Koding dan Kecerdasan Artifisial'],
  },
  // Tabel 7 — Kelas IX
  {
    jenjang: 'SMP',
    kelas: 'IX',
    fase: 'D',
    asumsiMinggu: 32,
    asumsiJPMenit: 40,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 64, jpKokurikuler: 32, jpTotal: 96 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 64, jpKokurikuler: 32, jpTotal: 96 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 160, jpKokurikuler: 32, jpTotal: 192 },
      { nama: 'Matematika', jpIntrakurikuler: 128, jpKokurikuler: 32, jpTotal: 160 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 128, jpKokurikuler: 32, jpTotal: 160 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 64, jpKokurikuler: 32, jpTotal: 96 },
      { nama: 'Informatika', jpIntrakurikuler: 64, jpKokurikuler: 32, jpTotal: 96 },
      { nama: 'Seni, Budaya, dan Prakarya', jpIntrakurikuler: 64, jpKokurikuler: 32, jpTotal: 96, catatan: 'Pilih 1: Seni Musik/Rupa/Teater/Tari/Prakarya Budi Daya/Kerajinan/Rekayasa/Pengolahan' },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
    ],
    totalJPWajib: 1248,
    totalJPWajibPlusLokal: 1312,
    mataPelajaranPilihan: ['Koding dan Kecerdasan Artifisial'],
  },
];

/**
 * Struktur Kurikulum SMA (Tabel 8-10 Lampiran II Permendikdasmen 13/2025)
 */
export const KURIKULUM_SMA: StrukturKurikulumKelas[] = [
  // Tabel 8 — Kelas X (Fase E)
  {
    jenjang: 'SMA',
    kelas: 'X',
    fase: 'E',
    asumsiMinggu: 36,
    asumsiJPMenit: 45,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Matematika', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Ilmu Pengetahuan Alam (Fisika, Kimia, Biologi)', jpIntrakurikuler: 216, jpKokurikuler: 108, jpTotal: 324 },
      { nama: 'Ilmu Pengetahuan Sosial (Sosiologi, Ekonomi, Sejarah, Geografi)', jpIntrakurikuler: 288, jpKokurikuler: 144, jpTotal: 432 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 108, jpKokurikuler: 0, jpTotal: 108 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Informatika', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Seni, Budaya, dan Prakarya', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72, catatan: 'Pilih 1: Seni Musik/Rupa/Teater/Tari/Prakarya Budi Daya/Kerajinan/Rekayasa/Pengolahan' },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1584,
    totalJPWajibPlusLokal: 1656,
    mataPelajaranPilihan: ['Koding dan Kecerdasan Artifisial'],
  },
  // Tabel 9 — Kelas XI (Fase F)
  {
    jenjang: 'SMA',
    kelas: 'XI',
    fase: 'F',
    asumsiMinggu: 36,
    asumsiJPMenit: 45,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Matematika', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 108, jpKokurikuler: 0, jpTotal: 108 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Sejarah', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 828,
    totalJPWajibPlusLokal: 900,
    mataPelajaranPilihan: [
      'Matematika Tingkat Lanjut', 'Fisika', 'Kimia', 'Biologi',
      'Geografi', 'Sejarah Tingkat Lanjut', 'Sosiologi', 'Ekonomi',
      'Bahasa Indonesia Tingkat Lanjut', 'Bahasa Inggris Tingkat Lanjut',
      'Bahasa Arab', 'Bahasa Jepang', 'Bahasa Jerman',
      'Bahasa Korea', 'Bahasa Mandarin', 'Bahasa Prancis',
      'Antropologi', 'Informatika',
      'Koding dan Kecerdasan Artifisial',
      'Prakarya dan Kewirausahaan',
    ],
  },
  // Tabel 10 — Kelas XII (Fase F)
  {
    jenjang: 'SMA',
    kelas: 'XII',
    fase: 'F',
    asumsiMinggu: 32,
    asumsiJPMenit: 45,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 64, jpKokurikuler: 32, jpTotal: 96 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Matematika', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 96, jpKokurikuler: 0, jpTotal: 96 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 64, jpKokurikuler: 32, jpTotal: 96 },
      { nama: 'Sejarah', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Muatan Lokal', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
    ],
    totalJPWajib: 736,
    totalJPWajibPlusLokal: 800,
    mataPelajaranPilihan: [
      'Matematika Tingkat Lanjut', 'Fisika', 'Kimia', 'Biologi',
      'Geografi', 'Sejarah Tingkat Lanjut', 'Sosiologi', 'Ekonomi',
      'Bahasa Indonesia Tingkat Lanjut', 'Bahasa Inggris Tingkat Lanjut',
      'Bahasa Arab', 'Bahasa Jepang', 'Bahasa Jerman',
      'Bahasa Korea', 'Bahasa Mandarin', 'Bahasa Prancis',
      'Antropologi', 'Informatika',
      'Koding dan Kecerdasan Artifisial',
      'Prakarya dan Kewirausahaan',
    ],
  },
];

// ---------------------------------------------------------------------------
// Struktur Kurikulum SMK (Tabel 11-15 Lampiran II Permendikdasmen 13/2025)
// ---------------------------------------------------------------------------

export interface MataPelajaranSMKInfo {
  nama: string;
  jpIntrakurikuler: number;
  jpKokurikuler: number;
  jpTotal: number;
  catatan?: string;
}

export interface StrukturKurikulumSMKKelas {
  kelas: string;
  fase: Fase;
  asumsiMinggu: number;
  asumsiJPMenit: number;
  program: '3 tahun' | '4 tahun';
  mataPelajaranUmum: MataPelajaranSMKInfo[];
  totalJPUmum: number;
  mataPelajaranKejuruan: MataPelajaranSMKInfo[];
  totalJPKejuruan: number;
  totalJPUmumPlusKejuruan: number;
  mataPelajaranPilihan?: string[];
}

export const KURIKULUM_SMK: StrukturKurikulumSMKKelas[] = [
  // Tabel 11 — Kelas X (3 & 4 tahun share same structure)
  {
    kelas: 'X',
    fase: 'E',
    asumsiMinggu: 36,
    asumsiJPMenit: 45,
    program: '3 tahun',
    mataPelajaranUmum: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 0, jpTotal: 108 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Jasmani, Olahraga, dan Kesehatan', jpIntrakurikuler: 108, jpKokurikuler: 0, jpTotal: 108 },
      { nama: 'Sejarah', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72, catatan: 'Pilih 1: Seni Musik/Rupa/Teater/Tari' },
    ],
    totalJPUmum: 576,
    mataPelajaranKejuruan: [
      { nama: 'Matematika', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Informatika', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Projek Ilmu Pengetahuan Alam dan Sosial', jpIntrakurikuler: 180, jpKokurikuler: 36, jpTotal: 216 },
      { nama: 'Dasar-Dasar Program Keahlian', jpIntrakurikuler: 432, jpKokurikuler: 0, jpTotal: 432 },
    ],
    totalJPKejuruan: 1080,
    totalJPUmumPlusKejuruan: 1656,
    mataPelajaranPilihan: ['Koding dan Kecerdasan Artifisial'],
  },
  // Tabel 12 — Kelas XI (3 & 4 tahun)
  {
    kelas: 'XI',
    fase: 'F',
    asumsiMinggu: 36,
    asumsiJPMenit: 45,
    program: '3 tahun',
    mataPelajaranUmum: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 90, jpKokurikuler: 18, jpTotal: 108 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 90, jpKokurikuler: 18, jpTotal: 108 },
      { nama: 'Pendidikan Jasmani, Olahraga, dan Kesehatan', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Sejarah', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
    ],
    totalJPUmum: 432,
    mataPelajaranKejuruan: [
      { nama: 'Matematika', jpIntrakurikuler: 90, jpKokurikuler: 18, jpTotal: 108 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Konsentrasi Keahlian', jpIntrakurikuler: 648, jpKokurikuler: 0, jpTotal: 648 },
      { nama: 'Kreativitas, Inovasi, dan Kewirausahaan', jpIntrakurikuler: 180, jpKokurikuler: 0, jpTotal: 180 },
      { nama: 'Mata Pelajaran Pilihan', jpIntrakurikuler: 144, jpKokurikuler: 0, jpTotal: 144 },
    ],
    totalJPKejuruan: 1224,
    totalJPUmumPlusKejuruan: 1656,
  },
  // Tabel 13 — Kelas XII (program 3 tahun)
  {
    kelas: 'XII',
    fase: 'F',
    asumsiMinggu: 32,
    asumsiJPMenit: 45,
    program: '3 tahun',
    mataPelajaranUmum: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 32, jpKokurikuler: 16, jpTotal: 48 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 32, jpKokurikuler: 0, jpTotal: 32 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 32, jpKokurikuler: 16, jpTotal: 48 },
    ],
    totalJPUmum: 128,
    mataPelajaranKejuruan: [
      { nama: 'Matematika', jpIntrakurikuler: 48, jpKokurikuler: 0, jpTotal: 48 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Konsentrasi Keahlian', jpIntrakurikuler: 352, jpKokurikuler: 0, jpTotal: 352 },
      { nama: 'Kreativitas, Inovasi, dan Kewirausahaan', jpIntrakurikuler: 80, jpKokurikuler: 0, jpTotal: 80 },
      { nama: 'Praktik Kerja Lapangan', jpIntrakurikuler: 736, jpKokurikuler: 0, jpTotal: 736, catatan: 'Paling sedikit 1 semester / 16 minggu efektif' },
      { nama: 'Mata Pelajaran Pilihan', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
    ],
    totalJPKejuruan: 1344,
    totalJPUmumPlusKejuruan: 1472,
  },
  // Tabel 14 — Kelas XII (program 4 tahun)
  {
    kelas: 'XII',
    fase: 'F',
    asumsiMinggu: 36,
    asumsiJPMenit: 45,
    program: '4 tahun',
    mataPelajaranUmum: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 90, jpKokurikuler: 18, jpTotal: 108 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 90, jpKokurikuler: 18, jpTotal: 108 },
      { nama: 'Pendidikan Jasmani, Olahraga, dan Kesehatan', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Sejarah', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
    ],
    totalJPUmum: 432,
    mataPelajaranKejuruan: [
      { nama: 'Matematika', jpIntrakurikuler: 90, jpKokurikuler: 18, jpTotal: 108 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Konsentrasi Keahlian', jpIntrakurikuler: 648, jpKokurikuler: 0, jpTotal: 648 },
      { nama: 'Kreativitas, Inovasi, dan Kewirausahaan', jpIntrakurikuler: 180, jpKokurikuler: 0, jpTotal: 180 },
      { nama: 'Mata Pelajaran Pilihan', jpIntrakurikuler: 144, jpKokurikuler: 0, jpTotal: 144 },
    ],
    totalJPKejuruan: 1224,
    totalJPUmumPlusKejuruan: 1656,
  },
  // Tabel 15 — Kelas XIII (program 4 tahun)
  {
    kelas: 'XIII',
    fase: 'F',
    asumsiMinggu: 32,
    asumsiJPMenit: 45,
    program: '4 tahun',
    mataPelajaranUmum: [],
    totalJPUmum: 0,
    mataPelajaranKejuruan: [
      { nama: 'Matematika', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 192, jpKokurikuler: 0, jpTotal: 192 },
      { nama: 'Praktik Kerja Lapangan', jpIntrakurikuler: 1216, jpKokurikuler: 0, jpTotal: 1216, catatan: 'Paling sedikit 10 bulan / 26 minggu efektif' },
    ],
    totalJPKejuruan: 1472,
    totalJPUmumPlusKejuruan: 1472,
  },
];

export const MATA_PELAJARAN_SMK = [
  // Umum
  'Pendidikan Agama dan Budi Pekerti',
  'Pendidikan Pancasila',
  'Bahasa Indonesia',
  'Pendidikan Jasmani, Olahraga, dan Kesehatan',
  'Sejarah',
  'Seni dan Budaya',
  // Kejuruan
  'Matematika',
  'Bahasa Inggris',
  'Informatika',
  'Projek Ilmu Pengetahuan Alam dan Sosial',
  'Dasar-Dasar Program Keahlian',
  'Konsentrasi Keahlian',
  'Kreativitas, Inovasi, dan Kewirausahaan',
  'Praktik Kerja Lapangan',
  'Muatan Lokal',
  // Pilihan
  'Koding dan Kecerdasan Artifisial',
] as const;

// ---------------------------------------------------------------------------
// Struktur Kurikulum SLB — Sekolah Luar Biasa (Tabel 16-26)
// ---------------------------------------------------------------------------

export type JenjangSLB = 'SDLB' | 'SMPLB' | 'SMALB';

export interface StrukturKurikulumSLBKelas {
  jenjangSLB: JenjangSLB;
  kelas: string;
  fase: Fase;
  asumsiMinggu: number;
  asumsiJPMenit: number;
  mataPelajaranWajib: MataPelajaranInfo[];
  totalJPWajib: number;
  totalJPWajibPlusLokal: number;
  catatan?: string;
}

export const KURIKULUM_SDLB: StrukturKurikulumSLBKelas[] = [
  // Tabel 16 — SDLB Kelas I
  {
    jenjangSLB: 'SDLB', kelas: 'I', fase: 'A', asumsiMinggu: 36, asumsiJPMenit: 30,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Matematika', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 252, jpKokurikuler: 108, jpTotal: 360 },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 216, jpKokurikuler: 0, jpTotal: 216 },
    ],
    totalJPWajib: 1080,
    totalJPWajibPlusLokal: 1152,
  },
  // Tabel 17 — SDLB Kelas II
  {
    jenjangSLB: 'SDLB', kelas: 'II', fase: 'A', asumsiMinggu: 36, asumsiJPMenit: 30,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Matematika', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 252, jpKokurikuler: 108, jpTotal: 360 },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 216, jpKokurikuler: 0, jpTotal: 216 },
    ],
    totalJPWajib: 1152,
    totalJPWajibPlusLokal: 1224,
  },
  // Tabel 18 — SDLB Kelas III-IV
  {
    jenjangSLB: 'SDLB', kelas: 'III-IV', fase: 'B', asumsiMinggu: 36, asumsiJPMenit: 30,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Matematika', jpIntrakurikuler: 72, jpKokurikuler: 36, jpTotal: 108 },
      { nama: 'Ilmu Pengetahuan Alam dan Sosial', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 360, jpKokurikuler: 144, jpTotal: 504 },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 216, jpKokurikuler: 0, jpTotal: 216 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1368,
    totalJPWajibPlusLokal: 1440,
  },
  // Tabel 19 — SDLB Kelas V
  {
    jenjangSLB: 'SDLB', kelas: 'V', fase: 'B', asumsiMinggu: 36, asumsiJPMenit: 30,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Matematika', jpIntrakurikuler: 108, jpKokurikuler: 36, jpTotal: 144 },
      { nama: 'Ilmu Pengetahuan Alam dan Sosial', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 360, jpKokurikuler: 144, jpTotal: 504 },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 144, jpKokurikuler: 0, jpTotal: 144 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1368,
    totalJPWajibPlusLokal: 1440,
  },
  // Tabel 20 — SDLB Kelas VI
  {
    jenjangSLB: 'SDLB', kelas: 'VI', fase: 'C', asumsiMinggu: 32, asumsiJPMenit: 30,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 54, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Matematika', jpIntrakurikuler: 96, jpKokurikuler: 32, jpTotal: 128 },
      { nama: 'Ilmu Pengetahuan Alam dan Sosial', jpIntrakurikuler: 54, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 54, jpKokurikuler: 0, jpTotal: 64 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 320, jpKokurikuler: 128, jpTotal: 448 },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 128, jpKokurikuler: 0, jpTotal: 128 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
    ],
    totalJPWajib: 1216,
    totalJPWajibPlusLokal: 1280,
  },
];

export const KURIKULUM_SMPLB: StrukturKurikulumSLBKelas[] = [
  // Tabel 21 — SMPLB Kelas VII
  {
    jenjangSLB: 'SMPLB', kelas: 'VII', fase: 'D', asumsiMinggu: 36, asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Matematika', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Kelompok Keterampilan', jpIntrakurikuler: 468, jpKokurikuler: 144, jpTotal: 612, catatan: 'Peserta didik memilih minimal 2 keterampilan. Termasuk Koding dan Kecerdasan Artifisial.' },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 108, jpKokurikuler: 0, jpTotal: 108 },
    ],
    totalJPWajib: 1368,
    totalJPWajibPlusLokal: 1440,
    catatan: 'Intrakurikuler dialokasikan 27 minggu, 9 minggu untuk Kokurikuler',
  },
  // Tabel 22 — SMPLB Kelas VIII
  {
    jenjangSLB: 'SMPLB', kelas: 'VIII', fase: 'D', asumsiMinggu: 36, asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Matematika', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Kelompok Keterampilan', jpIntrakurikuler: 468, jpKokurikuler: 144, jpTotal: 612, catatan: 'Peserta didik memilih 1 keterampilan. Termasuk Koding dan Kecerdasan Artifisial.' },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 108, jpKokurikuler: 0, jpTotal: 108 },
    ],
    totalJPWajib: 1368,
    totalJPWajibPlusLokal: 1440,
  },
  // Tabel 23 — SMPLB Kelas IX
  {
    jenjangSLB: 'SMPLB', kelas: 'IX', fase: 'D', asumsiMinggu: 32, asumsiJPMenit: 35,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Matematika', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Kelompok Keterampilan', jpIntrakurikuler: 416, jpKokurikuler: 128, jpTotal: 544, catatan: 'Peserta didik memilih 1 keterampilan. Termasuk Koding dan Kecerdasan Artifisial.' },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 96, jpKokurikuler: 0, jpTotal: 96 },
    ],
    totalJPWajib: 1216,
    totalJPWajibPlusLokal: 1280,
  },
];

export const KURIKULUM_SMALB: StrukturKurikulumSLBKelas[] = [
  // Tabel 24 — SMALB Kelas X
  {
    jenjangSLB: 'SMALB', kelas: 'X', fase: 'E', asumsiMinggu: 36, asumsiJPMenit: 40,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Matematika', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Kelompok Keterampilan', jpIntrakurikuler: 648, jpKokurikuler: 216, jpTotal: 864, catatan: 'Peserta didik memilih 1 keterampilan. Termasuk Koding dan Kecerdasan Artifisial.' },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1584,
    totalJPWajibPlusLokal: 1656,
  },
  // Tabel 25 — SMALB Kelas XI
  {
    jenjangSLB: 'SMALB', kelas: 'XI', fase: 'F', asumsiMinggu: 36, asumsiJPMenit: 40,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Matematika', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 54, jpKokurikuler: 18, jpTotal: 72 },
      { nama: 'Kelompok Keterampilan', jpIntrakurikuler: 720, jpKokurikuler: 216, jpTotal: 936, catatan: 'Peserta didik memilih 1 keterampilan. Termasuk Koding dan Kecerdasan Artifisial.' },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 72, jpKokurikuler: 0, jpTotal: 72 },
    ],
    totalJPWajib: 1656,
    totalJPWajibPlusLokal: 1728,
  },
  // Tabel 26 — SMALB Kelas XII
  {
    jenjangSLB: 'SMALB', kelas: 'XII', fase: 'F', asumsiMinggu: 32, asumsiJPMenit: 40,
    mataPelajaranWajib: [
      { nama: 'Pendidikan Agama dan Budi Pekerti', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Pendidikan Pancasila', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Bahasa Indonesia', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Matematika', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Ilmu Pengetahuan Alam', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Ilmu Pengetahuan Sosial', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Bahasa Inggris', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Pendidikan Jasmani Olahraga dan Kesehatan', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Seni dan Budaya', jpIntrakurikuler: 48, jpKokurikuler: 16, jpTotal: 64 },
      { nama: 'Kelompok Keterampilan', jpIntrakurikuler: 640, jpKokurikuler: 192, jpTotal: 832, catatan: 'Peserta didik memilih 1 keterampilan. Termasuk Koding dan Kecerdasan Artifisial.' },
      { nama: 'Program Kebutuhan Khusus', jpIntrakurikuler: 64, jpKokurikuler: 0, jpTotal: 64 },
    ],
    totalJPWajib: 1472,
    totalJPWajibPlusLokal: 1536,
  },
];

// ---------------------------------------------------------------------------
// Struktur Kurikulum Pendidikan Kesetaraan (Tabel 27-29)
// ---------------------------------------------------------------------------

export type ProgramKesetaraan = 'Paket A' | 'Paket B' | 'Paket C';

export interface StrukturKurikulumKesetaraan {
  program: ProgramKesetaraan;
  jenjangSetara: Jenjang;
  fase: string;
  totalSKK: number;
  catatan: string;
}

export const KURIKULUM_KESETARAAN: StrukturKurikulumKesetaraan[] = [
  {
    program: 'Paket A',
    jenjangSetara: 'SD',
    fase: 'A, B, C',
    totalSKK: 220,
    catatan: 'Fase A (Kelas I-II) = 64 SKK, Fase B (Kelas III-IV) = 78 SKK, Fase C (Kelas V-VI) = 78 SKK. Muatan pemberdayaan dan keterampilan dilaksanakan sebagai Kokurikuler.',
  },
  {
    program: 'Paket B',
    jenjangSetara: 'SMP',
    fase: 'D',
    totalSKK: 115,
    catatan: 'Fase D (Kelas VII-IX) = 115 SKK. Muatan pemberdayaan dan keterampilan dilaksanakan sebagai Kokurikuler.',
  },
  {
    program: 'Paket C',
    jenjangSetara: 'SMA',
    fase: 'E, F',
    totalSKK: 132,
    catatan: 'Fase E (Kelas X) = 46 SKK, Fase F (Kelas XI-XII) = 86 SKK. Peserta didik memilih mata pelajaran pilihan sesuai ketentuan SMA.',
  },
];

// ---------------------------------------------------------------------------
// Daftar seluruh mata pelajaran per jenjang (untuk validasi & lookup)
// ---------------------------------------------------------------------------

export const MATA_PELAJARAN_SD = [
  'Pendidikan Agama dan Budi Pekerti',
  'Pendidikan Pancasila',
  'Bahasa Indonesia',
  'Matematika',
  'Ilmu Pengetahuan Alam dan Sosial',
  'Pendidikan Jasmani Olahraga dan Kesehatan',
  'Seni dan Budaya',
  'Bahasa Inggris',
  'Muatan Lokal',
  // Pilihan (mulai Kelas V)
  'Koding dan Kecerdasan Artifisial',
] as const;

export const MATA_PELAJARAN_SMP = [
  'Pendidikan Agama dan Budi Pekerti',
  'Pendidikan Pancasila',
  'Bahasa Indonesia',
  'Matematika',
  'Ilmu Pengetahuan Alam',
  'Ilmu Pengetahuan Sosial',
  'Bahasa Inggris',
  'Pendidikan Jasmani Olahraga dan Kesehatan',
  'Informatika',
  'Seni, Budaya, dan Prakarya',
  'Muatan Lokal',
  // Pilihan
  'Koding dan Kecerdasan Artifisial',
] as const;

export const MATA_PELAJARAN_SMA = [
  'Pendidikan Agama dan Budi Pekerti',
  'Pendidikan Pancasila',
  'Bahasa Indonesia',
  'Matematika',
  'Bahasa Inggris',
  'Pendidikan Jasmani Olahraga dan Kesehatan',
  'Sejarah',
  'Seni dan Budaya',
  'Seni, Budaya, dan Prakarya',
  'Informatika',
  'Ilmu Pengetahuan Alam',
  'Ilmu Pengetahuan Sosial',
  'Muatan Lokal',
  // Pilihan
  'Biologi', 'Fisika', 'Kimia', 'Ekonomi', 'Geografi', 'Sosiologi',
  'Matematika Tingkat Lanjut', 'Bahasa Inggris Tingkat Lanjut',
  'Bahasa Indonesia Tingkat Lanjut', 'Sejarah Tingkat Lanjut',
  'Antropologi', 'Prakarya dan Kewirausahaan',
  'Koding dan Kecerdasan Artifisial',
  'Bahasa Arab', 'Bahasa Jepang', 'Bahasa Jerman',
  'Bahasa Korea', 'Bahasa Mandarin', 'Bahasa Prancis',
] as const;

// ---------------------------------------------------------------------------
// Helper: get structure by jenjang
// ---------------------------------------------------------------------------

export function getStrukturByJenjang(jenjang: Jenjang): StrukturKurikulumKelas[] {
  switch (jenjang) {
    case 'SD':
      return KURIKULUM_SD;
    case 'SMP':
      return KURIKULUM_SMP;
    case 'SMA':
      return KURIKULUM_SMA;
    default:
      return [];
  }
}

export function getStrukturByFase(fase: Fase): StrukturKurikulumKelas[] {
  const all = [...KURIKULUM_SD, ...KURIKULUM_SMP, ...KURIKULUM_SMA];
  return all.filter((s) => s.fase === fase);
}

export function getMataPelajaranByJenjang(jenjang: Jenjang): readonly string[] {
  switch (jenjang) {
    case 'SD':
      return MATA_PELAJARAN_SD;
    case 'SMP':
      return MATA_PELAJARAN_SMP;
    case 'SMA':
      return MATA_PELAJARAN_SMA;
    case 'SMK':
      return MATA_PELAJARAN_SMK;
    default:
      return [];
  }
}

export function getStrukturSMK(): StrukturKurikulumSMKKelas[] {
  return KURIKULUM_SMK;
}

export function getStrukturSLB(jenjangSLB: JenjangSLB): StrukturKurikulumSLBKelas[] {
  switch (jenjangSLB) {
    case 'SDLB':
      return KURIKULUM_SDLB;
    case 'SMPLB':
      return KURIKULUM_SMPLB;
    case 'SMALB':
      return KURIKULUM_SMALB;
    default:
      return [];
  }
}

export function getStrukturKesetaraan(program?: ProgramKesetaraan): StrukturKurikulumKesetaraan[] {
  if (program) {
    return KURIKULUM_KESETARAAN.filter((k) => k.program === program);
  }
  return KURIKULUM_KESETARAAN;
}

