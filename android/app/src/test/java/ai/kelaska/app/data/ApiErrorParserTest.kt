package ai.kelaska.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiErrorParserTest {
    @Test
    fun parse_mengenaliAmplopGateApiKey() {
        val parsed = ApiErrorParser.parse(
            403,
            """{"error":{"code":"API_KEY_REQUIRED","message":"A verified API key is required before the app can be used."},"errorCode":"API_KEY_REQUIRED"}""",
        )
        assertEquals("API_KEY_REQUIRED", parsed.errorCode)
        assertEquals(
            "A verified API key is required before the app can be used.",
            parsed.message,
        )
    }

    @Test
    fun parse_membacaErrorCodePipaRata() {
        val parsed = ApiErrorParser.parse(403, """{"errorCode":"API_KEY_REQUIRED"}""")
        assertEquals("API_KEY_REQUIRED", parsed.errorCode)
        // Tanpa pesan, fallback yang aman dipakai, bukan JSON mentah.
        assertEquals("Permintaan gagal (403)", parsed.message)
    }

    @Test
    fun parse_membacaPesanTeksLama() {
        val parsed = ApiErrorParser.parse(400, """{"error":"Judul wajib diisi"}""")
        assertEquals("Judul wajib diisi", parsed.message)
        assertNull(parsed.errorCode)
    }

    @Test
    fun parse_memakaiDetailsBilaTidakAdaPesan() {
        val parsed = ApiErrorParser.parse(500, """{"errorCode":"GENERATION_FAILED","details":"Model menolak permintaan"}""")
        assertEquals("GENERATION_FAILED", parsed.errorCode)
        assertEquals("Model menolak permintaan", parsed.message)
    }

    @Test
    fun parse_mempertahankanBodyNonJsonSebagaiPesan() {
        val parsed = ApiErrorParser.parse(502, "Bad Gateway")
        assertEquals("Bad Gateway", parsed.message)
        assertNull(parsed.errorCode)
    }

    @Test
    fun parse_memberiPesanDefaultUntukBodyKosong() {
        val parsed = ApiErrorParser.parse(500, "   ")
        assertEquals("Permintaan gagal (500)", parsed.message)
    }
}
