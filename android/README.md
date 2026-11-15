# Kelas KA — Aplikasi Android

Aplikasi Android **native** (Kotlin + Jetpack Compose, Material 3) untuk Kelas
Kecerdasan Artifisial — [kelaska.riau.ai](https://kelaska.riau.ai).

## Fitur v1.0.0

| Layar | Isi |
|-------|-----|
| **Beranda** | Hero bermerek (logo Kemendikdasmen & DPRD), statistik kursus milik Anda, sorotan fitur |
| **Kursus Saya** | Daftar kursus dari `GET /api/stages`: cari, buat, ubah nama, hapus |
| **Detail Kursus** | Membaca materi: slide dirender sebagai teks (HTML → teks), kuis interaktif (pilihan ganda/tunggal) dengan penilaian otomatis + pembahasan, konten interaktif/PBL dibuka di situs web |
| **Akun** | Profil (nama/e-mail/peran), buka situs, tentang aplikasi, keluar |
| **Admin** (role `admin`) | Daftar akun, setujui akun baru, ubah peran (siswa/pengajar/admin), nonaktifkan akun |

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

## Prasyarat

- JDK 17 (`openjdk-17-jdk-headless`), Android SDK dengan Platform 35 dan
  Build-Tools 35.0.0, `ANDROID_HOME` menunjuk ke SDK.
- Gradle 8.11.1 (wrapper sudah disertakan: `./gradlew`).

## Build

```bash
export ANDROID_HOME=/root/android-sdk  # atau SDK Anda

# Unit test (14 tes: HtmlText, QuizGrading, SceneContent)
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

## Batasan yang disengaja (v1.0.0)

- Gambar dalam slide hanya dimuat bila `src` berupa URL langsung; referensi
  asset-pool (`ast_…`) tidak bisa diselesaikan oleh klien native, jadi dilewati.
- Konten interaktif dan PBL tidak dirender ulang secara native; dibuka di
  kelaska.riau.ai (Custom Tab).
- Aplikasi membutuhkan jaringan (tidak ada mode offline penuh).
- Kursus *buatan baru* dari aplikasi hanya membuat dokumen kosong; pembuatan
  interaktif AI dilakukan di situs (mengalir lewat API yang sama).

## Konfigurasi build

`app/build.gradle.kts` menaruh nilai publik berikut (semua memang dirancang
publik — dikirim ke setiap browser sebagai `NEXT_PUBLIC_*`):

- `BASE_URL` (`https://kelaska.riau.ai`, bisa ditimpa `-PkelasKaBaseUrl=…`)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `AUTH_DEEP_LINK` (`kelaskaapp://auth/callback`)

Tidak ada rahasia di dalam APK; sesi tersimpan di `EncryptedSharedPreferences`.
