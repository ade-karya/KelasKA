package ai.kelaska.app.data.update

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/** Hasil unduhan APK pembaruan. */
sealed interface DownloadOutcome {
    data class Success(val file: File) : DownloadOutcome
    data class Failure(val message: String) : DownloadOutcome
    data object Cancelled : DownloadOutcome
}

/**
 * Mengunduh APK lewat sistem [DownloadManager] ke
 * `getExternalFilesDir(DIRECTORY_DOWNLOADS)/update.apk`, memantau progres, lalu
 * memverifikasi SHA-256 sebelum berkas diserahkan ke pemasang.
 *
 * Berkas yang hash-nya tidak cocok langsung dihapus dan tidak pernah dipasang.
 */
class UpdateDownloader(private val context: Context) {

    private val downloadManager =
        context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    @Volatile
    private var currentDownloadId: Long? = null

    /** Berkas tujuan; `null` bila penyimpanan eksternal tidak tersedia. */
    fun destinationFile(): File? =
        context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let { File(it, FILE_NAME) }

    /**
     * Mulai unduhan dan tunggu sampai selesai/gagal/dibatalkan.
     *
     * [onProgress] menerima fraksi 0..1 dan penanda "total belum diketahui".
     * Semua penantian berjalan di [Dispatchers.IO].
     */
    suspend fun download(
        apkUrl: String,
        expectedSha256: String,
        onProgress: (progress: Float, indeterminate: Boolean) -> Unit,
    ): DownloadOutcome = withContext(Dispatchers.IO) {
        val target = destinationFile()
            ?: return@withContext DownloadOutcome.Failure(
                "Penyimpanan eksternal tidak tersedia untuk mengunduh pembaruan.",
            )
        // DownloadManager menolak menimpa berkas yang sudah ada di beberapa
        // perangkat, jadi bersihkan sisa unduhan sebelumnya lebih dulu.
        target.delete()

        val request = DownloadManager.Request(Uri.parse(apkUrl))
            .setTitle("Kelas KA")
            .setDescription("Mengunduh pembaruan aplikasi")
            .setMimeType(APK_MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, FILE_NAME)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)

        val downloadId = try {
            downloadManager.enqueue(request)
        } catch (error: Exception) {
            return@withContext DownloadOutcome.Failure(
                "Tidak bisa memulai unduhan: ${error.message?.take(140).orEmpty()}",
            )
        }
        currentDownloadId = downloadId

        try {
            while (true) {
                if (currentDownloadId != downloadId) return@withContext DownloadOutcome.Cancelled
                delay(POLL_INTERVAL_MS)
                val status = query(downloadId)
                when (status.state) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        currentDownloadId = null
                        if (!target.isFile) {
                            return@withContext DownloadOutcome.Failure(
                                "Berkas pembaruan tidak ditemukan setelah unduhan selesai.",
                            )
                        }
                        if (!sha256Matches(target, expectedSha256)) {
                            target.delete()
                            return@withContext DownloadOutcome.Failure(
                                "Verifikasi SHA-256 gagal. Berkas unduhan sudah dihapus; pembaruan dibatalkan.",
                            )
                        }
                        return@withContext DownloadOutcome.Success(target)
                    }

                    DownloadManager.STATUS_FAILED -> {
                        currentDownloadId = null
                        target.delete()
                        return@withContext DownloadOutcome.Failure(reasonMessage(status.reason))
                    }

                    DownloadManager.STATUS_PAUSED -> onProgress(0f, true)

                    else -> onProgress(status.fraction, status.totalBytes <= 0L)
                }
            }
            @Suppress("UNREACHABLE_CODE")
            DownloadOutcome.Cancelled
        } finally {
            if (currentDownloadId == downloadId) currentDownloadId = null
        }
    }

    /** Batalkan unduhan aktif (tombol "Batal" / ViewModel dibersihkan). */
    fun cancel() {
        val downloadId = currentDownloadId ?: return
        currentDownloadId = null
        runCatching { downloadManager.remove(downloadId) }
        destinationFile()?.let { runCatching { it.delete() } }
    }

    /** `true` bila SHA-256 berkas sama dengan hash yang diharapkan. */
    fun sha256Matches(file: File, expectedSha256: String): Boolean {
        val normalized = expectedSha256.trim().lowercase()
        if (!normalized.matches(SHA256_HEX)) return false
        val actual = runCatching { sha256(file) }.getOrNull() ?: return false
        return MessageDigest.isEqual(
            actual.toByteArray(Charsets.US_ASCII),
            normalized.toByteArray(Charsets.US_ASCII),
        )
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(COPY_BUFFER_BYTES)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }

    private data class Status(
        val state: Int,
        val downloadedBytes: Long,
        val totalBytes: Long,
        val reason: Int,
    ) {
        val fraction: Float
            get() = if (totalBytes > 0L) {
                (downloadedBytes.toFloat() / totalBytes).coerceIn(0f, 1f)
            } else {
                0f
            }
    }

    private fun query(downloadId: Long): Status =
        downloadManager.query(DownloadManager.Query().setFilterById(downloadId)).use { cursor ->
            if (!cursor.moveToFirst()) {
                return@use Status(DownloadManager.STATUS_FAILED, 0L, 0L, -1)
            }
            fun intColumn(column: String): Int =
                cursor.getColumnIndex(column).takeIf { it >= 0 }?.let(cursor::getInt) ?: -1

            fun longColumn(column: String): Long =
                cursor.getColumnIndex(column).takeIf { it >= 0 }?.let(cursor::getLong) ?: 0L

            Status(
                state = intColumn(DownloadManager.COLUMN_STATUS),
                downloadedBytes = longColumn(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR),
                totalBytes = longColumn(DownloadManager.COLUMN_TOTAL_SIZE_BYTES),
                reason = intColumn(DownloadManager.COLUMN_REASON),
            )
        }

    private fun reasonMessage(reason: Int): String = when (reason) {
        DownloadManager.ERROR_INSUFFICIENT_SPACE ->
            "Ruang penyimpanan tidak cukup untuk mengunduh pembaruan."

        DownloadManager.ERROR_HTTP_DATA_ERROR,
        DownloadManager.ERROR_UNHANDLED_HTTP_CODE,
        DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "Unduhan terputus oleh server GitHub. Coba lagi."

        DownloadManager.ERROR_CANNOT_RESUME,
        DownloadManager.ERROR_FILE_ERROR -> "Unduhan gagal karena berkas tidak bisa ditulis. Coba lagi."

        DownloadManager.ERROR_DEVICE_NOT_FOUND ->
            "Penyimpanan untuk unduhan tidak tersedia."

        else -> "Unduhan pembaruan gagal (kode $reason)."
    }

    private companion object {
        const val FILE_NAME = "update.apk"
        const val APK_MIME = "application/vnd.android.package-archive"
        const val POLL_INTERVAL_MS = 400L
        const val COPY_BUFFER_BYTES = 64 * 1024
        val SHA256_HEX = Regex("^[0-9a-f]{64}$")
    }
}
