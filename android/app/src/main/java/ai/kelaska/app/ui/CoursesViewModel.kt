package ai.kelaska.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.StageDocument
import ai.kelaska.app.data.StageSummary
import ai.kelaska.app.data.KelasKaApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** State daftar kursus. */
data class CoursesUiState(
    val loading: Boolean = true,
    val stages: List<StageSummary> = emptyList(),
    val error: String? = null,
    /** Akun tertahan gate API key: daftar kursus tidak bisa dimuat sampai key dihubungkan. */
    val apiKeyRequired: Boolean = false,
)

class CoursesViewModel(private val api: KelasKaApi) : ViewModel() {

    private val _state = MutableStateFlow(CoursesUiState())
    val state: StateFlow<CoursesUiState> = _state.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    /** Pesan satu-kali (snackbar); dibersihkan oleh layar setelah ditampilkan. */
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null, apiKeyRequired = false)
            try {
                val stages = api.listStages()
                _state.value = CoursesUiState(loading = false, stages = stages)
            } catch (error: ai.kelaska.app.data.AuthExpiredException) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = "Sesi berakhir. Keluar lalu masuk kembali.",
                )
            } catch (error: ai.kelaska.app.data.ApiException) {
                val needsKey = error.errorCode == ai.kelaska.app.data.ApiErrorParser.API_KEY_REQUIRED
                _state.value = _state.value.copy(
                    loading = false,
                    apiKeyRequired = needsKey,
                    error = if (needsKey) {
                        "Akun ini perlu menghubungkan API key sebelum kursus bisa dimuat."
                    } else {
                        error.message ?: "Gagal memuat daftar kursus"
                    },
                )
            } catch (error: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = error.message ?: "Gagal memuat daftar kursus",
                )
            }
        }
    }

    fun createCourse(name: String, description: String?, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            try {
                api.createStage(name.trim(), description?.trim())
                _notice.value = "Kursus “${name.trim()}” dibuat"
                refresh()
                onDone()
            } catch (error: Exception) {
                _notice.value = "Gagal membuat kursus: ${error.message.orEmpty()}"
            }
        }
    }

    fun renameCourse(id: String, name: String) {
        viewModelScope.launch {
            try {
                api.renameStage(id, name.trim())
                _notice.value = "Nama kursus diubah"
                refresh()
            } catch (error: Exception) {
                _notice.value = "Gagal mengubah nama: ${error.message.orEmpty()}"
            }
        }
    }

    fun deleteCourse(id: String) {
        viewModelScope.launch {
            try {
                api.deleteStage(id)
                _notice.value = "Kursus dihapus"
                refresh()
            } catch (error: Exception) {
                _notice.value = "Gagal menghapus: ${error.message.orEmpty()}"
            }
        }
    }

    fun consumeNotice() {
        _notice.value = null
    }
}
