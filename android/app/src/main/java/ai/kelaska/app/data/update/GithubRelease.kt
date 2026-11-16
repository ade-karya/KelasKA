package ai.kelaska.app.data.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Galat pemeriksaan/pembaruan dengan pesan yang aman ditampilkan ke pengguna. */
class UpdateException(message: String) : Exception(message)

/** Satu aset pada rilis GitHub. Hanya field yang dipakai aplikasi. */
@Serializable
data class GithubAsset(
    val name: String = "",
    @SerialName("browser_download_url") val downloadUrl: String = "",
    val size: Long = 0,
)

/**
 * Jawaban `GET /repos/{owner}/{repo}/releases/latest`. GitHub mengirim jauh
 * lebih banyak field (`author`, `assets[].uploader`, …), semuanya diabaikan.
 */
@Serializable
data class GithubRelease(
    @SerialName("tag_name") val tagName: String = "",
    val name: String? = null,
    val body: String? = null,
    @SerialName("html_url") val htmlUrl: String? = null,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val assets: List<GithubAsset> = emptyList(),
)

/** Rilis yang lolos validasi: punya versi dan APK. Checksum wajib ada saat unduh. */
data class AppRelease(
    val tag: String,
    val version: SemanticVersion,
    val title: String,
    val notes: String,
    val htmlUrl: String?,
    val apk: GithubAsset,
    /**
     * Aset `<nama-apk>.sha256`. `null` bila rilis (mis. rilis lama) tidak
     * menyertakannya; unduhan ditolak sebelum dimulai karena tidak bisa
     * diverifikasi.
     */
    val checksum: GithubAsset?,
)

/**
 * Parsing jawaban GitHub, dipisah dari jaringan supaya bisa diuji di JVM.
 * Tidak ada token: endpoint publik GitHub cukup dengan header Accept.
 */
object GithubReleaseParser {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val SHA256_PATTERN = Regex("\\b[0-9a-fA-F]{64}\\b")
    private const val CHECKSUM_SUFFIX = ".sha256"

    fun parseLatestRelease(payload: String): AppRelease {
        val release = try {
            json.decodeFromString(GithubRelease.serializer(), payload)
        } catch (error: Exception) {
            throw UpdateException("Jawaban GitHub tidak dapat dibaca sebagai rilis.")
        }
        return toAppRelease(release)
    }

    fun toAppRelease(release: GithubRelease): AppRelease {
        if (release.draft || release.prerelease) {
            throw UpdateException("Rilis terbaru di GitHub masih berupa draf/prarilis.")
        }
        val tag = release.tagName.trim()
        if (tag.isEmpty()) {
            throw UpdateException("Rilis GitHub tidak memiliki tag versi.")
        }
        val version = SemanticVersion.parse(tag)
            ?: throw UpdateException("Tag rilis “$tag” tidak dikenali sebagai versi.")
        val apk = selectApkAsset(release.assets)
            ?: throw UpdateException("Rilis terbaru tidak menyertakan berkas APK.")
        val checksum = findChecksumAsset(release.assets, apk.name)
        return AppRelease(
            tag = tag,
            version = version,
            title = release.name?.trim()?.takeIf { it.isNotEmpty() } ?: tag,
            notes = release.body.orEmpty().trim(),
            htmlUrl = release.htmlUrl,
            apk = apk,
            checksum = checksum,
        )
    }

    /**
     * Pilih APK rilis: utamakan nama yang memuat "release", hindari artefak
     * debug, lalu ambil yang pertama. Aset tanpa URL unduhan diabaikan.
     */
    fun selectApkAsset(assets: List<GithubAsset>): GithubAsset? {
        val apks = assets.filter { asset ->
            asset.name.endsWith(".apk", ignoreCase = true) && asset.downloadUrl.isNotBlank()
        }
        if (apks.isEmpty()) return null
        return apks.firstOrNull { it.name.contains("release", ignoreCase = true) }
            ?: apks.firstOrNull { !it.name.contains("debug", ignoreCase = true) }
            ?: apks.first()
    }

    fun findChecksumAsset(assets: List<GithubAsset>, apkName: String): GithubAsset? {
        if (apkName.isBlank()) return null
        val expected = apkName + CHECKSUM_SUFFIX
        return assets.firstOrNull { asset ->
            asset.name.equals(expected, ignoreCase = true) && asset.downloadUrl.isNotBlank()
        }
    }

    /**
     * Isi berkas `.sha256` lazimnya `<hash>` saja atau keluaran `sha256sum`
     * (`<hash>  nama.apk`). Ambil 64 digit heksadesimal pertama.
     */
    fun parseSha256(payload: String): String {
        val match = SHA256_PATTERN.find(payload)
            ?: throw UpdateException("Berkas SHA-256 dari rilis tidak berisi hash yang valid.")
        return match.value.lowercase()
    }
}
