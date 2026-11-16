package ai.kelaska.app.data.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Memasang APK hasil unduhan tanpa Google Play.
 *
 * Android 8+ mewajibkan aplikasi pemanggil mendapat izin "pasang aplikasi tak
 * dikenal" per aplikasi. Bila izin belum ada, UI membuka
 * [unknownSourcesSettingsIntent] lalu memanggil [install] lagi setelah pengguna
 * kembali.
 */
class UpdateInstaller(private val context: Context) {

    fun canRequestPackageInstalls(): Boolean =
        context.packageManager.canRequestPackageInstalls()

    /** Pengaturan "Izinkan dari sumber ini" untuk paket aplikasi ini. */
    fun unknownSourcesSettingsIntent(): Intent =
        Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        )

    /** `true` bila intent pemasang berhasil diluncurkan. */
    fun install(file: File): Boolean {
        if (!file.isFile) return false
        val uri = try {
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        } catch (error: Exception) {
            return false
        }
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (error: ActivityNotFoundException) {
            false
        } catch (error: SecurityException) {
            false
        }
    }

    private companion object {
        const val APK_MIME = "application/vnd.android.package-archive"
    }
}
