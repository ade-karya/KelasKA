package ai.kelaska.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.json.Json

/** Profil ringkas yang disimpan untuk tampilan tanpa jaringan. */
@kotlinx.serialization.Serializable
data class CachedProfile(
    val id: String,
    val name: String,
    val email: String,
    val role: String,
)

/**
 * Penyimpanan sesi aplikasi. `kelaska_session` hidup di EncryptedSharedPreferences
 * (keystore Android), tidak pernah ditulis ke disk polos. Tidak ada penyimpanan
 * kredensial Supabase: token akses Supabase langsung ditukar menjadi sesi Kelas KA.
 */
class SessionStore(context: Context) {
    private val preferences: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "kelaska_session_store",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var sessionToken: String?
        get() = preferences.getString(KEY_SESSION, null)
        set(value) {
            if (value == null) preferences.edit().remove(KEY_SESSION).apply()
            else preferences.edit().putString(KEY_SESSION, value).apply()
        }

    var cachedProfile: CachedProfile?
        get() = preferences.getString(KEY_PROFILE, null)?.let {
            runCatching { PROFILE_JSON.decodeFromString<CachedProfile>(it) }.getOrNull()
        }
        set(value) {
            if (value == null) preferences.edit().remove(KEY_PROFILE).apply()
            else preferences.edit().putString(KEY_PROFILE, PROFILE_JSON.encodeToString(CachedProfile.serializer(), value)).apply()
        }

    /** Verifier PKCE sekali pakai selama alur login berlangsung. */
    var pkceVerifier: String?
        get() = preferences.getString(KEY_PKCE, null)
        set(value) {
            if (value == null) preferences.edit().remove(KEY_PKCE).apply()
            else preferences.edit().putString(KEY_PKCE, value).apply()
        }

    fun isSignedIn(): Boolean = !sessionToken.isNullOrBlank()

    fun clearSession() {
        preferences.edit()
            .remove(KEY_SESSION)
            .remove(KEY_PROFILE)
            .remove(KEY_PKCE)
            .apply()
    }

    private companion object {
        const val KEY_SESSION = "kelaska_session"
        const val KEY_PROFILE = "profile_json"
        const val KEY_PKCE = "pkce_verifier"
        val PROFILE_JSON = Json { ignoreUnknownKeys = true }
    }
}
