/**
 * Standar Proses — Permendikdasmen No. 1 Tahun 2026
 *
 * Peraturan Menteri Pendidikan Dasar dan Menengah
 * Republik Indonesia Nomor 1 Tahun 2026 tentang
 * Standar Proses pada Pendidikan Anak Usia Dini,
 * Jenjang Pendidikan Dasar, dan Jenjang Pendidikan Menengah.
 *
 * Ditetapkan di Jakarta, 2 Januari 2026.
 * Diundangkan di Jakarta, 5 Januari 2026.
 * Berita Negara Republik Indonesia Tahun 2026 Nomor 1.
 *
 * Sumber: jdih.kemendikdasmen.go.id
 */

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const STANDAR_PROSES_META = {
  id: 'permendikdasmen-1-2026',
  nomor: 'Nomor 1 Tahun 2026',
  judul: 'Standar Proses pada Pendidikan Anak Usia Dini, Jenjang Pendidikan Dasar, dan Jenjang Pendidikan Menengah',
  jenis: 'Peraturan Menteri Pendidikan Dasar dan Menengah',
  tanggalDitetapkan: '2026-01-02',
  tanggalDiundangkan: '2026-01-05',
  beritaNegara: 'Tahun 2026 Nomor 1',
  sumber: 'jdih.kemendikdasmen.go.id',
  mencabut: [
    'Permendiknas Nomor 3 Tahun 2008 tentang Standar Proses Pendidikan Kesetaraan Program Paket A, Program Paket B, dan Program Paket C',
    'Permendikbudristek Nomor 16 Tahun 2022 tentang Standar Proses pada PAUD, Jenjang Pendidikan Dasar, dan Jenjang Pendidikan Menengah',
  ],
} as const;

// ---------------------------------------------------------------------------
// Ketentuan Umum (Pasal 1)
// ---------------------------------------------------------------------------

export const KETENTUAN_UMUM = {
  standarProses:
    'Kriteria minimal proses pembelajaran berdasarkan jalur, jenjang, dan jenis pendidikan untuk mencapai standar kompetensi lulusan.',
  murid:
    'Peserta didik pada jalur pendidikan formal, nonformal, dan informal pada pendidikan anak usia dini, jenjang pendidikan dasar, dan jenjang pendidikan menengah dari setiap jenis pendidikan.',
  pendidik:
    'Tenaga kependidikan yang berpartisipasi dalam menyelenggarakan pendidikan.',
  satuanPendidikan:
    'Kelompok layanan pendidikan yang menyelenggarakan pendidikan pada jalur formal, nonformal, dan informal pada setiap jenjang dan jenis pendidikan.',
} as const;

// ---------------------------------------------------------------------------
// Prinsip Pembelajaran (Pasal 3)
// ---------------------------------------------------------------------------

export interface PrinsipPembelajaran {
  id: string;
  label: string;
  deskripsi: string;
  pasal: string;
}

export const PRINSIP_PEMBELAJARAN: PrinsipPembelajaran[] = [
  {
    id: 'berkesadaran',
    label: 'Berkesadaran',
    deskripsi:
      'Proses pembelajaran yang membantu murid memahami tujuan pembelajaran sehingga termotivasi, aktif belajar, dan mampu mengatur diri sendiri.',
    pasal: 'Pasal 3 ayat (2)',
  },
  {
    id: 'bermakna',
    label: 'Bermakna',
    deskripsi:
      'Proses pembelajaran yang terjadi ketika Murid dapat menerapkan apa yang dipelajari dan membangun pengetahuan baru dalam kehidupan nyata, secara kontekstual, dan/atau yang terkait bidang ilmu lain.',
    pasal: 'Pasal 3 ayat (3)',
  },
  {
    id: 'menggembirakan',
    label: 'Menggembirakan',
    deskripsi:
      'Proses pembelajaran yang positif, menantang, menyenangkan, dan memotivasi.',
    pasal: 'Pasal 3 ayat (4)',
  },
];

// ---------------------------------------------------------------------------
// Perencanaan Pembelajaran (Pasal 4-8)
// ---------------------------------------------------------------------------

export interface KomponenPerencanaan {
  id: string;
  label: string;
  deskripsi: string;
  pasal: string;
}

export const PERENCANAAN_PEMBELAJARAN: KomponenPerencanaan[] = [
  {
    id: 'tujuan-pembelajaran',
    label: 'Tujuan Pembelajaran',
    deskripsi:
      'Kompetensi dan konten pada ruang lingkup materi pembelajaran yang harus dicapai oleh Murid, mengacu pada standar kompetensi lulusan dan standar isi dengan mempertimbangkan karakteristik Murid dan sumber daya Satuan Pendidikan.',
    pasal: 'Pasal 6',
  },
  {
    id: 'langkah-pembelajaran',
    label: 'Langkah Pembelajaran',
    deskripsi:
      'Tahapan yang dirancang untuk memberi pengalaman belajar kepada Murid dalam rangka mencapai tujuan pembelajaran.',
    pasal: 'Pasal 7',
  },
  {
    id: 'penilaian-asesmen',
    label: 'Penilaian atau Asesmen Pembelajaran',
    deskripsi:
      'Dilakukan oleh Pendidik dengan menggunakan beragam teknik dan/atau instrumen penilaian atau asesmen yang sesuai dengan tujuan pembelajaran. Mengacu pada standar penilaian pendidikan.',
    pasal: 'Pasal 8',
  },
];

// ---------------------------------------------------------------------------
// Pelaksanaan Pembelajaran (Pasal 9-14)
// ---------------------------------------------------------------------------

export interface SuasanaBelajar {
  id: string;
  label: string;
}

export const SUASANA_BELAJAR: SuasanaBelajar[] = [
  { id: 'interaktif', label: 'Interaktif' },
  { id: 'inspiratif', label: 'Inspiratif' },
  { id: 'menyenangkan', label: 'Menyenangkan' },
  { id: 'menantang', label: 'Menantang' },
  { id: 'memotivasi', label: 'Memotivasi Murid untuk berpartisipasi aktif' },
  {
    id: 'ruang-prakarsa',
    label:
      'Memberikan ruang yang cukup bagi prakarsa, kreativitas, kemandirian sesuai dengan bakat, minat, dan perkembangan fisik, serta psikologis Murid',
  },
];

export interface PeranPendidik {
  id: string;
  label: string;
  deskripsi: string;
  pasal: string;
}

export const PERAN_PENDIDIK: PeranPendidik[] = [
  {
    id: 'keteladanan',
    label: 'Keteladanan',
    deskripsi:
      'Menunjukkan perilaku mulia dalam kehidupan sehari-hari; menunjukkan sikap terbuka, saling menghargai, dan bersedia bekerja bersama Murid dalam proses pembelajaran.',
    pasal: 'Pasal 9 ayat (4)',
  },
  {
    id: 'pendampingan',
    label: 'Pendampingan',
    deskripsi:
      'Memberikan dukungan dan bimbingan bagi Murid dalam proses belajar; mendorong Murid untuk membangun pengetahuan secara aktif dengan memanfaatkan berbagai sumber belajar.',
    pasal: 'Pasal 9 ayat (5)',
  },
  {
    id: 'fasilitasi',
    label: 'Fasilitasi',
    deskripsi:
      'Menyediakan akses dan kesempatan belajar bagi Murid sesuai dengan kebutuhan; memberikan ruang kepada Murid untuk menciptakan strategi belajarnya sendiri.',
    pasal: 'Pasal 9 ayat (6)',
  },
];

// ---------------------------------------------------------------------------
// Pengalaman Belajar (Pasal 10)
// ---------------------------------------------------------------------------

export interface PengalamanBelajar {
  id: string;
  label: string;
  deskripsi: string;
  pasal: string;
}

export const PENGALAMAN_BELAJAR: PengalamanBelajar[] = [
  {
    id: 'memahami',
    label: 'Memahami',
    deskripsi:
      'Pengalaman belajar yang melibatkan Murid untuk membangun sikap, pengetahuan, dan keterampilan dari berbagai sumber dan konteks.',
    pasal: 'Pasal 10 ayat (2)',
  },
  {
    id: 'mengaplikasi',
    label: 'Mengaplikasi',
    deskripsi:
      'Pengalaman belajar yang melibatkan Murid untuk menggunakan pengetahuan dalam situasi kehidupan nyata dan kontekstual.',
    pasal: 'Pasal 10 ayat (3)',
  },
  {
    id: 'merefleksi',
    label: 'Merefleksi',
    deskripsi:
      'Aktivitas Murid mengevaluasi dan memaknai proses serta hasil belajar, serta mengatur diri sendiri agar mampu belajar secara mandiri.',
    pasal: 'Pasal 10 ayat (4)',
  },
];

// ---------------------------------------------------------------------------
// Kerangka Pembelajaran (Pasal 12)
// ---------------------------------------------------------------------------

export interface KerangkaPembelajaran {
  id: string;
  label: string;
  deskripsi: string;
  pasal: string;
}

export const KERANGKA_PEMBELAJARAN: KerangkaPembelajaran[] = [
  {
    id: 'praktik-pedagogis',
    label: 'Praktik Pedagogis',
    deskripsi:
      'Strategi pembelajaran dan penilaian yang berfokus pada pengalaman belajar untuk mencapai tujuan pembelajaran.',
    pasal: 'Pasal 12 ayat (2)',
  },
  {
    id: 'kemitraan-pembelajaran',
    label: 'Kemitraan Pembelajaran',
    deskripsi:
      'Kegiatan membangun hubungan kolaboratif antara Pendidik dan Pendidik serta antara Pendidik, Murid, tenaga kependidikan, orang tua, masyarakat, dan/atau mitra lain yang relevan.',
    pasal: 'Pasal 12 ayat (3)',
  },
  {
    id: 'lingkungan-pembelajaran',
    label: 'Lingkungan Pembelajaran',
    deskripsi:
      'Segala kondisi fisik, virtual, dan sosial yang mendukung suasana belajar aman, nyaman, dan inklusif untuk mewujudkan budaya belajar.',
    pasal: 'Pasal 12 ayat (4)',
  },
  {
    id: 'pemanfaatan-teknologi',
    label: 'Pemanfaatan Teknologi',
    deskripsi:
      'Optimalisasi penggunaan sumber daya teknologi baik digital maupun nondigital untuk menciptakan pembelajaran yang interaktif, kolaboratif, dan kontekstual.',
    pasal: 'Pasal 12 ayat (5)',
  },
];

// ---------------------------------------------------------------------------
// Penilaian Proses Pembelajaran (Pasal 15-19)
// ---------------------------------------------------------------------------

export interface PenilaianProses {
  id: string;
  label: string;
  deskripsi: string;
  pasal: string;
}

export const PENILAIAN_PROSES_PEMBELAJARAN: PenilaianProses[] = [
  {
    id: 'refleksi-diri',
    label: 'Refleksi Diri oleh Pendidik',
    deskripsi:
      'Asesmen terhadap perencanaan dan pelaksanaan pembelajaran oleh Pendidik yang bersangkutan melalui refleksi diri, paling sedikit 1 kali dalam 1 semester. Dapat mengacu pada analisis asesmen hasil belajar Murid atau asesmen berskala nasional.',
    pasal: 'Pasal 15',
  },
  {
    id: 'sesama-pendidik',
    label: 'Penilaian oleh Sesama Pendidik',
    deskripsi:
      'Asesmen oleh sesama Pendidik atas perencanaan dan pelaksanaan pembelajaran, bertujuan membangun budaya saling belajar, kerja sama, dan saling mendukung. Dilakukan melalui diskusi, pengamatan, dan refleksi.',
    pasal: 'Pasal 17',
  },
  {
    id: 'kepala-satuan',
    label: 'Penilaian oleh Kepala Satuan Pendidikan',
    deskripsi:
      'Asesmen oleh kepala Satuan Pendidikan untuk membangun budaya reflektif dan memberi umpan balik yang konstruktif. Dilakukan melalui supervisi akademik, analisis hasil belajar Murid, dan pemberian umpan balik.',
    pasal: 'Pasal 18',
  },
  {
    id: 'oleh-murid',
    label: 'Penilaian oleh Murid',
    deskripsi:
      'Asesmen oleh Murid atas pelaksanaan pembelajaran, bertujuan mengembangkan kemandirian dan tanggung jawab serta membangun suasana pembelajaran yang partisipatif dan saling menghargai. Dilakukan melalui survei, catatan, dan/atau diskusi refleksi.',
    pasal: 'Pasal 19',
  },
];

// ---------------------------------------------------------------------------
// Helper: Build context string for AI prompts
// ---------------------------------------------------------------------------

/**
 * Build a formatted Standar Proses context string suitable for inclusion
 * in AI prompts. This provides the LLM with the regulatory framework
 * for learning process design.
 */
export function buildStandarProsesContext(): string {
  const prinsip = PRINSIP_PEMBELAJARAN.map(
    (p) => `  • ${p.label}: ${p.deskripsi}`,
  ).join('\n');

  const pengalaman = PENGALAMAN_BELAJAR.map(
    (p) => `  • ${p.label}: ${p.deskripsi}`,
  ).join('\n');

  const kerangka = KERANGKA_PEMBELAJARAN.map(
    (k) => `  • ${k.label}: ${k.deskripsi}`,
  ).join('\n');

  const suasana = SUASANA_BELAJAR.map((s) => `  • ${s.label}`).join('\n');

  return [
    `📜 STANDAR PROSES (${STANDAR_PROSES_META.jenis} ${STANDAR_PROSES_META.nomor})`,
    `${STANDAR_PROSES_META.judul}`,
    ``,
    `Prinsip Pembelajaran (Pasal 3):`,
    prinsip,
    ``,
    `Pengalaman Belajar (Pasal 10):`,
    pengalaman,
    ``,
    `Kerangka Pembelajaran (Pasal 12):`,
    kerangka,
    ``,
    `Suasana Belajar yang harus diciptakan (Pasal 9):`,
    suasana,
    ``,
    `Peran Pendidik: keteladanan, pendampingan, dan fasilitasi.`,
    `Suasana belajar diciptakan melalui lingkungan belajar yang aman, nyaman, dan inklusif.`,
  ].join('\n');
}

/**
 * Get a summary of the Standar Proses regulation for display purposes.
 */
export function getStandarProsesSummary(): string {
  return `${STANDAR_PROSES_META.jenis} ${STANDAR_PROSES_META.nomor} tentang ${STANDAR_PROSES_META.judul}. Ditetapkan ${STANDAR_PROSES_META.tanggalDitetapkan}. Mencakup perencanaan, pelaksanaan, dan penilaian proses pembelajaran dengan prinsip berkesadaran, bermakna, dan menggembirakan.`;
}
