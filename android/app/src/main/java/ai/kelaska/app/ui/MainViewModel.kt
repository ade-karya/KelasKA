package ai.kelaska.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.ApiException
import ai.kelaska.app.data.AuthExpiredException
import ai.kelaska.app.data.CachedProfile
import ai.kelaska.app.data.KelasKaApi
import ai.kelaska.app.data.SessionStore
import ai.kelaska.app.data.SignInException
import ai.kelaska.app.data.SupabasePkce
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Status autentikasi yang mengarahkan seluruh navigasi. */
sealed interface AuthState {
    data object Loading : AuthState
    data class SignedOut(val error: String? = null) : AuthState
    data object PendingApproval : AuthState
    data class SignedIn(val profile: CachedProfile) : AuthState
}

class MainViewModel(
    private val api: KelasKaApi,
    private val sessionStore: SessionStore,
    private val supabase: SupabasePkce,
) : ViewModel() {

    private val _authState = MutableStateFlow<AuthState>(AuthState.Loading)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    init {
        checkExistingSession()
    }

    private fun checkExistingSession() {
        viewModelScope.launch {
            if (!sessionStore.isSignedIn()) {
                _authState.value = AuthState.SignedOut()
                return@launch
            }
            try {
                val me = api.me()
                val user = me.user
                if (me.enabled && user != null) {
                    cacheProfile(user.id, user.name, user.email, user.role)
                    _authState.value = AuthState.SignedIn(sessionStore.cachedProfile!!)
                } else {
                    _authState.value = AuthState.SignedOut()
                }
            } catch (_: AuthExpiredException) {
                _authState.value = AuthState.SignedOut()
            } catch (error: Exception) {
                // Jaringan bermasalah: pertahankan sesi tersimpan bila ada.
                val cached = sessionStore.cachedProfile
                _authState.value = if (cached != null) {
                    AuthState.SignedIn(cached)
                } else {
                    AuthState.SignedOut("Tidak dapat terhubung ke kelaska.riau.ai. ${error.message.orEmpty()}".trim())
                }
            }
        }
    }

    /** URL consent Google; pemverifikasi PKCE disimpan untuk langkah kembali. */
    fun startGoogleSignIn(): String {
        val challenge = supabase.newChallenge()
        sessionStore.pkceVerifier = challenge.verifier
        return supabase.authorizeUrl(challenge.challenge)
    }

    /** Deep link masuk: tukar code → token Supabase → sesi Kelas KA. */
    fun onAuthCallback(code: String) {
        viewModelScope.launch {
            _authState.value = AuthState.Loading
            val verifier = sessionStore.pkceVerifier
            if (verifier.isNullOrBlank()) {
                _authState.value = AuthState.SignedOut("Alur masuk tidak valid. Coba lagi.")
                return@launch
            }
            try {
                val accessToken = supabase.exchangeCode(code, verifier)
                sessionStore.pkceVerifier = null
                val response = api.nativeSession(accessToken)
                val user = response.user
                if (response.token != null && response.success && user != null) {
                    sessionStore.sessionToken = response.token
                    cacheProfile(user.id, user.name, user.email, user.role)
                    _authState.value = AuthState.SignedIn(sessionStore.cachedProfile!!)
                } else {
                    _authState.value = AuthState.SignedOut("Respons login tidak valid.")
                }
            } catch (_: SignInException) {
                _authState.value = AuthState.SignedOut("Gagal masuk lewat Google. Coba lagi.")
            } catch (error: ApiException) {
                if (error.statusCode == 403) {
                    sessionStore.pkceVerifier = null
                    _authState.value = AuthState.PendingApproval
                } else {
                    _authState.value = AuthState.SignedOut(error.message ?: "Gagal masuk.")
                }
            } catch (error: Exception) {
                _authState.value = AuthState.SignedOut("Gagal masuk. ${error.message.orEmpty()}".trim())
            }
        }
    }

    fun onAuthCallbackFailed(message: String) {
        sessionStore.pkceVerifier = null
        _authState.value = AuthState.SignedOut(message)
    }

    fun signOut() {
        viewModelScope.launch {
            api.logout()
            _authState.value = AuthState.SignedOut()
        }
    }

    private fun cacheProfile(id: String, name: String, email: String, role: String) {
        sessionStore.cachedProfile = CachedProfile(
            id = id,
            name = name.ifBlank { email.substringBefore('@') },
            email = email,
            role = role,
        )
    }
}
