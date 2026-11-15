package ai.kelaska.app.data.offline

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Bentuk portabel `.maic.zip` yang dibaca pemutar offline.
 *
 * Semua field bertipe longgar dan punya nilai bawaan: arsip berasal dari
 * instalasi lain dan bisa membawa field yang belum dikenal aplikasi ini.
 */
@Serializable
data class OfflineManifest(
    val formatVersion: Int = 1,
    val requiredCapabilities: List<String> = emptyList(),
    val exportedAt: String? = null,
    val appVersion: String? = null,
    val stage: OfflineStage = OfflineStage(),
    val agents: List<OfflineAgent> = emptyList(),
    val scenes: List<OfflineScene> = emptyList(),
    val mediaIndex: Map<String, OfflineMediaEntry> = emptyMap(),
)

@Serializable
data class OfflineStage(
    val name: String = "",
    val description: String? = null,
    val language: String? = null,
    val style: String? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

@Serializable
data class OfflineAgent(
    val name: String = "",
    val role: String = "",
)

@Serializable
data class OfflineScene(
    val type: String = "slide",
    val title: String = "",
    val order: Int = 0,
    val content: JsonObject = JsonObject(emptyMap()),
    val actions: List<OfflineAction> = emptyList(),
)

/**
 * Aksi yang dibutuhkan pemutar offline. Aksi lain tetap ada di arsip tetapi
 * tidak dipakai (animasi papan tulis, widget, dan sebagainya).
 */
@Serializable
data class OfflineAction(
    val type: String = "",
    val text: String? = null,
    /** Path ZIP di dalam arsip, mis. `audio/audio-1.mp3`. */
    val audioRef: String? = null,
    /** Arsip lama menyimpan id aset, bukan path; dicocokkan lewat `sourceRef`. */
    val audioId: String? = null,
    val agentIndex: Int? = null,
)

@Serializable
data class OfflineMediaEntry(
    val type: String = "",
    val sourceRef: String? = null,
    val mimeType: String? = null,
    val format: String? = null,
    val missing: Boolean = false,
)

/** Metadata ringkas yang disimpan di samping `manifest.json` tiap paket. */
@Serializable
data class OfflinePackageMeta(
    val id: String,
    val displayName: String,
    val importedAt: Long,
    val sizeBytes: Long = 0,
    val sourceName: String? = null,
    val formatVersion: Int = 1,
    val sceneCount: Int = 0,
)

/** Satu klip narasi yang bisa diputar dari penyimpanan lokal. */
data class OfflineNarrationClip(
    val text: String,
    val audioPath: String?,
)

/** Galat impor yang pesannya layak ditampilkan ke pengguna. */
class OfflineImportException(message: String) : Exception(message)

/**
 * Kapabilitas impor yang dikenal. Paket PBL tetap bisa dibuka (scene-nya
 * ditampilkan sebagai kartu penjelasan), jadi kapabilitas PBL diterima.
 */
internal val SUPPORTED_OFFLINE_CAPABILITIES = setOf(
    "pbl-v3-projects@1",
    "pbl-v3-decision-responses@1",
    "pbl-v3-application@1",
    "pbl-v3-java-application@1",
    "pbl-v3-standalone-frontend@1",
    "pbl-v3-presentation@1",
    "pbl-v3-decision-context@1",
)
