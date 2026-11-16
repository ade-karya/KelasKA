package ai.kelaska.app.data.update

import kotlin.math.sign

/**
 * Versi semantik `major.minor.patch` untuk membandingkan tag rilis GitHub
 * dengan `versionName` aplikasi.
 *
 * Bagian setelah `-` (prarilis) dan `+` (metadata build) diabaikan, sehingga
 * `v1.2.0-rc.1` dibaca sebagai `1.2.0`. Komponen yang tidak ditulis dianggap
 * nol (`v1.2` = `1.2.0`). Murni JVM supaya bisa diuji tanpa emulator.
 */
data class SemanticVersion(
    val major: Int,
    val minor: Int,
    val patch: Int,
) : Comparable<SemanticVersion> {

    override fun compareTo(other: SemanticVersion): Int =
        compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch })

    override fun toString(): String = "$major.$minor.$patch"

    companion object {
        private const val MAX_COMPONENTS = 3

        fun parse(raw: String?): SemanticVersion? {
            val trimmed = raw?.trim().orEmpty()
            if (trimmed.isEmpty()) return null
            val versionText = stripTagPrefix(trimmed) ?: return null
            val core = versionText.substringBefore('-').substringBefore('+').trim()
            if (core.isEmpty()) return null
            val parts = core.split('.')
            if (parts.size > MAX_COMPONENTS) return null
            val numbers = parts.map { part ->
                // toIntOrNull menolak angka negatif, spasi, dan nilai di luar Int.
                part.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }?.toIntOrNull()
                    ?: return null
            }
            return SemanticVersion(
                major = numbers.getOrElse(0) { 0 },
                minor = numbers.getOrElse(1) { 0 },
                patch = numbers.getOrElse(2) { 0 },
            )
        }

        /**
         * Terima `v1.2.3`, `1.2.3`, dan tag berawalan aplikasi seperti
         * `android-v1.0.0` (rilis pertama repo ini memakai bentuk itu).
         * Prefiks lain yang tidak diakhiri `v`/`V` dianggap bukan versi.
         */
        private fun stripTagPrefix(value: String): String? {
            val direct = value.removePrefix("v").removePrefix("V")
            if (direct.firstOrNull()?.isDigit() == true) return direct
            val marker = value.lastIndexOf('v').coerceAtLeast(value.lastIndexOf('V'))
            if (marker < 0) return null
            val afterMarker = value.substring(marker + 1)
            return afterMarker.takeIf { it.firstOrNull()?.isDigit() == true }
        }
    }
}

/**
 * `true` bila tag rilis lebih baru daripada versi terpasang.
 *
 * Tag yang tidak bisa dibaca tidak pernah dianggap pembaruan: lebih aman
 * diam daripada menawarkan APK yang salah. `versionName` yang tidak valid
 * juga menghasilkan `false` (build pengembang/varian).
 */
fun isNewerVersion(remoteTag: String?, installedVersionName: String?): Boolean {
    val remote = SemanticVersion.parse(remoteTag) ?: return false
    val installed = SemanticVersion.parse(installedVersionName) ?: return false
    return remote.compareTo(installed).sign > 0
}
