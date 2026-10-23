# Wireframe Kelas KA / OpenMAIC

Dokumen wireframe low-fidelity untuk seluruh permukaan produk Kelas KA: beranda klasik, alur pembuatan kursus multi-agen, kelas, editor halaman, workspace Pro, basis pengetahuan, pengaturan, dialog, keadaan sistem, dan tata letak ponsel.

## Cara membuka

Saat server berjalan, buka:

```
http://localhost:3000/wireframes/
```

Atau buka file-nya langsung tanpa server:

```bash
open public/wireframes/index.html        # macOS
xdg-open public/wireframes/index.html    # Linux
```

Tidak ada build step, font eksternal, atau dependensi JavaScript. Seluruh CSS dan skrip daftar isi ditanam di dalam file. Dokumen optimal dibaca di desktop (lebar 1280–1440px); gunakan **Cetak / PDF** di kanan atas untuk arsip atau review.

## Isi dokumen

| Bagian | Cakupan |
| --- | --- |
| `00 · Peta` | Tiga jalur masuk, peta rute, dan prinsip dokumen bersama |
| `01 · Beranda` | Beranda klasik, composer, perpustakaan, serta state kosong/pencarian/folder/hapus |
| `02 · Pembuatan` | Progres generasi, tinjau kerangka, modal reveal peran, gagal/outline/kosong |
| `03 · Kelas` | Playback desktop, roundtable, kuis/interaktif/PBL/completion, papan tulis, layar penuh |
| `04 · Editor` | Command bar, rail halaman, kanvas dan seleksi, insert palette, dock narasi, roster |
| `05 · Workspace Pro` | Workspace home, sesi chat + kelas, basis pengetahuan, serta state pane dan pustaka |
| `06 · Pengaturan` | Dialog Token Plan dan delapan dialog/status pendukung |
| `07 · Status & mobile` | Matriks delapan keadaan sistem dan empat layar ponsel 390px |
| `08 · Inventaris` | Daftar rute, komponen, domain API, dan batas cakupan |

## Konvensi visual

- **Garis abu-abu** menandai frame, kontrol, dan container wireframe.
- **Bidang putus-putus** menandai placeholder, area dinamis, atau keadaan kosong.
- **Aksen ungu** menandai aksi utama dan elemen aktif.
- **Pin bernomor** merujuk ke catatan perilaku di bawah setiap layar, bukan ke urutan klik.
- Semua layar adalah aproksimasi proporsi dan hierarki; warna, tipografi, ikon, dan copy final tidak ditentukan di sini.

## Cakupan dan batasan

Dokumen ini diturunkan dari struktur nyata di `app/`, `components/`, dan label `lib/i18n/locales/id-ID.json` pada repo ini. Rute yang digambar adalah rute produk; halaman debug/dev, dialog kecil yang hanya varian (rename, pindah materi, pemilih avatar), dan detail implementasi internal tidak digambar terpisah.

Data contoh, nama guru/siswa, isi materi, dan status run bersifat ilustratif. Untuk perubahan rute atau komponen, perbarui bagian yang relevan di `index.html` dan tabel inventaris di bagian `08`.
