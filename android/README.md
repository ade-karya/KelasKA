# Kelas KA — Aplikasi Android

Aplikasi Android **native** (Kotlin + Jetpack Compose, Material 3) untuk Kelas
Kecerdasan Artifisial — [kelaska.riau.ai](https://kelaska.riau.ai).

## Fitur v1.1.0

| Layar | Isi |
|-------|-----|
| **Beranda** | Hero bermerek (logo Kemendikdasmen & DPRD), statistik kursus milik Anda, sorotan fitur |
| **Kursus Saya** | Daftar kursus dari `GET /api/stages`: cari, buat, ubah nama, hapus |
| **Detail Kursus** | Membaca materi: slide dirender sebagai teks (HTML → teks), kuis interaktif (pilihan ganda/tunggal) dengan penilaian otomatis + pembahasan, konten interaktif/PBL dibuka di situs web |
| **Offline** | Perpustakaan `.maic.zip` di perangkat: impor, putar, hapus — bekerja tanpa internet dan tanpa masuk |
| **Akun** | Profil (nama/e-mail/peran), buka situs, tentang aplikasi, keluar |
| **Admin** (role `admin`) | Daftar akun, setujui akun baru, ubah peran (siswa/pengajar/admin), nonaktifkan akun |

## Mode offline (`.maic.zip`)

Ekspor kursus dari situs (**Ekspor → `.maic.zip`**), lalu buka **Offline** di
aplikasi (tombol "Buka Perpustakaan Offline" juga tersedia di layar masuk) dan
impor berkasnya. Seluruh isi paket disalin ke penyimpanan aplikasi, jadi kursus
tetap bisa diputar tanpa jaringan sama sekali — juga sebelum masuk akun.

Yang dirender:

- Slide: teks (HTML → teks), gambar, audio elemen, dan video dari berkas paket.
- Narasi: klip `speech` diputar berurutan dengan `MediaPlayer`; tiap klip juga
  bisa diputar sendiri.
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

## Tampilan responsif (sidebar)

Shell aplikasi beradaptasi otomatis terhadap lebar layar:

| Lebar | Navigasi |
|-------|----------|
| < 840 dp (ponsel) | `ModalNavigationDrawer` — sidebar geser dari kiri (tombol hamburger di top bar) |
| ≥ 840 dp (tablet/landscape) | `NavigationRail` di sisi kiri (ikon + label) |
| ≥ 1200 dp (tablet besar/lipat) | `PermanentNavigationDrawer` — sidebar permanen |

Konten mengikuti lebar secara otomatis; daftar kursus memakai `LazyColumn` sehingga
menggulir normal di kedua mode.

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

## Prasyarat

- JDK 17 (`openjdk-17-jdk-headless`), Android SDK dengan Platform 35 dan
  Build-Tools 35.0.0, `ANDROID_HOME` menunjuk ke SDK.
- Gradle 8.11.1 (wrapper sudah disertakan: `./gradlew`).

## Build

```bash
export ANDROID_HOME=/root/android-sdk  # atau SDK Anda

# Unit test (24 tes: HtmlText, QuizGrading, SceneContent, OfflinePackageStore)
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

## Batasan yang disengaja (v1.1.0)

- Di jalur **daring** (Detail Kursus), gambar slide hanya dimuat bila `src`
  berupa URL langsung; referensi asset-pool (`ast_…`) belum diselesaikan klien
  native. Jalur **offline** menyelesaikannya lewat `manifest.mediaIndex`.
- Storyboard/whiteboard, animasi papan tulis, dan widget generatif tidak
  dirender ulang; hanya teks/gambar/audio/video/kuis/konten interaktif.
- Scene PBL tidak dijalankan offline (butuh sandbox server); yang tampil hanya
  kartu penjelasan.
- Pembuatan kursus interaktif AI tetap dilakukan di situs; kursus baru dari
  aplikasi hanya membuat dokumen kosong.
- Impor memakai pemilih berkas sistem (SAF). Berkas `.maic.zip` besar butuh
  ruang kosong sekitar dua kali ukuran paket saat impor.

## Konfigurasi build

`app/build.gradle.kts` menaruh nilai publik berikut (semua memang dirancang
publik — dikirim ke setiap browser sebagai `NEXT_PUBLIC_*`):

- `BASE_URL` (`https://kelaska.riau.ai`, bisa ditimpa `-PkelasKaBaseUrl=…`)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `AUTH_DEEP_LINK` (`kelaskaapp://auth/callback`)

Tidak ada rahasia di dalam APK; sesi tersimpan di `EncryptedSharedPreferences`.
