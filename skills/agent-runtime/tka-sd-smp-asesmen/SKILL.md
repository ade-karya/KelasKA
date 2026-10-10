---
name: tka-sd-smp-asesmen
title: "Kerangka Asesmen TKA SD/SMP (评估框架)"
description: "Tes Kemampuan Akademik SD/MI dan SMP/MTs per Peraturan Kepala BSKAP 047/H/AN/2025. Use when the user asks for TKA, Tes Kemampuan Akademik, kerangka asesmen TKA, soal TKA SD/MI/sederajat atau SMP/MTs/sederajat, Bahasa Indonesia atau Matematika TKA, level kognitif Knowing Applying Reasoning, PG PGK MCMA kategori, or wants a classroom/quiz aligned to the official TKA framework."
---

# Kerangka Asesmen TKA SD/SMP

Sumber tunggal: Peraturan Kepala Badan Standar, Kurikulum, dan Asesmen Pendidikan
No. 047/H/AN/2025 (ditetapkan 24 Juli 2025) — Kerangka Asesmen Tes Kemampuan
Akademik jenjang SD/MI/sederajat dan SMP/MTs/sederajat. TKA bukan penentu
kelulusan; kelulusan tetap wewenang pendidik dan satuan pendidikan.

Gunakan skill ini untuk merancang **satu stage OpenMAIC** yang selaras TKA:
halaman, aktivitas learner, dan asesmen mengikuti muatan, kompetensi, level
kognitif, dan bentuk soal resmi. `stage-design` mengatur urutan persistensi;
skill ini mengatur pedagogi dan isi setiap brief.

## Cara memakai skill ini

- Tanpa argumen — muat kerangka inti di bawah untuk referensi.
- Dengan topik — mis. `bilangan rasional`, `pemahaman inferensial`, `peluang` —
  baca file `references/` yang relevan sebelum menjawab.
- Dengan jenjang — `SD` atau `SMP` — batasi muatan pada jenjang itu saja.
- Lihat daftar — tanyakan "muatan apa saja?" untuk indeks lengkap.

Saat pertanyaan menyentuh muatan di luar ringkasan inti, baca file referensi
yang ditunjuk sebelum menjawab. Jangan mengarang nomor pasal, batasan materi,
atau kunci jawaban.

## Kerangka inti

### I. Posisi dan tujuan TKA

- TKA menjawab kebutuhan pelaporan capaian akademik individu dari penilaian
  terstandar. Nilai rapor antar satuan pendidikan tidak dapat dibandingkan
  langsung karena standar berbeda; penilaian internal cenderung lebih tinggi
  dengan variasi lebih kecil dibanding penilaian eksternal.
- TKA memberi skor yang relatif dapat dibandingkan lintas satuan pendidikan
  untuk seleksi akademik, pemetaan mutu akhir jenjang (melengkapi Asesmen
  Nasional), dan pengakuan kesetaraan hasil belajar jalur nonformal/informal.
- Risiko yang harus dihindari: penyempitan kurikulum (hanya mengajar yang
  diujikan). TKA hanya mengukur sebagian kompetensi kurikulum.
- Cara pakai yang benar: jadikan TKA acuan merancang pembelajaran dan model
  menilai pemahaman konseptual, pemecahan masalah, dan bernalar tingkat tinggi.
  Jangan jadikan TKA sebagai daftar satu-satunya tujuan belajar.

### II. Mata uji, jenis, dan bentuk soal

- Mata uji SD/MI dan SMP/MTs: **Bahasa Indonesia** dan **Matematika**.
  Peserta mengerjakan keduanya.
- Jenis soal: **tunggal** (berdiri sendiri) vs **grup** (sekumpulan soal pada
  satu stimulus yang sama).
- Bentuk soal, selalu tiga ini:
  - **PG sederhana** — satu jawaban benar, pilih satu.
  - **PGK MCMA** (*multiple choice multiple answers*) — jawaban benar lebih
    dari satu, pilih semua yang benar.
  - **PGK kategori** — beri respons pada setiap pernyataan: Benar/Salah,
    Sesuai/Tidak Sesuai, Setuju/Tidak Setuju.
- Aturan penulisan butir TKA: setiap butir wajib membawa metadata
  Kompetensi/Subkompetensi (B. Indonesia) atau Elemen/Sub-elemen + Level
  Kognitif (Matematika) + Bentuk Soal. Tiru disiplin ini di setiap `quiz` yang
  dibuat: tulis metadata di `brief`, bukan di teks yang dibaca learner.

### III. Bahasa Indonesia — tiga kompetensi membaca

Berlaku untuk SD dan SMP; yang berbeda adalah karakteristik teks dan
subkompetensi (lihat `references/muatan-sd.md` dan `references/muatan-smp.md`).

1. **Pemahaman tekstual** — pahami informasi eksplisit, kelompokkan, susun
   ulang, sajikan kembali. Gunakan ketika soal menanya apa yang tertulis.
2. **Pemahaman inferensial** — simpulkan informasi tersirat. Gunakan ketika
   soal menanya ide pokok, amanat, perubahan tokoh/latar, makna ungkapan,
   hubungan antarperistiwa, prediksi, atau bahasa kias/citraan.
3. **Evaluasi dan apresiasi** — nilai ide, tanggapi teks secara emosional dan
   estetis. Gunakan ketika soal menanya relevansi dengan kehidupan,
   kesesuaian/keakuratan unsur, atau respons emosional terhadap teks fiksi.

Karakteristik teks pembeda cepat:
- SD: kalimat 3–7 kata pola SPOK; teks 150–200 kata; fiksi latar konkret,
  tokoh datar, konflik tunggal, alur maju, POV orang pertama.
- SMP: kalimat 5–9 kata, tunggal berbagai pola + majemuk setara; teks 200–250
  kata; fiksi tokoh bulat, konflik tunggal/jamak, alur campuran, POV orang
  ketiga; teks informasi bisa tunggal maupun jamak, skala lokal–global.

### IV. Matematika — tiga level kognitif

Kemampuan matematis: pengetahuan, representasi, penalaran, pemecahan masalah,
koneksi (SMP tambah penggunaan logika matematis, diintegrasikan ke elemen).
Diukur pada tiga level, dari mudah ke sulit:

- **L1 Knowing and Understanding** — Menghitung, Memahami informasi
  (grafik/tabel/diagram/infografis), Mengelompokkan, Mengidentifikasi.
- **L2 Applying** — Memodelkan (kontekstual ke kalimat matematika),
  Mengaplikasikan (rumus/strategi rutin), Menginterpretasikan (makna situasi
  atau representasi).
- **L3 Reasoning** — Menganalisis (hubungan antarkonsep), Memecahkan masalah
  (konteks baru/tidak rutin), Mengevaluasi (alternatif strategi), Menyimpulkan
  (SMP tambah Melakukan generalisasi).

Muatan SD: bilangan, geometri dan pengukuran, data. Muatan SMP: bilangan,
aljabar, geometri dan pengukuran, data dan peluang. Batasan rinci per
sub-elemen ada di referensi; jangan keluar dari batasan itu saat menulis soal.

## Indeks muatan

| Jenjang | Mapel | File |
|---|---|---|
| SD/MI | Bahasa Indonesia (membaca, 3 kompetensi) | [references/muatan-sd.md](references/muatan-sd.md) |
| SD/MI | Matematika (bilangan, geometri-pengukuran, data) | [references/muatan-sd.md](references/muatan-sd.md) |
| SMP/MTs | Bahasa Indonesia (membaca, 3 kompetensi + antarteks) | [references/muatan-smp.md](references/muatan-smp.md) |
| SMP/MTs | Matematika (bilangan, aljabar, geometri-pengukuran, data-peluang) | [references/muatan-smp.md](references/muatan-smp.md) |
| SD + SMP | Jenis/bentuk soal + level kognitif + kaidah penulisan butir | [references/bentuk-soal.md](references/bentuk-soal.md) |
| SD + SMP | Contoh soal resmi per kompetensi/elemen + kunci | [references/contoh-soal.md](references/contoh-soal.md) |

## File pendukung

- [references/muatan-sd.md](references/muatan-sd.md) — muatan dan subkompetensi SD.
- [references/muatan-smp.md](references/muatan-smp.md) — muatan dan subkompetensi SMP.
- [references/bentuk-soal.md](references/bentuk-soal.md) — tunggal/grup, PG/PGK-MCMA/PGK-kategori, level kognitif L1–L3.
- [references/contoh-soal.md](references/contoh-soal.md) — pola butir resmi + kunci, sebagai model.
- [cheatsheet.md](cheatsheet.md) — aturan keputusan cepat saat menulis soal.

## Merancang stage selaras TKA

Sebelum mengusulkan halaman, tetapkan: jenjang (SD/MI atau SMP/MTs), mapel
(B. Indonesia atau Matematika), dan target kompetensi atau elemen. Kemudian
baca dengan tool `read` asli:

1. [references/bentuk-soal.md](references/bentuk-soal.md), selalu;
2. tepat satu dari [references/muatan-sd.md](references/muatan-sd.md) atau
   [references/muatan-smp.md](references/muatan-smp.md);
3. [references/contoh-soal.md](references/contoh-soal.md) saat menulis butir
   baru, sebagai model format dan kunci.

Jika jenjang atau mapel belum jelas, ajukan maksimal dua pertanyaan penentu
dalam satu panggilan `ask_user`. Default selebihnya ke SD/MI Bahasa Indonesia,
teks informasi 150–200 kata, satu stimulus grup 2–3 butir. Jangan tanyakan
ulang informasi yang sudah ada di permintaan atau materi terlampir.

Nyatakan kontrak belajar dalam bentuk ini sebelum daftar halaman:

> Learner akan **mengerjakan X** agar **kompetensi/level Y** teramati melalui
> **bukti Z**.

Target lemah seperti "memahami" atau "menguasai" bukan kontrak. Gunakan verba
terlihat: mengidentifikasi, menyusun bagan, menyimpulkan, menilai, memodelkan,
mengaplikasikan, menganalisis, mengevaluasi.

Alur halaman default 6–10 halaman:

1. `slide`: situasi autentik + pertanyaan tak terjawab + tugas akhir;
2. `slide` atau materi: stimulus (teks 150–250 kata sesuai jenjang, atau
   konteks matematika personal/keluarga/lingkungan sekitar);
3. `interactive`: mengamati, memanipulasi, memetakan, atau mengumpulkan bukti
   (satu mekanisme per halaman);
4. `quiz`: diagnosis miskonsepsi + alasan; butir PG/PGK sesuai bentuk-soal,
   distraktor dari miskonsepsi nyata, umpan balik mengajar;
5. `interactive` atau tugas: menghasilkan penjelasan, model, keputusan, atau
   bagan;
6. `slide`: kriteria sukses + scaffold + contoh yang dikerjakan sebagian;
7. `quiz` atau tugas: transfer ke kasus baru dengan struktur penalaran sama;
8. `slide` penutup opsional: konsolidasi metode.

Pilih tipe halaman dari aksi learner, bukan dari urutan bab. Judul menamai
yang ditemukan learner, bukan label materi ("Simpulkan cara folivora mencerna
daun", bukan "Pemahaman inferensial").

## Eksekusi stage baru

Setelah guru menyetujui rencana halaman lewat `ask_user`:

1. `create_stage` dengan judul yang disepakati (sertakan `folderId` bila seri).
2. `set_roster` sebelum halaman apa pun. Tepat satu guru, minimal dua agen;
   persona guru memegang metode mapel, peran lain memunculkan miskonsepsi khas
   atau meminta bukti. Jaga register sesuai jenjang.
3. Panggil `generate_scene` sekali untuk setiap halaman yang disetujui, urut
   naik. Setiap `brief` mandiri dan memuat: target kompetensi atau
   elemen + level kognitif, stimulus yang dilihat learner, aksi learner,
   miskonsepsi dan scaffold, bukti asesmen, serta serah terima ke halaman
   berikut. Saat materi terlampir mendasari halaman, teruskan fakta
   terverifikasi lewat `materialFacts`.
4. `list_scenes` dan pastikan semua halaman yang disetujui ada dalam urutan
   benar.
5. Baca aksi narasi halaman. Panggil `generate_tts` pada setiap halaman yang
   ucapannya baru, berubah, atau tanpa `audioId`. Halaman terencana atau sunyi
   bukan halaman selesai.

Jangan berhenti setelah memaparkan rencana. Akhir putaran hanya di gerbang
`ask_user`, setelah halaman benar-benar tersimpan, atau saat seluruh stage
lolos pemeriksaan di bawah.

## Adaptasi stage yang sudah ada

1. `list_scenes`, lalu `read_stage` halaman relevan sebelum menulis.
2. Audit: kesesuaian jenjang, kesinambungan stimulus grup, keselarasan
   aktivitas–asesmen, kesulitan sesuai tahap sekolah, bukti yang teramati.
3. Perbaiki hanya halaman yang melanggar kontrak. Utamakan stimulus yang
   terbuang setelah halaman 1, kesimpulan yang diumumkan sebelum inkuiri,
   produk learner yang tak teramati, dan kuis yang runtuh jadi hafalan.
4. Gunakan `patch_stage` untuk suntingan sempit dan `edit_deck` untuk ubahan
   daftar halaman. Buat ulang satu halaman penuh hanya bila pengguna meminta
   tulis ulang eksplisit.
5. Jalankan ulang `generate_tts` setelah ucapan berubah, baca kembali halaman
   yang disentuh, dan `list_scenes` untuk struktur akhir.

Gunakan `grep_stage` untuk menemukan halaman yang menyebut suatu istilah, dan
`list_materials` + `read_material` untuk memverifikasi klaim terhadap sumber
pengguna sebelum mengoreksi. Materi pengguna adalah masukan yang disetujui,
bukan sekadar teks yang dibuat.

## Pemeriksaan selesai

Jangan nyatakan kelas selesai sebelum semua benar:

- jenjang dan mapel memakai wording kurikulum yang benar;
- satu–dua kompetensi atau elemen muncul sebagai aksi learner dan bukti
  teramati;
- stimulus grup bertahan dari pembuka hingga tugas dan transfer;
- setiap halaman yang disetujui ada, berisi, dan berurutan benar;
- learner memperoleh atau membandingkan bukti minimal sekali;
- learner menghasilkan minimal satu penjelasan, model, bagan, keputusan, atau
  artefak lain yang dapat diperiksa;
- miskonsepsi utama ditangani aktivitas atau kuis;
- asesmen sejenis dengan tugas belajar dan memuat transfer;
- narasi cocok dengan isi halaman dan setiap baris wicara yang wajib ada
  audionya;
- tidak ada nomor standar, kutipan, fakta sumber, atau kunci yang dikarang.

Tutup dalam satu–dua kalimat: sebut kompetensi atau elemen primer dan tugas
performa yang membuatnya terlihat. Jangan memutar ulang seluruh daftar halaman.

## Batasan

Skill ini hanya mencakup isi Peraturan 047/H/AN/2025. Untuk implementasi
langsung di codebase, gabungkan dengan tool project. Untuk topik di luar TKA,
periksa skill terkait atau tanyakan langsung ke agen. Jika gambar sumber tidak
terbaca (lebih dari 5 gambar hilang saat ekstraksi), nyatakan jumlahnya.
