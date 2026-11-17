package ai.kelaska.app.util

import java.net.URI
import java.net.URLEncoder

/**
 * Tautan dan cookie untuk halaman web yang dibuka di WebView Android.
 *
 * Murni JVM (tanpa `android.net.Uri`) supaya bisa diuji dengan unit test dan
 * dipakai dari WebView maupun dari Custom Tab. Kelas daring memakai halaman web
 * yang sama dengan desktop — layout responsifnya yang menentukan tampilan
 * mobile, jadi tidak ada parameter "mobile" khusus yang perlu ditambahkan.
 */
object ClassWebLink {
    /** URL halaman kelas: `<base>/classroom/<id>`. */
    fun classroomUrl(baseUrl: String, stageId: String): String {
        require(stageId.isNotBlank()) { "stageId tidak boleh kosong" }
        val encodedId = URLEncoder.encode(stageId, "UTF-8").replace("+", "%20")
        return absoluteUrl(baseUrl, "classroom/$encodedId")
    }

    /**
     * URL wizard API key: `<base>/onboarding/api-key`.
     *
     * Halaman ini satu-satunya halaman yang boleh dibuka akun tanpa API key
     * terverifikasi, jadi aplikasi membukanya dari WebView saat server menjawab
     * `API_KEY_REQUIRED` atau mengalihkan halaman kelas ke sini.
     */
    fun apiKeyOnboardingUrl(baseUrl: String): String =
        absoluteUrl(baseUrl, "onboarding/api-key")

    /** True bila URL yang dimuat WebView adalah wizard API key. */
    fun isApiKeyOnboardingUrl(rawUrl: String): Boolean =
        pathOf(rawUrl)?.let { it == ONBOARDING_PATH || it.startsWith("$ONBOARDING_PATH/") } == true

    /**
     * Nilai cookie `Set-Cookie` untuk `kelaska_session`. Atributnya mengikuti
     * `sessionCookieHeader()` di sisi web: Path=/, HttpOnly, SameSite=Lax dan
     * Secure (situs produksi memakai HTTPS).
     */
    fun sessionCookie(token: String): String {
        require(token.isNotBlank()) { "token sesi tidak boleh kosong" }
        return "kelaska_session=$token; Path=/; HttpOnly; SameSite=Lax; Secure"
    }

    /** Host asal BASE_URL — dipakai untuk memutuskan tautan internal/eksternal. */
    fun baseHost(baseUrl: String): String? = runCatching { URI(baseUrl).host }.getOrNull()

    /**
     * True bila [rawUrl] berada di situs yang sama dengan [baseUrl]. Subdomain
     * ikut dianggap internal (mis. `www`), host lain dibuka di Custom Tab.
     */
    fun isSameSite(baseUrl: String, rawUrl: String): Boolean {
        val baseHost = baseHost(baseUrl) ?: return false
        val targetHost = runCatching { URI(rawUrl).host }.getOrNull() ?: return false
        return targetHost == baseHost || targetHost.endsWith(".$baseHost")
    }

    private const val ONBOARDING_PATH = "/onboarding/api-key"

    private fun absoluteUrl(baseUrl: String, path: String): String {
        require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
            "baseUrl harus diawali http:// atau https://: $baseUrl"
        }
        return "${baseUrl.trimEnd('/')}/$path"
    }

    private fun pathOf(rawUrl: String): String? =
        runCatching { URI(rawUrl).path }.getOrNull()
}
