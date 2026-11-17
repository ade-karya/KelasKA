package ai.kelaska.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.json.put

/** Pengecualian API dengan kode HTTP, kode error server, dan pesan yang aman ditampilkan. */
class ApiException(
    val statusCode: Int,
    message: String,
    val errorCode: String? = null,
) : Exception(message)

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
                val parsed = ApiErrorParser.parse(res.code, payload)
                throw ApiException(res.code, parsed.message, parsed.errorCode)
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
}
