package ai.kelaska.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Ringkasan kursus untuk daftar (GET /api/stages). */
@Serializable
data class StageSummary(
    val id: String,
    val name: String,
    val description: String? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    val sceneCount: Int = 0,
    val folderId: String? = null,
)

@Serializable
data class StagesResponse(
    val stages: List<StageSummary> = emptyList(),
)

/** Metadata kursus (GET /api/stages/{id} → stage). */
@Serializable
data class StageMeta(
    val id: String,
    val name: String,
    val description: String? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

/** Satu halaman materi; `content` untuk tipe slide (SlideContent) atau quiz (QuizContent). */
@Serializable
data class SceneDto(
    val id: String,
    val stageId: String = "",
    val title: String = "",
    val order: Int = 0,
    val type: String = "slide",
    val content: JsonObject = JsonObject(emptyMap()),
    val createdAt: Long? = null,
    val updatedAt: Long? = null,
)

/** Dokumen kursus lengkap (GET /api/stages/{id}). */
@Serializable
data class StageDocument(
    val stage: StageMeta,
    val scenes: List<SceneDto> = emptyList(),
)

/** Akun (GET /api/auth/me → user; GET/PATCH /api/admin/users). */
@Serializable
data class AuthUserDto(
    val id: String,
    val email: String = "",
    val name: String = "",
    val role: String = "student",
    val active: Boolean = true,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val lastLoginAt: String? = null,
)

@Serializable
data class MeResponse(
    val success: Boolean = false,
    val enabled: Boolean = false,
    val user: AuthUserDto? = null,
)

@Serializable
data class AdminUsersResponse(
    val success: Boolean = false,
    val users: List<AuthUserDto> = emptyList(),
)

/** Hasil tukar token Supabase → sesi Kelas KA (POST /api/auth/native/session). */
@Serializable
data class NativeSessionResponse(
    val success: Boolean = false,
    val token: String? = null,
    val expiresIn: Long? = null,
    val user: NativeSessionUser? = null,
    val errorCode: String? = null,
    val error: String? = null,
)

@Serializable
data class NativeSessionUser(
    val id: String,
    val name: String = "",
    val email: String = "",
    val role: String = "student",
)

/** Respons buatan kursus kosong (POST /api/stages → 201). */
@Serializable
data class CreateStageResponse(
    val stage: StageSummary? = null,
)
