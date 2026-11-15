package ai.kelaska.app.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.offline.OfflineImportException
import ai.kelaska.app.data.offline.OfflinePackageMeta
import ai.kelaska.app.data.offline.OfflinePackageStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

data class OfflineLibraryUiState(
    val loading: Boolean = true,
    val packages: List<OfflinePackageMeta> = emptyList(),
    val totalBytes: Long = 0,
    val importing: Boolean = false,
    val progress: Float = 0f,
    val notice: String? = null,
    val error: String? = null,
)

/** Daftar paket `.maic.zip` terpasang, impor, dan hapus. */
class OfflineLibraryViewModel(
    private val store: OfflinePackageStore,
    private val appContext: Context,
) : ViewModel() {

    private val _state = MutableStateFlow(OfflineLibraryUiState())
    val state: StateFlow<OfflineLibraryUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val packages = withContext(Dispatchers.IO) { store.list() }
            val total = withContext(Dispatchers.IO) { store.totalBytes() }
            _state.update { it.copy(loading = false, packages = packages, totalBytes = total) }
        }
    }

    /**
     * Impor dari URI SAF: salin ke cache dulu (URI bisa hilang setelah
     * pemilih ditutup), lalu ekstrak lewat store yang memvalidasi manifest.
     */
    fun import(uri: Uri) {
        if (_state.value.importing) return
        _state.update { it.copy(importing = true, progress = 0f, error = null) }
        viewModelScope.launch {
            var tempToDelete: File? = null
            try {
                val sourceName = withContext(Dispatchers.IO) { displayName(uri) }
                val temp = withContext(Dispatchers.IO) {
                    val file = File.createTempFile("maic-import-", ".zip", appContext.cacheDir)
                    appContext.contentResolver.openInputStream(uri)?.use { input ->
                        file.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
                    } ?: throw OfflineImportException("Berkas tidak bisa dibaca dari penyimpanan.")
                    file
                }
                tempToDelete = temp
                _state.update { it.copy(progress = 0.1f) }
                val meta = withContext(Dispatchers.IO) {
                    store.importZip(temp, sourceName) { fraction ->
                        _state.update { current ->
                            current.copy(progress = (0.1f + fraction * 0.9f).coerceIn(0f, 1f))
                        }
                    }
                }
                val packages = withContext(Dispatchers.IO) { store.list() }
                val total = withContext(Dispatchers.IO) { store.totalBytes() }
                _state.update {
                    it.copy(
                        importing = false,
                        progress = 0f,
                        packages = packages,
                        totalBytes = total,
                        notice = "Kursus “${meta.displayName}” siap diputar offline",
                    )
                }
            } catch (error: OfflineImportException) {
                _state.update {
                    it.copy(importing = false, progress = 0f, error = error.message)
                }
            } catch (error: IOException) {
                _state.update {
                    it.copy(
                        importing = false,
                        progress = 0f,
                        error = "Impor gagal: penyimpanan tidak cukup atau berkas rusak.",
                    )
                }
            } catch (error: Exception) {
                _state.update {
                    it.copy(
                        importing = false,
                        progress = 0f,
                        error = "Impor gagal: ${error.message?.take(160).orEmpty()}",
                    )
                }
            } finally {
                tempToDelete?.delete()
            }
        }
    }

    fun delete(meta: OfflinePackageMeta) {
        viewModelScope.launch {
            val removed = withContext(Dispatchers.IO) { store.delete(meta.id) }
            val packages = withContext(Dispatchers.IO) { store.list() }
            val total = withContext(Dispatchers.IO) { store.totalBytes() }
            _state.update {
                it.copy(
                    packages = packages,
                    totalBytes = total,
                    notice = if (removed) {
                        "Kursus “${meta.displayName}” dihapus dari perangkat"
                    } else {
                        "Kursus tidak ditemukan"
                    },
                )
            }
        }
    }

    fun consumeNotice() {
        _state.update { it.copy(notice = null) }
    }

    fun consumeError() {
        _state.update { it.copy(error = null) }
    }

    private fun displayName(uri: Uri): String? =
        runCatching {
            appContext.contentResolver
                .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }
        }.getOrNull()
}
