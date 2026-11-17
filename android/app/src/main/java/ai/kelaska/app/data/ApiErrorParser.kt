package ai.kelaska.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** Hasil parsing amplop error API; `errorCode` dipakai layar untuk memilih aksi. */
data class ParsedApiError(
    val message: String,
    val errorCode: String? = null,
)

/**
 * Parser amplop error API Kelas KA.
 *
 * Server mengirim dua bentuk:
 * - `{"errorCode":"API_KEY_REQUIRED","error":{"code":"API_KEY_REQUIRED","message":"…"}}`
 * - `{"error":"pesan teks"}` untuk route lama.
 *
 * Decoding langsung ke `String` gagal pada bentuk pertama, sehingga aplikasi
 * menampilkan JSON mentah dan tidak bisa mengenali gate API key. Parser ini
 * membaca kedua bentuk dan tetap memberi pesan yang aman untuk body non-JSON.
 */
object ApiErrorParser {
    const val API_KEY_REQUIRED = "API_KEY_REQUIRED"

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    fun parse(statusCode: Int, payload: String): ParsedApiError {
        val defaultMessage = "Permintaan gagal ($statusCode)"
        val root = runCatching { json.parseToJsonElement(payload).jsonObject }.getOrNull()
            ?: return ParsedApiError(payload.trim().take(200).ifBlank { defaultMessage })

        val errorElement = root["error"]
        val errorObject = errorElement as? JsonObject
        val code = root.string("errorCode")
            ?: errorObject?.string("code")
        val message = errorObject?.string("message")
            ?: (errorElement as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
            ?: root.string("details")
            ?: defaultMessage
        return ParsedApiError(message, code)
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)
            ?.takeIf { it.isString }
            ?.content
            ?.takeIf { it.isNotBlank() }
}
