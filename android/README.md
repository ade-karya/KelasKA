# Kelas KA — Aplikasi Android

Aplikasi Android **native** (Kotlin + Jetpack Compose, Material 3) untuk Kelas
Kecerdasan Artifisial — [kelaska.riau.ai](https://kelaska.riau.ai).

## Fitur v1.4.0

| Layar | Isi |
|-------|-----|
| **Beranda** | Hero bermerek (logo Kemendikdasmen & DPRD), statistik kursus milik Anda, sorotan fitur |
| **Kursus Saya** | Daftar kursus dari `GET /api/stages`: cari, buat, ubah nama, hapus |
| **Detail Kursus** | Membaca materi: slide dirender sebagai teks (HTML → teks), kuis interaktif (pilihan ganda/tunggal) dengan penilaian otomatis + pembahasan, konten interaktif/PBL dibuka di situs web |
| **Offline** | Perpustakaan `.maic.zip` di perangkat: impor, putar, hapus — bekerja tanpa internet dan tanpa masuk |
| **Akun** | Profil (nama/e-mail/peran), buka situs, **cek pembaruan**, tentang aplikasi, keluar |
| **Admin** (role `admin`) | Daftar akun, setujui akun baru, ubah peran (siswa/pengajar/admin), nonaktifkan akun |

## Mode offline (`.maic.zip`)

Ekspor kursus dari situs (**Ekspor → `.maic.zip`**), lalu buka **Offline** di
aplikasi (tombol "Buka Perpustakaan Offline" juga tersedia di layar masuk) dan
impor berkasnya. Seluruh isi paket disalin ke penyimpanan aplikasi, jadi kursus
tetap bisa diputar tanpa jaringan sama sekali — juga sebelum masuk akun.

Yang dirender:

- **Pemutar default = pemutar web.** Sejak v1.3.0 paket `.maic.zip` diputar
  oleh bundle `lib/standalone-player` yang sama dengan ekspor HTML
  kelaska.riau.ai (`StandalonePlayerHtml`), jadi slide, spotlight/laser,
  narasi + subtitle, video, kuis, dan diskusi tampil identik dengan situs.
  Tombol **Daftar materi** tetap membuka tampilan bacaan ringkas lama.
- Slide: teks (HTML → teks), gambar, audio elemen, dan video dari berkas paket.
- Narasi: klip `speech` diputar lewat elemen audio pemutar; klip dikirim
  sebagai `data:` URI (bukan `blob:` URL — audio blob tidak berbunyi di WebView
  Android). Jalur bacaan ringkas memakai `MediaPlayer` berurutan.
- Kuis: pilihan tunggal/ganda dinilai otomatis beserta pembahasan; soal esai
  ditandai tidak dinilai otomatis.
- Scene interaktif: `content.html` yang sudah di-inline eksportir dijalankan di
  WebView terisolasi. Navigasi keluar dan seluruh pemuatan jaringan diblokir,
  jadi halaman tidak bisa diam-diam membuka internet.
- Scene PBL: ditampilkan sebagai kartu penjelasan (butuh sandbox/server, bukan
  konten yang bisa dijalankan offline).

Keamanan impor: ZIP diekstrak ke direktori staging lalu di-rename setelah
validasi selesai; entri dengan path tidak aman (zip-slip) ditolak; batas 10.000
entri, `manifest.json` 64 MiB, total 2 GiB; hanya `manifest.json`, `audio/`, dan
`media/` yang disalin. Format `formatVersion` 1–2 diterima, termasuk paket PBL
(kapabilitas `pbl-v3-*`).

## Pembaruan aplikasi (in-app update)

APK dipasang langsung dari **GitHub Releases** repo publik, tanpa Google Play.

- **Sumber**: `GET https://api.github.com/repos/<GITHUB_REPO>/releases/latest`
  dengan header `Accept: application/vnd.github+json`. Tidak ada token GitHub
  di dalam APK — batas anonim GitHub 60 permintaan/jam per alamat IP ditangani
  sebagai pesan "coba lagi nanti" (HTTP 403/429).
- **Pembanding**: tag rilis (`v` dibuang; prefiks seperti `android-v1.0.0`
  juga diterima) vs `versionName` aplikasi, secara semantik
  `major.minor.patch` (jadi `v1.10.0` > `v1.9.9`; sufiks `-rc.1` diabaikan).
  Tag yang tidak bisa dibaca tidak pernah ditawarkan.
- **Frekuensi**: cek otomatis saat aplikasi dibuka, maksimal sekali per 24 jam
  (timestamp di `SharedPreferences` `kelas_ka_update`). Tombol **Cek pembaruan**
  di layar Akun selalu boleh dan menampilkan "sudah terbaru" bila tidak ada rilis
  baru; kegagalan cek otomatis dibiarkan senyap agar aplikasi tetap bisa dipakai
  offline.
- **Unduhan**: `DownloadManager` ke
  `getExternalFilesDir(DIRECTORY_DOWNLOADS)/update.apk`, progres persen di dialog,
  tombol Batal, dan pesan untuk ruang penyimpanan habis / unduhan terputus.
- **Verifikasi**: aplikasi mengambil aset `<nama-apk>.sha256` dari rilis yang
  sama dan membandingkan SHA-256 berkas. Hash tidak cocok → berkas dihapus dan
  pembaruan dibatalkan. Aset checksum tidak ada (rilis lama) → tombol Update
  menolak mengunduh; pemeriksaan versi tetap berjalan.
- **Pemasangan**: `FileProvider` (`${applicationId}.fileprovider`,
  `res/xml/file_paths.xml`) + `ACTION_VIEW` MIME
  `application/vnd.android.package-archive`. Bila
  `canRequestPackageInstalls()` masih `false`, aplikasi membuka
  `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` untuk paket ini dan melanjutkan
  pemasangan setelah pengguna kembali (hasil Activity diperiksa ulang).

Kelas terkait: `data/update/UpdateRepository.kt` (API + parsing),
`UpdateDownloader.kt` (DownloadManager + SHA-256), `UpdateInstaller.kt`
(FileProvider + intent), `ui/UpdateViewModel.kt` (state `Idle`, `Checking`,
`Available`, `Downloading(progress)`, `ReadyToInstall`, `UpToDate`, `Error`),
dan `ui/components/UpdateHost.kt` (dialog di atas seluruh layar).

## Tampilan responsif (portrait & landscape)

Shell aplikasi beradaptasi otomatis terhadap lebar layar:

| Lebar | Navigasi |
|-------|----------|
| < 840 dp (ponsel) | `ModalNavigationDrawer` — sidebar geser dari kiri (tombol hamburger di top bar) |
| ≥ 840 dp (tablet/landscape) | `NavigationRail` di sisi kiri (ikon + label) |
| ≥ 1200 dp (tablet besar/lipat) | `PermanentNavigationDrawer` — sidebar permanen |

Perilaku orientasi:

- `MainActivity` menangani `orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden`
  sendiri, jadi memutar perangkat **tidak** membuat ulang Activity dan tidak
  memuat ulang WebView pemutar — posisi adegan, narasi, dan daftar tetap.
- Di pemutar, bilah atas aplikasi dipadatkan saat landscape (ikon daftar saja);
  CSS host mengecilkan header/footer pemutar di layar pendek dan menyembunyikan
  label tombol Sebelumnya/Berikutnya di layar sempit supaya footer tidak meluber.
- Halaman daftar/detail dibatasi `CONTENT_MAX_WIDTH` (840 dp) dan ditengahkan
  (`CenteredContent`), jadi di tablet/landscape baris teks tidak melar penuh.
- **Layar penuh**: tombol "Layar penuh" pemutar memanggil `requestFullscreen()`;
  `PlayerChromeClient` menaruh tampilan penuh di atas `decorView`, menyembunyikan
  bilah sistem, dan tombol kembali keluar dari layar penuh.

## Arsitektur singkat

- `app/src/main/java/ai/kelaska/app/data/` — model JSON (kotlinx.serialization),
  klien HTTP (OkHttp) dengan sesi `kelaska_session` dikirim sebagai header
  `Cookie:` eksplisit, `EncryptedSharedPreferences` untuk sesi.
- `data/SupabasePkce.kt` — PKCE handshake ke Supabase Auth sepenuhnya di dalam
  aplikasi (Custom Tab + deep link `kelaskaapp://auth/callback`). **Bukan
  WebView** (Google memblokir WebView untuk OAuth).
- Server menukar token akses Supabase → sesi Kelas KA lewat
  `POST /api/auth/native/session` (endpoint baru, lihat
  `app/api/auth/native/session/route.ts` dan `lib/server/auth/native-session.ts`).
  Mekanisme yang sama persis dengan callback browser — akun baru tetap menjadi
  **pending** sampai admin menyetujui.
- `ui/` — layar-layar Compose; `ui/AppShell.kt` adalah shell responsif di atas.
- `data/offline/` — pembaca paket `.maic.zip` murni JVM (bisa diuji tanpa
  emulator): `OfflinePackageStore` mengekstrak/memvalidasi/menyimpan paket,
  `OfflineModels` adalah bentuk manifest. Pemutarnya ada di
  `ui/screens/OfflineLibraryScreen.kt` dan `ui/screens/OfflineCourseScreen.kt`
  (komponen slide/kuis dibagi dengan jalur daring di `ui/components/`).
- `data/update/` — pemeriksa rilis GitHub, pengunduh DownloadManager, verifikasi
  SHA-256, dan pemasang FileProvider. Parsing JSON serta perbandingan versi
  murni JVM sehingga diuji di `app/src/test/…/data/update/`.

## Prasyarat

- JDK 17 (`openjdk-17-jdk-headless`), Android SDK dengan Platform 35 dan
  Build-Tools 35.0.0, `ANDROID_HOME` menunjuk ke SDK.
- Gradle 8.11.1 (wrapper sudah disertakan: `./gradlew`).

## Build

```bash
export ANDROID_HOME=/root/android-sdk  # atau SDK Anda

# Unit test (HtmlText, QuizGrading, SceneContent, OfflinePackageStore,
# AppVersion, GithubReleaseParser, UpdatePreferences)
./gradlew :app:testDebugUnitTest

# APK debug
./gradlew :app:assembleDebug

# APK release (ditandatangani bila keystore tersedia, lihat bawah)
./gradlew :app:assembleRelease
```

Hasil:

- `app/build/outputs/apk/debug/app-debug.apk` (otomatis debug-signed)
- `app/build/outputs/apk/release/app-release.apk` (ditandatangani keystore release bila ada)

Untuk Play Store, buat juga `./gradlew :app:bundleRelease` (AAB).

## Menandatangani release (keystore)

Keystore **tidak** ada di repo. Default yang dipakai build:

- file properti: `~/.config/kelaska/android-release.properties`
  ```
  storeFile=/abs/path/kelas-ka-release.keystore
  storePassword=...
  keyAlias=kelas-ka
  keyPassword=...
  ```
- atau environment: `KELAS_KA_STORE_FILE`, `KELAS_KA_STORE_PASSWORD`,
  `KELAS_KA_KEY_ALIAS`, `KELAS_KA_KEY_PASSWORD`
  (opsional `KELAS_KA_RELEASE_PROPERTIES` untuk path properti lain).

Membuat keystore baru:

```bash
keytool -genkeypair -v -keystore kelas-ka-release.keystore -alias kelas-ka \
  -keyalg RSA -keysize 4096 -validity 10000 -storetype JKS \
  -dname "CN=Kelas KA, OU=Kelas KA, O=Kemendikdasmen, L=Pekanbaru, ST=Riau, C=ID"
```

Android membandingkan signature antar-versi; **keystore yang hilang = tidak bisa
update aplikasi yang sudah terpasang**. Simpan backup-nya di lokasi aman.

## Merilis versi baru (GitHub Releases)

Workflow `.github/workflows/release.yml` membangun rilis saat tag `v*` didorong:

1. Naikkan **`versionCode`** (wajib selalu bertambah — Android menolak memasang
   APK dengan `versionCode` lebih kecil) dan **`versionName`** di
   `app/build.gradle.kts`. Workflow menolak tag yang tidak sama dengan
   `versionName` dan menolak `versionCode` yang tidak naik dari commit
   sebelumnya.
2. Isi secret repo (Settings → Secrets and variables → Actions):

   | Secret | Isi |
   |--------|-----|
   | `ANDROID_KEYSTORE_BASE64` | keystore release, `base64 -w0 kelas-ka-release.keystore` |
   | `ANDROID_KEYSTORE_PASSWORD` | `storePassword` |
   | `ANDROID_KEY_ALIAS` | `kelas-ka` |
   | `ANDROID_KEY_PASSWORD` | `keyPassword` |

3. Dorong tag: `git tag v1.4.0 && git push origin v1.4.0`.

Workflow menjalankan unit test, membangun `assembleRelease`, menandatangani
dengan keystore yang sama, lalu mengunggah `KelasKA-v1.4.0.apk` dan
`KelasKA-v1.4.0.apk.sha256` ke GitHub Release. Aplikasi hanya membaca
`/releases/latest` (rilis stabil), jadi draf/prarilis tidak pernah ditawarkan.

**Keystore harus sama di setiap rilis.** Signature berbeda = Android menolak
update di tempat; pengguna harus menghapus aplikasi lebih dulu.

## Langkah operator (wajib, satu kali)

Aplikasi melakukan consent Google melalui Supabase PKCE dan kembali lewat deep
link `kelaskaapp://auth/callback`. Supabase menolak `redirect_to` yang tidak
didaftarkan, jadi URL ini **harus** ditambahkan di Supabase Dashboard:

**Authentication → URL Configuration → Redirect URLs** → tambahkan
`kelaskaapp://auth/callback`
(dan opsional `ai.kelaska.app://auth/callback` jika skema diubah).

Tanpa ini, tombol "Masuk dengan Google" akan ditolak oleh Supabase sebelum
mencapai kelaska.riau.ai. Tidak ada bagian lain yang perlu diubah di server:
endpoint `/api/auth/native/session` dipakai oleh aplikasi untuk menukar token
menjadi sesi `kelaska_session` (perlakuan sama dengan callback browser, termasuk
logika *pending account*).

## Perbaikan v1.4.0

- **Narasi berbunyi.** Klip `speech` kini masuk media table pemutar sebagai
  `src` berisi `data:` URI, bukan blok base64 yang diubah menjadi `blob:` URL.
  WebView Android tidak memutar audio dari `blob:` URL saat `blockNetworkLoads`
  aktif, sehingga narasi sebelumnya senyap; elemen audio slide juga ikut
  di-inline. Video tetap memakai blok base64 + blob seperti ekspor web.
- **Layar penuh berfungsi.** `requestFullscreen()` dari pemutar sebelumnya
  ditolak WebView karena tidak ada `WebChromeClient`. `PlayerChromeClient`
  sekarang menyediakan `onShowCustomView`/`onHideCustomView`, menaruh tampilan
  di atas `decorView`, menyembunyikan bilah sistem, dan keluar lewat tombol
  kembali.
- **Responsif di landscape & portrait.** Rotasi tidak lagi memuat ulang WebView
  (`configChanges`), bilah pemutar dipadatkan di layar pendek/sempit, dan
  konten daftar/detail dibatasi 840 dp serta ditengahkan.

## Batasan yang disengaja (v1.4.0)

- Memutar kelas dari paket `.maic.zip` sekarang memakai **bundle pemutar web
  yang persis sama** (`lib/standalone-player`, dibangun oleh
  `scripts/build-standalone-player.mjs` dan disalin ke
  `app/src/main/assets/player/`). `StandalonePlayerHtml` merakit dokumen yang
  sama dengan `lib/export/standalone-html/assemble.ts`: slide, efek spotlight/
  laser, narasi, subtitle, video, kuis, dan diskusi tampil persis seperti di
  kelaska.riau.ai. Jalur "Daftar materi" yang lama tetap tersedia sebagai
  bacaan ringkas.
- Bundle pemutar perlu dibangun ulang (`bun run build:standalone-player`) dan
  disalin ke `app/src/main/assets/player/` setiap kali `@openmaic/renderer`
  atau `lib/standalone-player` berubah di web.
- Di jalur **daring** (Detail Kursus), gambar slide hanya dimuat bila `src`
  berupa URL langsung; referensi asset-pool (`ast_…`) belum diselesaikan klien
  native. Jalur **offline** menyelesaikannya lewat `manifest.mediaIndex`.
- PBL tetap berupa kartu penjelasan + tautan ke kelas online (butuh sandbox
  server); interaksi agen langsung tidak dijalankan di dalam aplikasi.
- Pembuatan kursus interaktif AI tetap dilakukan di situs; kursus baru dari
  aplikasi hanya membuat dokumen kosong.
- Impor memakai pemilih berkas sistem (SAF). Berkas `.maic.zip` besar butuh
  ruang kosong sekitar dua kali ukuran paket saat impor.
- In-app update hanya jalan untuk APK yang ditandatangani dengan keystore
  rilis yang sama. Build `debug` tidak bisa menimpa instalasi rilis (signature
  berbeda); memasang pertama kali dari GitHub tetap memerlukan izin "pasang
  aplikasi tak dikenal" dari pengguna.
- Cek pembaruan memakai API GitHub anonim (60 permintaan/jam per IP). Jaringan
  sekolah dengan banyak perangkat di balik satu IP bisa mencapai batas itu;
  aplikasi menampilkan pesan untuk mencoba lagi nanti dan tidak memblokir
  pemakaian.

## Konfigurasi build

`app/build.gradle.kts` menaruh nilai publik berikut (semua memang dirancang
publik — dikirim ke setiap browser sebagai `NEXT_PUBLIC_*`):

- `BASE_URL` (`https://kelaska.riau.ai`, bisa ditimpa `-PkelasKaBaseUrl=…`)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `AUTH_DEEP_LINK` (`kelaskaapp://auth/callback`)
- `GITHUB_REPO` (`ade-karya/KelasKA`, bisa ditimpa
  `-PkelasKaGithubRepo=owner/repo` untuk fork)

Tidak ada rahasia di dalam APK; sesi tersimpan di `EncryptedSharedPreferences`.
