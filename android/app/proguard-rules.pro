# Menyimpan nama kelas yang dipakai lewat refleksi oleh kotlinx.serialization.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class kotlinx.serialization.json.** { *; }
-keepclasseswithmembers class ai.kelaska.app.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class ai.kelaska.app.**$$serializer { *; }
-keepclassmembers class ai.kelaska.app.** {
    *** Companion;
}

# Anotasi errorprone hanya untuk compile-time; aman di-strip.
-dontwarn com.google.errorprone.annotations.**
-dontwarn org.checkerframework.**
