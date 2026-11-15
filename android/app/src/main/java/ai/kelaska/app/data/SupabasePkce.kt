package ai.kelaska.app.data

import java.security.MessageDigest
import java.security.SecureRandom
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Klien PKCE ringan ke Supabase Auth. Hanya dua langkah yang dipakai:
 * membangun URL consent Google, dan menukar `code` kembali menjadi token
 * (`grant_type=pkce`). Semuanya terjadi di dalam aplikasi — tidak ada WebView,
 * jadi aturan Google tentang embedded webview tidak berlaku.
 */
class SupabasePkce(
    private val supabaseUrl: String,
    private val publishableKey: String,
    private val deepLink: String,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
        .build(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    data class Challenge(val verifier: String, val challenge: String)

    fun newChallenge(): Challenge {
        val random = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val verifier = base64Url(random)
        val challenge = base64Url(sha256(verifier.toByteArray(Charsets.US_ASCII)))
        return Challenge(verifier, challenge)
    }

    /** URL yang dibuka di Custom Tab; Supabase meneruskannya ke Google. */
    fun authorizeUrl(challenge: String): String {
        val redirect = java.net.URLEncoder.encode(deepLink, "UTF-8")
        return "${supabaseUrl.trimEnd('/')}/auth/v1/authorize" +
            "?provider=google" +
            "&redirect_to=$redirect" +
            "&code_challenge=$challenge" +
            "&code_challenge_method=s256"
    }

    /** Tukar `code` dari deep link menjadi token akses Supabase. */
    suspend fun exchangeCode(code: String, verifier: String): String =
        withContext(Dispatchers.IO) {
            val body = buildJsonObject {
                put("auth_code", code)
                put("code_verifier", verifier)
            }.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url("${supabaseUrl.trimEnd('/')}/auth/v1/token?grant_type=pkce")
                .header("apikey", publishableKey)
                .header("content-type", "application/json; charset=utf-8")
                .header("accept", "application/json")
                .post(body)
                .build()
            client.newCall(request).execute().use { response ->
                val payload = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw SignInException(
                        runCatching {
                            json.decodeFromString(SupabaseError.serializer(), payload).display
                        }.getOrNull() ?: "Pertukaran kode gagal (${response.code})",
                    )
                }
                json.decodeFromString(SupabaseTokenResponse.serializer(), payload).accessToken
                    ?: throw SignInException("Respons Supabase tidak memuat token akses")
            }
        }

    private fun base64Url(bytes: ByteArray): String =
        android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)
}

@Serializable
private data class SupabaseTokenResponse(
    val access_token: String? = null,
    val refresh_token: String? = null,
    val token_type: String? = null,
    val expires_in: Long? = null,
) {
    val accessToken: String? get() = access_token
}

@Serializable
private data class SupabaseError(
    val error: String? = null,
    val error_description: String? = null,
    val message: String? = null,
    val msg: String? = null,
) {
    val display: String? get() = error_description ?: message ?: msg ?: error
}
