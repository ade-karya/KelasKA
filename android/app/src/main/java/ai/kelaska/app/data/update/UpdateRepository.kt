package ai.kelaska.app.data.update

import ai.kelaska.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.InterruptedIOException
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Sumber pembaruan: GitHub Releases publik, tanpa token.
 *
 * Semua permintaan jaringan berjalan di [Dispatchers.IO]. Kegagalan jaringan,
 * timeout, batas laju GitHub (403/429), dan rilis tanpa APK/checksum dipetakan
 * menjadi [UpdateException] berbahasa Indonesia.
 */
class UpdateRepository(
    private val repository: String = BuildConfig.GITHUB_REPO,
    private val client: OkHttpClient = defaultClient(),
) {

    /** Rilis terbaru (endpoint `/releases/latest` tidak pernah mengembalikan draf). */
    suspend fun fetchLatestRelease(): AppRelease = withContext(Dispatchers.IO) {
        val response = execute(
            Request.Builder()
                .url("https://api.github.com/repos/$repository/releases/latest")
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "KelasKA-Android/${BuildConfig.VERSION_NAME}")
                .get()
                .build(),
        )
        val payload = response.use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw httpError(res.code)
            text
        }
        GithubReleaseParser.parseLatestRelease(payload)
    }

    /** Unduh isi `<nama-apk>.sha256` dari rilis yang sama. */
    suspend fun fetchChecksum(asset: GithubAsset): String = withContext(Dispatchers.IO) {
        if (asset.downloadUrl.isBlank()) {
            throw UpdateException("Rilis tidak menyertakan tautan berkas SHA-256.")
        }
        val response = execute(
            Request.Builder()
                .url(asset.downloadUrl)
                .header("Accept", "application/octet-stream")
                .header("User-Agent", "KelasKA-Android/${BuildConfig.VERSION_NAME}")
                .get()
                .build(),
        )
        val payload = response.use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw httpError(res.code)
            text
        }
        GithubReleaseParser.parseSha256(payload)
    }

    fun isUpdateAvailable(release: AppRelease, installedVersionName: String): Boolean =
        isNewerVersion(release.tag, installedVersionName)

    private fun execute(request: Request): Response = try {
        client.newCall(request).execute()
    } catch (error: InterruptedIOException) {
        // Termasuk SocketTimeoutException dan callTimeout OkHttp.
        throw UpdateException("Waktu permintaan ke GitHub habis. Periksa koneksi lalu coba lagi.")
    } catch (error: IOException) {
        throw UpdateException("Tidak dapat terhubung ke GitHub. Periksa koneksi internet.")
    }

    private fun httpError(code: Int): UpdateException = when (code) {
        403, 429 -> UpdateException(
            "Batas permintaan GitHub tercapai (HTTP $code). Coba lagi beberapa menit lagi.",
        )
        404 -> UpdateException("Belum ada rilis publik aplikasi ini di GitHub.")
        in 500..599 -> UpdateException("Server GitHub sedang bermasalah (HTTP $code). Coba lagi nanti.")
        else -> UpdateException("GitHub menolak permintaan pembaruan (HTTP $code).")
    }

    private companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .callTimeout(20, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
