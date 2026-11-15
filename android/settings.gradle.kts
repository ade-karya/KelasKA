// Kelas KA — Aplikasi Android (native, Jetpack Compose).
// Lihat README.md di folder ini untuk cara build dan rilis.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "KelasKA"
include(":app")
