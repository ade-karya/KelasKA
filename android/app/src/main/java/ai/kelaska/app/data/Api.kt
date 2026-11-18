package ai.kelaska.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit

/** Pengecualian API dengan kode HTTP dan pesan yang aman ditampilkan. */
class ApiException(val statusCode: Int, message: String) : Exception(message)

/** Byte satu aset media dari server (gambar, audio, video, poster). */
data class MediaPayload(val bytes: ByteArray, val mimeType: String?)

/** 401: sesi tidak berlaku lagi; aplikasi meminta pengguna masuk kembali. */
class AuthExpiredException(message: String = "Sesi berakhir") : Exception(message)

/** Pengecualian saat tukar token Supabase gagal. */
class SignInException(message: String) : Exception(message)

/**
 * Klien HTTP ke backend Kelas KA (kelaska.riau.ai).
 *
 * Sesi dikirim sebagai header `Cookie: kelaska_session=…` secara eksplisit ke
 * setiap permintaan terautentikasi. Cookie tidak dikelola OkHttp secara global
 * supaya tidak ada kebocoran antar host.
 */
class KelasKaApi(
    private val sessionStore: SessionStore,
    private val baseUrl: String,
    private val client: okhttp3.OkHttpClient = okhttp3.OkHttpClient.Builder()
        .callTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build(),
) {
    private val json = kotlinx.serialization.json.Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    /**
     * Klien khusus unduhan media: satu kelas bisa membawa video puluhan MB,
     * sedangkan klien API biasa berbatas 30 detik untuk panggilan JSON.
     */
    private val mediaClient = client.newBuilder()
        .callTimeout(180, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        // Redirect ditangani sendiri: cookie sesi hanya boleh ikut ke host
        // aplikasi, tidak ke host byte store tempat aset dialihkan.
        .followRedirects(false)
        .build()

    private fun cookieHeader(): String? =
        sessionStore.sessionToken?.let { "kelaska_session=$it" }

    private fun request(
        method: String,
        path: String,
        body: kotlinx.serialization.json.JsonObject? = null,
        authenticated: Boolean = true,
    ): okhttp3.Request {
        val builder = okhttp3.Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("accept", "application/json")
        if (authenticated) {
            cookieHeader()?.let { builder.header("cookie", it) }
                ?: throw AuthExpiredException()
        }
        if (body != null) {
            val mediaType = "application/json; charset=utf-8".toMediaType()
            builder.header("content-type", "application/json; charset=utf-8")
            builder.method(method, body.toString().toRequestBody(mediaType))
        } else {
            builder.method(method, null)
        }
        return builder.build()
    }

    private suspend fun <T> execute(
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
        method: String,
        path: String,
        body: kotlinx.serialization.json.JsonObject? = null,
        authenticated: Boolean = true,
    ): T = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val response = client.newCall(request(method, path, body, authenticated)).execute()
        response.use { res ->
            val payload = res.body?.string().orEmpty()
            if (res.code == 401 && authenticated) {
                sessionStore.clearSession()
                throw AuthExpiredException()
            }
            if (!res.isSuccessful) {
                val message = runCatching {
                    json.decodeFromString(ApiErrorBody.serializer(), payload).error
                }.getOrNull() ?: payload.take(200)
                throw ApiException(res.code, message.ifBlank { "Permintaan gagal (${res.code})" })
            }
            if (payload.isBlank()) {
                throw ApiException(res.code, "Respons kosong dari server")
            }
            json.decodeFromString(deserializer, payload)
        }
    }

    /* -------------------------------------------------------- Akun (auth) */

    /** Tukar token akses Supabase menjadi sesi Kelas KA. */
    suspend fun nativeSession(accessToken: String): NativeSessionResponse =
        execute(
            NativeSessionResponse.serializer(),
            method = "POST",
            path = "/api/auth/native/session",
            body = buildJsonObject { put("accessToken", accessToken) },
            authenticated = false,
        )

    /** Profil akun yang sedang masuk (atau `enabled=false` bila akun dimatikan). */
    suspend fun me(): MeResponse =
        execute(MeResponse.serializer(), "GET", "/api/auth/me")

    /** Cabut sesi di server lalu bersihkan penyimpanan lokal. */
    suspend fun logout() {
        runCatching {
            execute(
                kotlinx.serialization.json.JsonObject.serializer(),
                method = "POST",
                path = "/api/auth/logout",
                body = kotlinx.serialization.json.JsonObject(emptyMap()),
            )
        }
        sessionStore.clearSession()
    }

    /* ----------------------------------------------------------- Kursus */

    suspend fun listStages(): List<StageSummary> =
        execute(StagesResponse.serializer(), "GET", "/api/stages").stages

    suspend fun getStageDocument(id: String): StageDocument =
        execute(StageDocument.serializer(), "GET", "/api/stages/$id")

    /**
     * Unduh byte satu referensi media dokumen kursus.
     *
     * Referensi yang didukung:
     * - `ast_…` → `GET /api/persistence/assets/{id}/content` (kumpulan aset),
     * - `/api/classroom-media/…` dan path statis seperti `/guide-course/…`,
     * - `http(s)://…` → URL langsung (tanpa cookie bila beda host).
     *
     * `null` berarti aset tidak tersedia/terlalu besar; IO biasa tidak
     * dilempar supaya satu gambar rusak tidak menggagalkan seluruh kelas.
     * Sesi kedaluwarsa tetap dilempar agar aplikasi meminta masuk kembali.
     */
    suspend fun fetchMedia(ref: String): MediaPayload? = kotlinx.coroutines.withContext(
        kotlinx.coroutines.Dispatchers.IO,
    ) {
        val url = mediaUrl(ref) ?: return@withContext null
        try {
            downloadMedia(url)
        } catch (error: AuthExpiredException) {
            throw error
        } catch (error: IOException) {
            null
        }
    }

    /**
     * Unduh satu URL media, mengikuti pengalihan secara manual.
     *
     * Cookie sesi hanya dipasang untuk request ke origin aplikasi; aset yang
     * dialihkan ke byte store/CDN diunduh tanpa cookie. Respons login/JSON
     * (mis. sesi habis lalu dialihkan ke `/login`) tidak dianggap media.
     */
    private fun downloadMedia(startUrl: String): MediaPayload? {
        var current = startUrl
        var redirects = 0
        while (true) {
            val target = current.toHttpUrlOrNull() ?: return null
            val sameOrigin = sameOriginAsBase(target)
            val builder = okhttp3.Request.Builder()
                .url(target)
                .header("accept", "*/*")
            if (sameOrigin) {
                cookieHeader()?.let { builder.header("cookie", it) }
                    ?: throw AuthExpiredException()
            }
            val response = mediaClient.newCall(builder.build()).execute()
            val location = response.header("location")
            if (response.code in 300..399 && location != null && redirects < MAX_REDIRECTS) {
                response.close()
                val next = target.resolve(location) ?: return null
                // Sesi habis: proxy mengalihkan media ke /login, bukan 401.
                if (sameOriginAsBase(next) && next.encodedPath.startsWith("/login")) {
                    sessionStore.clearSession()
                    throw AuthExpiredException()
                }
                current = next.toString()
                redirects += 1
                continue
            }
            return response.use {
                if (sameOrigin && (it.code == 401 || it.code == 403)) {
                    sessionStore.clearSession()
                    throw AuthExpiredException()
                }
                if (sameOrigin && it.request.url.encodedPath.startsWith("/login")) {
                    // 200 halaman login yang menggantikan media juga berarti sesi habis.
                    sessionStore.clearSession()
                    throw AuthExpiredException()
                }
                if (!it.isSuccessful) return@use null
                val body = it.body ?: return@use null
                if (body.contentLength() > MAX_MEDIA_BYTES) return@use null
                val mime = body.contentType()?.toString()?.substringBefore(';')?.trim()
                if (mime != null && (mime.startsWith("text/html") || mime == "application/json")) {
                    return@use null
                }
                val bytes = body.byteStream().use { readLimited(it, MAX_MEDIA_BYTES) }
                    ?: return@use null
                if (bytes.isEmpty()) return@use null
                MediaPayload(bytes = bytes, mimeType = mime)
            }
        }
    }

    /** Path HTTP untuk satu referensi media; `null` bila bentuknya tidak dikenal. */
    private fun mediaUrl(ref: String): String? {
        val base = baseUrl.trimEnd('/')
        return when {
            ref.startsWith("ast_") -> "$base/api/persistence/assets/$ref/content"
            // Path statis di origin aplikasi (`/guide-course/…`, `/api/…`).
            ref.startsWith("/") && !ref.startsWith("//") -> "$base$ref"
            ref.startsWith("//") -> "https:$ref"
            ref.startsWith("https://") || ref.startsWith("http://") -> ref
            else -> null
        }
    }

    private fun sameOriginAsBase(url: okhttp3.HttpUrl): Boolean {
        val base = baseUrl.toHttpUrlOrNull() ?: return false
        return url.scheme == base.scheme &&
            url.host == base.host &&
            url.port == base.port
    }

    private fun readLimited(input: InputStream, maxBytes: Long): ByteArray? {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > maxBytes) return null
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    suspend fun createStage(name: String, description: String?): StageSummary? {
        val response = execute(
            CreateStageResponse.serializer(),
            method = "POST",
            path = "/api/stages",
            body = buildJsonObject {
                put("name", name)
                if (!description.isNullOrBlank()) put("description", description)
            },
        )
        return response.stage
    }

    suspend fun renameStage(id: String, name: String) {
        execute(
            kotlinx.serialization.json.JsonObject.serializer(),
            method = "PATCH",
            path = "/api/stages/$id",
            body = buildJsonObject { put("name", name) },
        )
    }

    suspend fun deleteStage(id: String) {
        execute(
            kotlinx.serialization.json.JsonObject.serializer(),
            method = "DELETE",
            path = "/api/stages/$id",
        )
    }

    /* ------------------------------------------------------------- Admin */

    suspend fun listUsers(): List<AuthUserDto> =
        execute(AdminUsersResponse.serializer(), "GET", "/api/admin/users").users

    suspend fun setUserActive(id: String, active: Boolean): AuthUserDto =
        patchUser(id, buildJsonObject { put("active", active) })

    suspend fun setUserRole(id: String, role: String): AuthUserDto =
        patchUser(id, buildJsonObject { put("role", role) })

    private suspend fun patchUser(
        id: String,
        body: kotlinx.serialization.json.JsonObject,
    ): AuthUserDto {
        val response = execute(
            kotlinx.serialization.json.JsonObject.serializer(),
            method = "PATCH",
            path = "/api/admin/users/$id",
            body = body,
        )
        val userJson = response["user"]
            ?: throw ApiException(500, "Respons admin tidak valid")
        return json.decodeFromJsonElement(AuthUserDto.serializer(), userJson)
    }

    private companion object {
        /**
         * Batas satu aset. Pemutar menanam seluruh media ke satu dokumen HTML
         * di memori, jadi aset raksasa harus dilewati, bukan dipaksakan.
         */
        const val MAX_MEDIA_BYTES = 64L * 1024 * 1024
        /** Rantai pengalihan aset (byte store atau CDN) yang masih wajar. */
        const val MAX_REDIRECTS = 4
    }
}
