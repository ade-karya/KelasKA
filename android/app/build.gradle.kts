plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

import java.io.File
import java.io.FileInputStream
import java.util.Properties

// Tanda tangan release dibaca dari file properti di luar repo, supaya
// keystore dan kata sandinya tidak pernah ikut commit. Lihat README.md.
// Default: ~/.config/kelaska/android-release.properties
//   storeFile=/absolut/path/ke/kelas-ka-release.keystore
//   storePassword=...
//   keyAlias=kelas-ka
//   keyPassword=...
// Bisa juga diisi lewat environment: KELAS_KA_STORE_FILE, KELAS_KA_STORE_PASSWORD,
// KELAS_KA_KEY_ALIAS, KELAS_KA_KEY_PASSWORD.
val releaseKeystoreProperties = Properties().apply {
    val path = System.getenv("KELAS_KA_RELEASE_PROPERTIES")
        ?: "${System.getProperty("user.home")}/.config/kelaska/android-release.properties"
    val file = File(path)
    if (file.isFile) FileInputStream(file).use { stream -> load(stream) }
}

fun releaseSecret(key: String, envName: String): String? =
    System.getenv(envName) ?: releaseKeystoreProperties.getProperty(key)

android {
    namespace = "ai.kelaska.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.kelaska.app"
        minSdk = 26
        targetSdk = 35
        // Naikkan keduanya di setiap rilis: versionCode harus selalu bertambah
        // (Android menolak memasang versi dengan versionCode lebih kecil) dan
        // versionName harus sama dengan tag rilis `vX.Y.Z` di GitHub.
        versionCode = 9
        versionName = "1.4.4"

        // Repo publik sumber rilis in-app update (GitHub Releases).
        // Bisa ditimpa lewat -PkelasKaGithubRepo=owner/repo saat build.
        val githubRepo = (findProperty("kelasKaGithubRepo") as String?)?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: "ade-karya/KelasKA"
        require(Regex("^[^/\\s]+/[^/\\s]+$").matches(githubRepo)) {
            "kelasKaGithubRepo harus berbentuk owner/repo, bukan '$githubRepo'"
        }

        // Nilai publik (sudah dikirim ke browser sebagai NEXT_PUBLIC_*);
        // aman disimpan di sini. Supabase memakai publishable key, bukan
        // service-role. Bisa ditimpa lewat -PkelasKaBaseUrl=... saat build.
        val baseUrl = (findProperty("kelasKaBaseUrl") as String?)?.trimEnd('/')
            ?: "https://kelaska.riau.ai"
        buildConfigField("String", "BASE_URL", "\"$baseUrl\"")
        buildConfigField("String", "SUPABASE_URL", "\"https://ztbonirwcrtqsfgyqrto.supabase.co\"")
        buildConfigField(
            "String",
            "SUPABASE_PUBLISHABLE_KEY",
            "\"sb_publishable_iRD6X4DPjgAXOMXtQgBV5w__U9HVs1d\"",
        )
        // Deep link untuk kembali dari consent Google → Supabase → aplikasi.
        // Harus terdaftar di Supabase dashboard → Authentication → URL Configuration.
        buildConfigField("String", "AUTH_DEEP_LINK", "\"kelaskaapp://auth/callback\"")
        // Sumber in-app update. Tidak ada token GitHub di APK: hanya API publik
        // tanpa autentikasi (batas 60 permintaan/jam per alamat IP).
        buildConfigField("String", "GITHUB_REPO", "\"$githubRepo\"")
    }

    signingConfigs {
        create("release") {
            val storeFilePath = releaseSecret("storeFile", "KELAS_KA_STORE_FILE")
            if (storeFilePath != null) {
                storeFile = rootProject.file(storeFilePath)
                storePassword = releaseSecret("storePassword", "KELAS_KA_STORE_PASSWORD")
                keyAlias = releaseSecret("keyAlias", "KELAS_KA_KEY_ALIAS") ?: "kelas-ka"
                keyPassword = releaseSecret("keyPassword", "KELAS_KA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            // Tandatangani hanya bila keystore tersedia; tanpanya artefak
            // release dibuat tanpa tanda tangan (untuk diperiksa saja).
            if (signingConfigs.getByName("release").storeFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // Detektor ini (androidx.lifecycle NonNullableMutableLiveDataDetector)
        // crash di AGP 8.7.3 dengan Kotlin 2.0.21 — temuan Google/AOSP yang
        // sudah diketahui; nonaktifkan detektornya, bukan lint-nya.
        disable += setOf("NullSafeMutableLiveData")
        // Peringatan "versi dependensi lebih baru" bukan cacat kode: versi di
        // bawah sengaja dipin ke toolchain AGP 8.7.3/Kotlin 2.0.21 dan
        // compileSdk 35 yang terpasang di host rilis. Naikkan dependensi
        // bersama toolchain-nya dalam perubahan tersendiri, bukan lewat saran
        // otomatis lint.
        disable += setOf("GradleDependency")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.browser:browser:1.8.0")
    // Anotasi compile-time untuk errorprone/tink (dibutuhkan R8 saat minify).
    implementation("com.google.errorprone:error_prone_annotations:2.36.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    implementation("io.coil-kt:coil-compose:2.7.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
}
