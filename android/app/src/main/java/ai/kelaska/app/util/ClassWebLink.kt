package ai.kelaska.app.util

import java.net.URI
import java.net.URLEncoder

/**
 * Tautan dan cookie untuk kelas daring yang dibuka di WebView Android.
 *
 * Murni JVM (tanpa `android.net.Uri`) supaya bisa diuji dengan unit test dan
 * dipakai dari WebView maupun dari Custom Tab. Kelas daring memakai halaman web
 * yang sama dengan desktop — layout responsifnya yang menentukan tampilan
 * mobile, jadi tidak ada parameter "mobile" khusus yang perlu ditambahkan.
 */
object ClassWebLink {
    /** URL halaman kelas: `<base>/classroom/<id>`. */
    fun classroomUrl(baseUrl: String, stageId: String): String {
        require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
            "baseUrl harus diawali http:// atau https://: $baseUrl"
        }
        require(stageId.isNotBlank()) { "stageId tidak boleh kosong" }
        val encodedId = URLEncoder.encode(stageId, "UTF-8").replace("+", "%20")
        return "${baseUrl.trimEnd('/')}/classroom/$encodedId"
    }

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
}
