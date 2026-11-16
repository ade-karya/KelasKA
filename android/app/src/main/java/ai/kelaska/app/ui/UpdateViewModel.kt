package ai.kelaska.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.update.AppRelease
import ai.kelaska.app.data.update.DownloadOutcome
import ai.kelaska.app.data.update.UpdateDownloader
import ai.kelaska.app.data.update.UpdateException
import ai.kelaska.app.data.update.UpdatePreferences
import ai.kelaska.app.data.update.UpdateRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

/** Status in-app update yang dirender [ai.kelaska.app.ui.components.UpdateHost]. */
sealed interface UpdateState {
    data object Idle : UpdateState

    data object Checking : UpdateState

    data class Available(val release: AppRelease) : UpdateState

    data class Downloading(
        val progress: Float,
        val indeterminate: Boolean = false,
    ) : UpdateState

    data class ReadyToInstall(val file: File) : UpdateState

    /** Hanya ditampilkan untuk cek manual: cek otomatis yang nihil hasilnya diam. */
    data class UpToDate(val installedVersion: String) : UpdateState

    data class Error(val message: String) : UpdateState
}

/**
 * Alur cek → tawaran → unduh → verifikasi → pasang.
 *
 * Cek otomatis dibatasi sekali per 24 jam ([UpdatePreferences]); cek manual
 * dari layar Akun selalu boleh. Kegagalan cek otomatis sengaja tidak
 * memunculkan dialog (aplikasi tetap bisa dipakai offline); kegagalan cek
 * manual dan seluruh kegagalan unduhan tampil sebagai [UpdateState.Error].
 */
class UpdateViewModel(
    private val repository: UpdateRepository,
    private val downloader: UpdateDownloader,
    private val preferences: UpdatePreferences,
    private val installedVersionName: String,
) : ViewModel() {

    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    private var checkJob: Job? = null
    private var downloadJob: Job? = null

    /** Dipanggil sekali saat aplikasi dibuka; maksimal sekali per 24 jam. */
    fun checkAutomatically() {
        if (!preferences.isAutoCheckDue()) return
        // Tandai percobaan, bukan keberhasilan: perangkat yang terus offline
        // tidak boleh menembak GitHub setiap kali aplikasi dibuka.
        preferences.markAutoCheck()
        check(manual = false)
    }

    /** Tombol "Cek pembaruan" di layar Akun. */
    fun checkManually() {
        check(manual = true)
    }

    fun download() {
        val release = (_state.value as? UpdateState.Available)?.release ?: return
        if (downloadJob?.isActive == true) return
        val checksum = release.checksum
        if (checksum == null) {
            _state.value = UpdateState.Error(
                "Rilis tidak menyertakan ${release.apk.name}.sha256, jadi pembaruan tidak dapat diverifikasi dan tidak akan dipasang.",
            )
            return
        }
        _state.value = UpdateState.Downloading(progress = 0f, indeterminate = true)
        downloadJob = viewModelScope.launch {
            try {
                val expectedSha256 = repository.fetchChecksum(checksum)
                val outcome = downloader.download(release.apk.downloadUrl, expectedSha256) { progress, indeterminate ->
                    _state.value = UpdateState.Downloading(progress, indeterminate)
                }
                _state.value = when (outcome) {
                    is DownloadOutcome.Success -> UpdateState.ReadyToInstall(outcome.file)
                    is DownloadOutcome.Failure -> UpdateState.Error(outcome.message)
                    DownloadOutcome.Cancelled -> UpdateState.Idle
                }
            } catch (error: UpdateException) {
                _state.value = UpdateState.Error(error.message ?: "Checksum pembaruan tidak dapat diambil.")
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (error: Exception) {
                _state.value = UpdateState.Error(
                    "Unduhan gagal: ${error.message?.take(160) ?: "kesalahan tidak dikenal"}",
                )
            }
        }
    }

    /** Tombol "Batal" saat mengunduh. */
    fun cancelDownload() {
        downloadJob?.cancel()
        downloadJob = null
        downloader.cancel()
        _state.value = UpdateState.Idle
    }

    /** Tombol "Nanti"/"Tutup"; tidak membatalkan unduhan yang sedang berjalan. */
    fun dismiss() {
        if (_state.value is UpdateState.Downloading || _state.value is UpdateState.Checking) return
        _state.value = UpdateState.Idle
    }

    /** Intent pemasang sudah diluncurkan; dialog ditutup. */
    fun onInstallLaunched() {
        _state.value = UpdateState.Idle
    }

    /** Galat dari lapisan UI (FileProvider, Activity pemasang tidak ada, izin). */
    fun reportError(message: String) {
        _state.value = UpdateState.Error(message)
    }

    private fun check(manual: Boolean) {
        if (checkJob?.isActive == true) return
        if (_state.value is UpdateState.Downloading) return
        _state.value = UpdateState.Checking
        checkJob = viewModelScope.launch {
            try {
                val release = repository.fetchLatestRelease()
                if (repository.isUpdateAvailable(release, installedVersionName)) {
                    _state.value = UpdateState.Available(release)
                } else {
                    _state.value = if (manual) {
                        UpdateState.UpToDate(installedVersionName)
                    } else {
                        UpdateState.Idle
                    }
                }
            } catch (error: UpdateException) {
                _state.value = if (manual) {
                    UpdateState.Error(error.message ?: "Gagal memeriksa pembaruan.")
                } else {
                    UpdateState.Idle
                }
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (error: Exception) {
                _state.value = if (manual) {
                    UpdateState.Error(
                        "Gagal memeriksa pembaruan: ${error.message?.take(160) ?: "kesalahan tidak dikenal"}",
                    )
                } else {
                    UpdateState.Idle
                }
            }
        }
    }
}
