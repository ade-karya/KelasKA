---
name: tka-sma-smk-asesmen
title: "Kerangka Asesmen TKA SMA/SMK (评估框架)"
description: "Tes Kemampuan Akademik SMA/MA dan SMK/MAK per 045/H/AN/2025 plus mata uji Program Keahlian SMK. Use when the user asks for TKA SMA, TKA SMK, kerangka asesmen 045/H/AN/2025, mata uji wajib Bahasa Indonesia Matematika Bahasa Inggris, mata uji pilihan, fisika kimia biologi, PPKn ekonomi geografi sosiologi sejarah antropologi, bahasa asing, produk kreatif kewirausahaan, program keahlian SMK, level kognitif Knowing Applying Reasoning, PG PGK MCMA kategori, or wants a classroom/quiz aligned to the SMA/SMK framework."
---

# Kerangka Asesmen TKA SMA/SMK

Sumber ganda, keduanya terverifikasi via MinerU T4: (1) Peraturan Kepala BSKAP
No. 045/H/AN/2025 (14 Juli 2025) untuk mapel umum SMA/MA/sederajat dan
SMK/MAK; (2) Peraturan Kepala BKPDM No. 1 Tahun 2026 untuk Mata Uji Program
Keahlian SMK/MAK (50 program keahlian, kompetensi fondasi, mengacu CP
046/H/KR/2025 Fase E dengan sebagian rujukan Fase F). TKA bukan
penentu kelulusan; kelulusan tetap wewenang satuan pendidikan.

Gunakan skill ini untuk merancang **satu stage OpenMAIC** yang selaras TKA
SMA/SMK. `stage-design` mengatur urutan persistensi; skill ini mengatur isi
dan pedagogi setiap brief.

## Cara memakai

- Tanpa argumen — muat kerangka inti di bawah.
- Dengan mapel — mis. `fisika`, `kimia`, `ekonomi`, `PPLG` — baca file
  `references/` yang relevan sebelum menjawab.
- Dengan jenjang — `SMA` atau `SMK program keahlian X` — batasi muatan pada
  regulasi itu saja.
- Saat menyentuh muatan di luar ringkasan inti, baca referensi yang ditunjuk
  dulu. Jangan mengarang nomor pasal, batasan materi, atau kunci.

## Kerangka inti

### I. Posisi dan tujuan

- TKA memberi skor terstandar yang dapat dibandingkan lintas satuan
  pendidikan untuk seleksi (dalam/luar negeri), pemetaan mutu akhir jenjang
  (melengkapi Asesmen Nasional), pengakuan kesetaraan nonformal/informal,
  dan informasi kredibel bagi dunia kerja.
- Nilai rapor tidak sebanding antar sekolah karena standar berbeda; penilaian
  internal cenderung lebih tinggi dan kurang bervariasi. Klaim ini dikonfirmasi
  panitia seleksi PTN.
- Risiko: penyempitan kurikulum. TKA hanya mengukur sebagian kompetensi.
  Pakai TKA sebagai acuan merancang pembelajaran dan model menilai
  pemahaman konseptual, pemecahan masalah, dan HOTS — bukan satu-satunya
  tujuan belajar.
- Khusus SMK: TKA 2025 masih memakai mapel SMA sehingga kekhasan vokasi
  belum terwakili. Mata Uji Program Keahlian kini mengukur **kompetensi
  fondasi** (irisan konsentrasi keahlian per program, 50 program), adaptif
  terhadap perubahan teknologi dan dunia kerja, sebagai penjaminan mutu dan
  arah perbaikan pembelajaran — tetap bukan penentu kelulusan.

### II. Mata uji dan jenis soal

- Wajib SMA/SMK: **Bahasa Indonesia, Matematika, Bahasa Inggris** (semuanya
  dikerjakan) + **dua pilihan** sesuai prodi/karir. Daftar 19 pilihan:
  B. Indonesia lanjut, Matematika lanjut, B. Inggris lanjut, Fisika, Kimia,
  Biologi, Pendidikan Pancasila dan Kewarganegaraan/Pendidikan Pancasila, Ekonomi, Geografi, Sosiologi, Sejarah,
  Antropologi, Bahasa Prancis, Jerman, Jepang, Mandarin, Korea, Arab,
  Produk/Projek Kreatif dan Kewirausahaan (SMK).
- Program Keahlian SMK: 50 program (daftar di
  `references/muatan-smk-keahlian.md`), dari Teknik Perawatan Gedung hingga
  Busana.
- Jenis soal: SMA tiap mapel ada **tunggal** (berdiri sendiri) dan **grup**
  (satu stimulus, beberapa butir). SMK Program Keahlian: **soal tunggal**
  saja (Perka BKPDM 1/2026 — "jenis soal pada setiap mata uji berupa soal
  tunggal"; mapel umum SMK tetap ikut kerangka 045/H/AN/2025).
- Bentuk soal selalu tiga: **PG sederhana** (satu benar), **PGK MCMA**
  (benar lebih dari satu), **PGK kategori** (Benar/Salah, Sesuai/Tidak
  Sesuai, Setuju/Tidak Setuju, Tepat/Tidak Tepat per baris).
- Setiap butir wajib bermetadata. SMA: Kompetensi/Subkompetensi + Level
  Kognitif + Bentuk Soal + Jenis (tunggal/grup). SMK Program Keahlian memakai
  6 kolom resmi: No. Soal, Elemen/Materi, Sub-elemen/Submateri, Kompetensi,
  Level Kognitif, Bentuk Soal (label resmi "Pilihan Ganda"). Tulis metadata di
  `brief`, bukan di teks learner.

### III. Tiga kompetensi membaca (B. Indonesia dan B. Inggris; 6 bahasa asing memakai Pemahaman Literal / Reorganisasi / Pemahaman Inferensial)

1. **Tekstual** — eksplisit: identifikasi, klasifikasi, kerangka/bagan,
   ringkas, sintesis.
2. **Inferensial** — tersirat: ide pokok, hubungan antarkalimat/paragraf,
   prediksi, perbandingan, sebab-akibat, karakter, sudut pandang penulis.
3. **Evaluasi–apresiasi** — nilai: relevansi, fakta vs opini, kecukupan dan
   validitas, kesesuaian bagian teks, kekuatan argumen, tanggapan kritis atau
   emosional.

Karakteristik pembeda SMA: B. Indonesia 250–300 kata, kalimat 8–12 kata
kompleks + inversi, fiksi realisme/absurd penyelesaian terbuka POV campuran;
B. Inggris B1 250–350 kata / A2 200–300 kata, teks descriptive–recount–
narrative–procedure–analytical exposition; tingkat lanjut B2 300–400 kata,
exposition–discussion teknologi dan isu faktual.

### IV. Level kognitif

- Matematika (wajib dan lanjut): L1 Knowing–Understanding (Menghitung,
  Memahami informasi, Mengelompokkan, Mengidentifikasi), L2 Applying
  (Memodelkan, Menerapkan, Menginterpretasikan), L3 Reasoning (Menganalisis,
  Memecahkan masalah, Mengevaluasi, Menyimpulkan, Generalisasi,
  Menjustifikasi).
- Sains/IPS: Knowing (mengenali–menjelaskan–contoh), Applying
  (membandingkan–menginterpretasikan model/informasi), Reasoning
  (memprediksi–merancang–mengevaluasi–menyimpulkan–menganalisis–
  generalisasi–justifikasi). Pengecualian label resmi: **Geografi memakai
  Pemahaman / Penerapan / Penalaran**; **6 bahasa asing memakai Pemahaman
  Literal / Reorganisasi / Pemahaman Inferensial** (bukan Knowing–Applying–
  Reasoning). Fisika memakai label Pemahaman / Penerapan /
  Analisis-Evaluasi + keterampilan proses sains (mengamati, mempertanyakan–
  memprediksi, merencanakan–menyelidiki, menganalisis–mengomunikasikan
  data). Biologi memakai Pemahaman / Penerapan / Penalaran + inkuiri.
- SMK Program Keahlian (label resmi: **Pengetahuan dan Pemahaman /
  Aplikasi / Penalaran**): L1 (Memahami–Mengidentifikasi–Menjelaskan–
  Mendeskripsikan–Mengenali), L2 (Menerapkan–Menggunakan–Menghitung–
  Mengoperasikan–Menginterpretasikan–Mengklasifikasikan), L3 (Menganalisis–
  Membandingkan–Mengevaluasi–Menyimpulkan–Memecahkan masalah–Merencanakan).
  Satu sub-elemen bisa diukur di beberapa level kognitif.
  Elemen fondasi berulang: wawasan dunia kerja, K3LH dan budaya kerja 5R/5S,
  teknik dasar dan gambar teknik (hanya 14 program teknik; rumpun lain memakai
  sketsa, desain 2D/3D, fotografi, atau tanpa gambar).

## Indeks muatan

| Kelompok | File |
|---|---|
| Wajib SMA/SMK: B. Indonesia, Matematika, B. Inggris | [references/muatan-sma-wajib.md](references/muatan-sma-wajib.md) |
| Pilihan: lanjut + sains + IPS + bahasa asing + produk kreatif | [references/muatan-sma-pilihan.md](references/muatan-sma-pilihan.md) |
| SMK: 50 program keahlian, pola fondasi + batasan | [references/muatan-smk-keahlian.md](references/muatan-smk-keahlian.md) |
| Jenis/bentuk soal + level kognitif per rumpun | [references/bentuk-soal-level.md](references/bentuk-soal-level.md) |
| Contoh soal resmi + kunci | [references/contoh-soal-sma.md](references/contoh-soal-sma.md) |

## Merancang stage selaras TKA SMA/SMK

Tetapkan dulu tiga hal ini secara berurutan (jenjang → kategori →
nama mapel), lalu baca dengan tool `read` asli:

1. [references/bentuk-soal-level.md](references/bentuk-soal-level.md), selalu;
2. tepat satu muatan yang cocok (wajib, pilihan, atau SMK keahlian);
3. [references/contoh-soal-sma.md](references/contoh-soal-sma.md) saat menulis
   butir baru, sebagai model format dan kunci.

Alur pertanyaan penentu (wajib tiga langkah, satu pertanyaan per
panggilan `ask_user`, berurutan — jangan digabung dalam satu panggilan):

1. **Jenjang:** tanyakan tingkat — SD/MI, SMP/MTs, SMA/MA, atau SMK/MAK
   (untuk SMK, tanyakan juga nama program keahliannya). Jika jawaban
   SD/MI atau SMP/MTs, alihkan ke skill `tka-sd-smp-asesmen` dan ikuti
   alur di sana. Skill ini hanya mencakup SMA/MA dan SMK/MAK.
2. **Kategori mata pelajaran:** tanyakan Wajib, Pilihan, atau (khusus
   SMK) Program Keahlian. Wajib SMA/SMK: Bahasa Indonesia, Matematika,
   Bahasa Inggris (semuanya dikerjakan) + dua pilihan. Pilihan (19):
   B. Indonesia lanjut, Matematika lanjut, B. Inggris lanjut, Fisika,
   Kimia, Biologi, Pendidikan Pancasila, Ekonomi, Geografi, Sosiologi,
   Sejarah, Antropologi, Bahasa Prancis, Jerman, Jepang, Mandarin,
   Korea, Arab, Produk/Projek Kreatif dan Kewirausahaan (SMK).
   Program Keahlian SMK: 50 program — lihat
   `references/muatan-smk-keahlian.md`.
3. **Nama mata pelajaran:** tanyakan mata pelajarannya sesuai kategori
   yang dipilih pada langkah 2 (untuk SMK Program Keahlian: nama
   program keahliannya).

Default jika pengguna tidak menjawab: SMA Bahasa Indonesia wajib,
stimulus 250–300 kata, satu grup 2–3 butir. Jangan tanyakan ulang yang
sudah ada di permintaan atau materi.

Nyatakan kontrak belajar sebelum daftar halaman:

> Learner akan **mengerjakan X** agar **kompetensi/level Y** teramati melalui
> **bukti Z**.

Target lemah seperti "memahami" bukan kontrak. Pakai verba terlihat:
mengidentifikasi, menyusun bagan, menyimpulkan, menilai, memodelkan,
menerapkan, menganalisis, mengevaluasi, menjustifikasi.

Alur halaman default 6–10 halaman: `slide` situasi autentik + tugas akhir;
`slide` stimulus (teks/grafik/konteks vokasional); `interactive` observasi
atau manipulasi satu mekanisme; `quiz` diagnosis miskonsepsi + alasan dengan
butir PG/PGK dan distraktor dari miskonsepsi nyata; `interactive` atau tugas
menghasilkan penjelasan, model, keputusan, atau bagan; `slide` kriteria sukses
+ scaffold; `quiz` atau tugas transfer ke kasus baru; `slide` penutup opsional.
Judul menamai temuan learner, bukan label materi.

## Eksekusi stage baru

Setelah rencana disetujui lewat `ask_user`:

1. `create_stage` dengan judul disepakati (sertakan `folderId` bila seri).
2. `set_roster` sebelum halaman apa pun. Tepat satu guru, minimal dua agen;
   guru memegang metode mapel, peran lain memunculkan miskonsepsi atau meminta
   bukti. Jaga register sesuai jenjang.
3. Panggil `generate_scene` sekali per halaman yang disetujui, urut naik.
   Setiap `brief` mandiri: target kompetensi atau elemen + level kognitif, apa
   yang dilihat learner, aksi learner, miskonsepsi dan scaffold, bukti asesmen,
   serah terima ke halaman berikut. Fakta dari materi terlampir hanya lewat
   `materialFacts` yang terverifikasi.
4. `list_scenes` untuk memastikan semua halaman ada dan berurutan benar.
5. Baca aksi narasi. Panggil `generate_tts` pada halaman yang ucapannya baru,
   berubah, atau tanpa `audioId`.

Akhir putaran hanya di gerbang `ask_user`, setelah halaman tersimpan, atau
saat stage lolos pemeriksaan.

## Adaptasi stage yang sudah ada

1. `list_scenes`, lalu `read_stage` halaman relevan sebelum menulis.
2. Audit: kesesuaian jenjang, kesinambungan stimulus grup, keselarasan
   aktivitas–asesmen, kesulitan tahap sekolah, bukti teramati.
3. Perbaiki hanya halaman yang melanggar kontrak. Utamakan stimulus terbuang,
   kesimpulan diumumkan sebelum inkuiri, produk learner tak teramati, kuis
   hafalan.
4. Gunakan `patch_stage` untuk suntingan sempit dan `edit_deck` untuk ubahan
   daftar halaman. Tulis ulang penuh hanya bila diminta eksplisit.
5. Jalankan ulang `generate_tts` setelah ucapan berubah, baca kembali halaman
   yang disentuh, tutup dengan `list_scenes`.

Gunakan `grep_stage` untuk menemukan halaman pemuat istilah, dan
`list_materials` + `read_material` untuk memverifikasi klaim terhadap sumber
pengguna. Materi pengguna adalah masukan disetujui, bukan teks bebas.

## Pemeriksaan selesai

Jangan nyatakan selesai sebelum semua benar: wording jenjang–mapel benar;
satu–dua kompetensi tampil sebagai aksi dan bukti; stimulus grup bertahan
hingga transfer; semua halaman ada, berisi, berurutan; bukti diperoleh minimal
sekali; ada artefak terperiksa; miskonsepsi ditangani; asesmen sejenis tugas
plus transfer; narasi cocok dan audio lengkap; tidak ada kutipan, fakta
sumber, atau kunci yang dikarang.

Tutup satu–dua kalimat: sebut kompetensi primer dan tugas performa yang
membuatnya terlihat.

## Batasan

Mencakup Perka BSKAP 045/H/AN/2025 (14 Juli 2025; mapel umum SMA/MA dan
SMK/MAK) dan Perka BKPDM 1/2026 (Mata Uji Program Keahlian SMK/MAK;
tanggal penetapan tak terbaca — cover salinan berupa pindaian). Tabel penuh
50 program diringkas pada pola fondasi; detail dan batasan per program ada di
regulasi sumber (CP 046/H/KR/2025 Fase E, sebagian merujuk Fase F; contoh
resmi ±300 butir, 6 per program). Batasan larangan bersifat per-rumpun, bukan
umum — cek `references/muatan-smk-keahlian.md` sebelum menulis butir SMK. Untuk implementasi di codebase, gabungkan
dengan tool project. Topik di luar TKA: periksa skill terkait atau tanyakan
langsung.
