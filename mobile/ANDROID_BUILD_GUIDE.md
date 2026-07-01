# Panduan Build Android — KelasKA Mobile

Dokumen ini menjelaskan cara menghasilkan APK/AAB Android menggunakan **Capacitor 7** sebagai wrapper native dari aplikasi web KelasKA.

---

## Prasyarat

| Tool | Versi Min | Keterangan |
|------|-----------|------------|
| Node.js | 20+ | Diperlukan untuk Next.js |
| JDK | 17 (Azul Zulu/Temurin) | Diperlukan untuk Android toolchain |
| Android Studio | Hedgehog+ | Buka project Android |
| Android SDK | API 24+ | Minimum target |
| `ANDROID_HOME` | — | Path ke Android SDK harus di-set |

---

## Langkah 1 — Siapkan Web App

```bash
# Di root project (d:\Project\KelasKA)
pnpm install
pnpm run build
```

Jika build berhasil, folder `out/` atau `.next/` akan terbentuk.

---

## Langkah 2 — Install dependensi Capacitor

```bash
# Di folder mobile/
cd mobile
npm install
```

---

## Langkah 3 — Sync & Tambahkan Platform Android

```bash
# Sync web assets ke native
npm run cap:sync

# Atau jika platform Android belum ada (pertama kali):
npx cap add android
npx cap sync
```

---

## Langkah 4 — Konfigurasi Firebase (FCM)

1. Buka [Firebase Console](https://console.firebase.google.com)
2. Buat project → **Tambah Aplikasi Android**
3. Package name: `com.kelaska.app`
4. Download `google-services.json`
5. Letakkan di: `mobile/android/app/google-services.json`

Tambahkan di `mobile/android/app/build.gradle`:
```groovy
apply plugin: 'com.google.gms.google-services'
```

Tambahkan di `mobile/android/build.gradle`:
```groovy
classpath 'com.google.gms:google-services:4.4.0'
```

---

## Langkah 5 — Konfigurasi URL Server

Edit `mobile/capacitor.config.ts` dan ubah `server.url` ke URL produksi:

```typescript
server: {
  url: 'https://kelaska.com',  // Ganti dengan URL deployment Anda
  cleartext: false,
}
```

Untuk development lokal di emulator Android:
```typescript
server: {
  url: 'http://10.0.2.2:3000',  // IP khusus emulator → localhost host machine
  cleartext: true,
}
```

---

## Langkah 6 — Buka & Build di Android Studio

```bash
npm run cap:open   # Membuka Android Studio
```

Di Android Studio:
1. **Build → Generate Signed Bundle/APK**
2. Pilih **Android App Bundle (AAB)** untuk Play Store
3. Pilih keystore (buat baru jika belum ada)
4. Pilih **release** build variant
5. Klik **Finish**

---

## Langkah 7 — Upload ke Google Play Store

1. Buka [Google Play Console](https://play.google.com/console)
2. Buat aplikasi baru → Package `com.kelaska.app`
3. Upload AAB dari `mobile/android/app/release/app-release.aab`
4. Isi metadata (deskripsi, screenshot, kebijakan privasi)
5. Submit untuk review

---

## Development Lokal dengan Emulator

```bash
# Jalankan Next.js dev server di host machine
pnpm run dev   # Berjalan di port 3000

# Di mobile/, sync ulang & buka emulator
npm run cap:sync
npx cap run android
```

Emulator Android mengakses `10.0.2.2` sebagai `localhost` di host machine.

---

## Struktur File Mobile

```
mobile/
├── capacitor.config.ts    # Konfigurasi Capacitor
├── package.json           # Dependensi Capacitor
└── android/               # Dibuat otomatis setelah `npx cap add android`
    ├── app/
    │   ├── src/main/
    │   │   ├── AndroidManifest.xml
    │   │   └── res/
    │   └── google-services.json   # ← letakkan di sini
    └── build.gradle
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| SSL Error di emulator | Set `server.cleartext: true` untuk dev |
| Push notifikasi tidak muncul | Periksa `google-services.json` dan FCM setup |
| App tidak load | Pastikan `server.url` benar dan server berjalan |
| Build gagal | Pastikan JDK 17 dan `ANDROID_HOME` di-set |
