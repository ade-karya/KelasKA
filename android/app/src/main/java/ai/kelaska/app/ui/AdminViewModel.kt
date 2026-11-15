package ai.kelaska.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.AuthUserDto
import ai.kelaska.app.data.KelasKaApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AdminUiState(
    val loading: Boolean = true,
    val users: List<AuthUserDto> = emptyList(),
    val error: String? = null,
)

class AdminViewModel(private val api: KelasKaApi) : ViewModel() {

    private val _state = MutableStateFlow(AdminUiState())
    val state: StateFlow<AdminUiState> = _state.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                _state.value = AdminUiState(loading = false, users = api.listUsers())
            } catch (error: ai.kelaska.app.data.AuthExpiredException) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = "Sesi berakhir. Keluar lalu masuk kembali.",
                )
            } catch (error: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = error.message ?: "Gagal memuat daftar akun",
                )
            }
        }
    }

    fun setActive(user: AuthUserDto, active: Boolean) {
        viewModelScope.launch {
            try {
                api.setUserActive(user.id, active)
                _notice.value = if (active) "Akun ${user.email} disetujui" else "Akun ${user.email} dinonaktifkan"
                refresh()
            } catch (error: Exception) {
                _notice.value = "Gagal mengubah status: ${error.message.orEmpty()}"
            }
        }
    }

    fun setRole(user: AuthUserDto, role: String) {
        viewModelScope.launch {
            try {
                api.setUserRole(user.id, role)
                _notice.value = "Peran ${user.email} menjadi $role"
                refresh()
            } catch (error: Exception) {
                _notice.value = "Gagal mengubah peran: ${error.message.orEmpty()}"
            }
        }
    }

    fun consumeNotice() {
        _notice.value = null
    }
}
