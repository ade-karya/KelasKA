package ai.kelaska.app.data.online

import ai.kelaska.app.data.StageDocument
import ai.kelaska.app.data.offline.OfflineCourse
import ai.kelaska.app.data.offline.OfflineManifest
import ai.kelaska.app.data.offline.OfflinePackageMeta
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/**
 * Menyiapkan kursus daring menjadi paket lokal yang bisa diputar
 * [ai.kelaska.app.ui.screens.ClassPlayerScreen].
 *
 * Pemutar aplikasi hanya mengenal satu bentuk masukan: direktori paket berisi
 * `manifest.json` + berkas media (bentuk `.maic.zip` yang sudah diekstrak).
 * Dokumen `GET /api/stages/{id}` belum berbentuk itu — referensinya masih
 * berupa id aset (`ast_…`), path `/api/classroom-media/…`, atau URL. Builder
 * ini menjembatani keduanya: kumpulkan referensi, unduh byte-nya lewat
 * [fetch], tulis manifest dengan `sourceRef` yang sama, lalu [OfflineCourse]
 * memetakan referensi dokumen ke berkas lokal persis seperti paket offline.
 *
 * Hasilnya disimpan di `cacheDir/online-classes/<stageId>` dan dipakai ulang
 * selama sidik dokumen (hash isi `GET /api/stages/{id}`) tidak berubah. Cache
 * bisa dihapus kapan saja oleh Android; kursus akan diunduh ulang.
 */
class OnlineCourseBuilder(
    private val cacheRoot: File,
    private val appVersion: String,
    private val maxCachedCourses: Int = 4,
) {
    /** Byte satu aset beserta MIME dari server. */
    data class DownloadedMedia(val bytes: ByteArray, val mimeType: String?)

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
        coerceInputValues = true
    }

    /**
     * Bangun (atau ambil dari cache) paket lokal untuk [document].
     *
     * [fetch] dipanggil untuk setiap referensi media; `null` berarti aset itu
     * tidak tersedia (mis. 404) dan dilewati tanpa menggagalkan kelas.
     * [onProgress] melaporkan jumlah aset yang sudah diproses.
     */
    suspend fun build(
        stageId: String,
        document: StageDocument,
        fetch: suspend (ref: String) -> DownloadedMedia?,
        onProgress: (completed: Int, total: Int) -> Unit = { _, _ -> },
    ): OfflineCourse {
        val safeId = safeId(stageId)
        val packageId = "online-$safeId"
        val fingerprint = fingerprint(document)
        val packageDir = File(cacheRoot, safeId)

        loadCached(packageDir, packageId, fingerprint)?.let {
            onProgress(1, 1)
            return it
        }

        val refs = collectMediaRefs(document)
        onProgress(0, refs.size)
        val downloaded = download(refs, fetch, onProgress)

        val staging = File(cacheRoot, ".building-${UUID.randomUUID()}")
        if (!staging.mkdirs()) {
            throw IOException("Tidak bisa menyiapkan penyimpanan kelas.")
        }
        try {
            val (mediaIndex, writtenBytes) = writeMedia(staging, downloaded)
            val manifestText = json.encodeToString(
                JsonObject.serializer(),
                buildManifest(document, mediaIndex),
            )
            File(staging, "manifest.json").writeText(manifestText)
            File(staging, READY_FILE).writeText(fingerprint)

            val meta = OfflinePackageMeta(
                id = packageId,
                displayName = document.stage.name.ifBlank { "Kelas" },
                importedAt = System.currentTimeMillis(),
                sizeBytes = writtenBytes,
                sourceName = "kelaska.riau.ai",
                formatVersion = FORMAT_VERSION,
                sceneCount = document.scenes.size,
            )
            File(staging, META_FILE).writeText(
                json.encodeToString(OfflinePackageMeta.serializer(), meta),
            )

            // Direktori hanya dipublikasikan setelah semua berkas siap, jadi
            // cache yang ada selalu utuh dan bisa langsung diputar.
            if (packageDir.exists() && !packageDir.deleteRecursively()) {
                throw IOException("Tidak bisa mengganti cache kelas lama.")
            }
            if (!staging.renameTo(packageDir)) {
                throw IOException("Tidak bisa menyimpan kelas di perangkat.")
            }
            sweepCache(packageDir)
            return OfflineCourse(
                meta = meta,
                manifest = decodeManifest(packageDir),
                rootDir = packageDir,
            )
        } catch (error: Exception) {
            staging.deleteRecursively()
            throw error
        }
    }

    private fun loadCached(
        dir: File,
        packageId: String,
        fingerprint: String,
    ): OfflineCourse? {
        if (!dir.isDirectory) return null
        val ready = File(dir, READY_FILE)
        if (!ready.isFile || ready.readText() != fingerprint) return null
        val metaFile = File(dir, META_FILE)
        if (!metaFile.isFile || !File(dir, "manifest.json").isFile) return null
        return runCatching {
            val meta = json.decodeFromString(
                OfflinePackageMeta.serializer(),
                metaFile.readText(),
            )
            if (meta.id != packageId) return null
            OfflineCourse(meta, decodeManifest(dir), dir)
        }.getOrNull()
    }

    private fun decodeManifest(dir: File): OfflineManifest =
        json.decodeFromString(
            OfflineManifest.serializer(),
            File(dir, "manifest.json").readText(),
        )

    private suspend fun download(
        refs: List<String>,
        fetch: suspend (String) -> DownloadedMedia?,
        onProgress: (Int, Int) -> Unit,
    ): Map<String, DownloadedMedia> {
        if (refs.isEmpty()) return emptyMap()
        val total = refs.size
        val done = AtomicInteger(0)
        val downloaded = LinkedHashMap<String, DownloadedMedia>()
        val gate = Semaphore(PARALLEL_DOWNLOADS)
        coroutineScope {
            refs.map { ref ->
                async {
                    gate.withPermit {
                        // fetch mengembalikan null untuk aset yang tidak tersedia;
                        // kegagalan jaringan tidak menggagalkan seluruh kelas.
                        val media = fetch(ref)
                        if (media != null && media.bytes.isNotEmpty()) {
                            synchronized(downloaded) { downloaded[ref] = media }
                        }
                        onProgress(done.incrementAndGet(), total)
                    }
                }
            }.awaitAll()
        }
        return downloaded
    }

    /**
     * Tulis byte ke `media/`/`audio/` dan bentuk `mediaIndex`.
     *
     * `StandalonePlayerHtml` memakai MIME untuk memilih jalur audio (`data:`
     * URI) versus blok base64, jadi MIME harus sudah pasti di sini.
     */
    private fun writeMedia(
        root: File,
        downloaded: Map<String, DownloadedMedia>,
    ): Pair<Map<String, JsonObject>, Long> {
        val index = LinkedHashMap<String, JsonObject>()
        var audioCount = 0
        var mediaCount = 0
        var totalBytes = 0L
        for ((ref, media) in downloaded) {
            if (totalBytes + media.bytes.size > MAX_TOTAL_BYTES) break
            val mime = resolveMime(ref, media)
            val audio = mime.startsWith("audio/")
            val extension = extensionFor(mime, ref)
            val path = if (audio) {
                "audio/asset-${++audioCount}.$extension"
            } else {
                "media/asset-${++mediaCount}.$extension"
            }
            val file = File(root, path)
            file.parentFile?.mkdirs()
            file.writeBytes(media.bytes)
            totalBytes += media.bytes.size
            index[path] = buildJsonObject {
                put("type", if (audio) "audio" else "generated")
                put("sourceRef", ref)
                put("mimeType", mime)
                if (audio) put("format", extension)
                put("size", media.bytes.size)
            }
        }
        return index to totalBytes
    }

    private fun buildManifest(
        document: StageDocument,
        mediaIndex: Map<String, JsonObject>,
    ): JsonObject = buildJsonObject {
        put("formatVersion", FORMAT_VERSION)
        put("exportedAt", Instant.now().toString())
        put("appVersion", appVersion)
        put("stage", buildJsonObject {
            put("name", document.stage.name)
            document.stage.description?.let { put("description", it) }
            document.stage.languageDirective?.let { put("language", it) }
            document.stage.style?.let { put("style", it) }
            put("createdAt", document.stage.createdAt)
            put("updatedAt", document.stage.updatedAt)
        })
        // Pemutar mandiri tidak membaca roster agen; diskusi dirender sebagai
        // topik + tautan ke kelas daring, jadi daftar agen sengaja kosong.
        put("agents", JsonArray(emptyList()))
        put("scenes", buildJsonArray {
            document.scenes
                .withIndex()
                .sortedWith(compareBy({ it.value.order }, { it.index }))
                .forEach { (_, scene) ->
                    add(buildJsonObject {
                        put("type", scene.type)
                        put("title", scene.title)
                        put("order", scene.order)
                        put("content", scene.content)
                        scene.actions?.let { put("actions", prepareActions(it)) }
                        scene.whiteboards?.let { put("whiteboards", it) }
                        scene.multiAgent?.let { put("multiAgent", it) }
                    })
                }
        })
        put("mediaIndex", JsonObject(mediaIndex))
    }

    /**
     * Dokumen lama menyimpan narasi hanya sebagai `audioUrl`; pemutar mandiri
     * membaca `audioRef`/`audioId`. Salin `audioUrl` ke `audioRef` supaya
     * narasi kursus lama tetap berbunyi tanpa mengubah dokumen di server.
     */
    private fun prepareActions(actions: JsonArray): JsonArray = buildJsonArray {
        actions.forEach { element ->
            val action = element as? JsonObject
            if (action == null) {
                add(element)
                return@forEach
            }
            val legacyUrl = action["audioUrl"]?.let { (it as? JsonPrimitive)?.contentOrNull }
            val hasSource = action["audioId"] != null || action["audioRef"] != null
            if (action["type"]?.let { (it as? JsonPrimitive)?.contentOrNull } == "speech" &&
                !hasSource && !legacyUrl.isNullOrBlank()
            ) {
                add(buildJsonObject {
                    action.forEach { (key, value) -> put(key, value) }
                    put("audioRef", legacyUrl)
                })
            } else {
                add(action)
            }
        }
    }

    /**
     * Semua referensi yang mungkin menunjuk byte media.
     *
     * Id aset dikenali dari bentuknya (satu nilai string utuh); URL/path lain
     * hanya diambil dari kunci yang memang berisi media, supaya tautan biasa di
     * teks slide tidak ikut diunduh. `pointImages` pada chart memakai nama titik
     * sebagai kunci, jadi dipindai terpisah. HTML interaktif dipindai untuk id
     * aset/path media yang tertanam di dalamnya.
     */
    private fun collectMediaRefs(document: StageDocument): List<String> {
        val refs = LinkedHashSet<String>()
        document.scenes.forEach { scene ->
            collectRefs(scene.content, refs)
            scene.actions?.let { collectRefs(it, refs) }
            scene.whiteboards?.let { collectRefs(it, refs) }
        }
        return refs.toList()
    }

    private fun collectRefs(element: JsonElement, refs: MutableSet<String>) {
        when (element) {
            is JsonObject -> element.forEach { (key, value) ->
                when {
                    key == "pointImages" && value is JsonObject ->
                        value.forEach { (_, point) -> addRef(point, refs) }

                    key == "html" && value is JsonPrimitive && value.isString ->
                        collectRefsFromHtml(value.content, refs)

                    key in MEDIA_KEYS -> addRef(value, refs)

                    else -> collectRefs(value, refs)
                }
            }

            is JsonArray -> element.forEach { collectRefs(it, refs) }
            else -> Unit
        }
    }

    /** Catat satu nilai bila bentuknya referensi media yang bisa diunduh. */
    private fun addRef(element: JsonElement, refs: MutableSet<String>) {
        val text = (element as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: return collectRefs(element, refs)
        when {
            isAssetRef(text) -> refs += text
            text.startsWith(CLASSROOM_MEDIA_PREFIX) -> refs += text
            isRootRelative(text) || isRemoteUrl(text) -> refs += text
        }
    }

    private fun collectRefsFromHtml(html: String, refs: MutableSet<String>) {
        ASSET_REF_HINT.findAll(html).forEach { refs += it.value }
        CLASSROOM_MEDIA_HINT.findAll(html).forEach { refs += it.value }
    }

    private fun resolveMime(ref: String, media: DownloadedMedia): String {
        val declared = media.mimeType
            ?.substringBefore(';')
            ?.trim()
            ?.lowercase()
            ?.takeIf { it.isNotEmpty() && it != "application/octet-stream" && it != "binary/octet-stream" }
        return declared ?: sniffMime(media.bytes) ?: mimeFromRef(ref)
    }

    private fun mimeFromRef(ref: String): String =
        when (ref.substringBefore('?').substringAfterLast('.', "").lowercase()) {
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            "avif" -> "image/avif"
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "ogg", "opus" -> "audio/ogg"
            "m4a", "aac" -> "audio/mp4"
            "flac" -> "audio/flac"
            "mp4", "m4v" -> "video/mp4"
            "webm" -> "video/webm"
            "mov" -> "video/quicktime"
            else -> "application/octet-stream"
        }

    /** Deteksi format dari magic bytes ketika server tidak mengirim MIME. */
    private fun sniffMime(bytes: ByteArray): String? {
        fun startsWith(vararg prefix: Int): Boolean =
            bytes.size >= prefix.size && prefix.withIndex().all { (i, value) ->
                bytes[i].toInt() and 0xFF == value
            }

        return when {
            startsWith(0x89, 0x50, 0x4E, 0x47) -> "image/png"
            startsWith(0xFF, 0xD8, 0xFF) -> "image/jpeg"
            startsWith(0x47, 0x49, 0x46, 0x38) -> "image/gif"
            startsWith(0x4F, 0x67, 0x67, 0x53) -> "audio/ogg"
            startsWith(0x1A, 0x45, 0xDF, 0xA3) -> "video/webm"
            startsWith(0x49, 0x44, 0x33) -> "audio/mpeg"
            startsWith(0xFF, 0xFB) || startsWith(0xFF, 0xF3) ||
                startsWith(0xFF, 0xF2) -> "audio/mpeg"
            ascii(bytes, 0, 4) == "RIFF" && ascii(bytes, 8, 4) == "WAVE" -> "audio/wav"
            ascii(bytes, 0, 4) == "RIFF" && ascii(bytes, 8, 4) == "WEBP" -> "image/webp"
            ascii(bytes, 4, 4) == "ftyp" -> {
                val brand = ascii(bytes, 8, 4)
                if (brand.startsWith("M4A") || brand.startsWith("M4B")) "audio/mp4"
                else "video/mp4"
            }
            startsWith(0x3C) -> {
                val head = bytes.decodeToString(0, minOf(bytes.size, 512)).trimStart().lowercase()
                if (head.startsWith("<svg") || (head.startsWith("<?xml") && "<svg" in head)) {
                    "image/svg+xml"
                } else {
                    null
                }
            }
            else -> null
        }
    }

    private fun ascii(bytes: ByteArray, offset: Int, length: Int): String {
        if (offset < 0 || length <= 0 || offset + length > bytes.size) return ""
        return bytes.decodeToString(offset, offset + length)
    }

    private fun extensionFor(mime: String, ref: String): String =
        when (mime.substringBefore(';').lowercase()) {
            "image/png" -> "png"
            "image/jpeg" -> "jpg"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "image/svg+xml" -> "svg"
            "image/avif" -> "avif"
            "audio/mpeg", "audio/mp3" -> "mp3"
            "audio/wav", "audio/x-wav", "audio/wave" -> "wav"
            "audio/ogg", "audio/opus" -> "ogg"
            "audio/mp4", "audio/m4a", "audio/aac" -> "m4a"
            "audio/flac" -> "flac"
            "audio/webm" -> "webm"
            "video/mp4" -> "mp4"
            "video/webm" -> "webm"
            "video/quicktime" -> "mov"
            else -> ref.substringBefore('?').substringAfterLast('.', "bin").take(5)
                .takeIf { it.matches(Regex("[a-z0-9]+")) } ?: "bin"
        }

    private fun fingerprint(document: StageDocument): String {
        // Versi aplikasi ikut di sidik: rilis baru boleh mengubah cara media
        // disiapkan, dan cache lama harus dibangun ulang, bukan dipakai apa adanya.
        val canonical = json.encodeToString(StageDocument.serializer(), document) +
            "|$appVersion|$FORMAT_VERSION|$BUILDER_VERSION"
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun safeId(stageId: String): String =
        stageId.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(80)
            .ifBlank { "kelas" }

    /** Sisakan beberapa kursus terbaru; cache lama boleh diunduh ulang. */
    private fun sweepCache(current: File) {
        val now = System.currentTimeMillis()
        cacheRoot.listFiles().orEmpty()
            .filter { it.isDirectory && !it.name.startsWith(".") && it != current }
            .filter { it.lastModified() in 1L until now - CACHE_MAX_AGE_MS }
            .forEach { it.deleteRecursively() }
        cacheRoot.listFiles().orEmpty()
            .filter { it.isDirectory && it.name.startsWith(".building-") }
            .filter { it.lastModified() in 1L until now - STAGING_MAX_AGE_MS }
            .forEach { it.deleteRecursively() }
        cacheRoot.listFiles().orEmpty()
            .filter { it.isDirectory && !it.name.startsWith(".") && it != current }
            .sortedByDescending { it.lastModified() }
            .drop(maxCachedCourses - 1)
            .forEach { it.deleteRecursively() }
    }

    companion object {
        private const val FORMAT_VERSION = 1
        /** Naikkan bila bentuk cache lokal berubah tanpa perubahan rilis. */
        private const val BUILDER_VERSION = 1
        private const val READY_FILE = ".ready"
        private const val META_FILE = "meta.json"
        private const val PARALLEL_DOWNLOADS = 4
        private const val STAGING_MAX_AGE_MS = 24L * 60 * 60 * 1000
        private const val CACHE_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000
        // Pemutar menanam semua media sebagai base64 di satu dokumen HTML;
        // batas ini menjaga puncak memori tetap di bawah heap WebView ponsel.
        private const val MAX_TOTAL_BYTES = 128L * 1024 * 1024
        private const val CLASSROOM_MEDIA_PREFIX = "/api/classroom-media/"

        private val MEDIA_KEYS = setOf(
            "src", "mediaRef", "poster", "pattern", "audioId", "audioUrl", "audioRef",
        )
        private val ASSET_REF = Regex("^ast_[0-9a-z]{10,64}$")
        private val ASSET_REF_HINT = Regex("ast_[0-9a-z]{10,64}")
        private val CLASSROOM_MEDIA_HINT = Regex("/api/classroom-media/[^\\s\"'<>]+")

        private fun isAssetRef(value: String): Boolean = ASSET_REF.matches(value)

        /** Path statis di origin aplikasi, mis. `/guide-course/img/cover.webp`. */
        private fun isRootRelative(value: String): Boolean =
            value.startsWith("/") && !value.startsWith("//")

        private fun isRemoteUrl(value: String): Boolean =
            value.startsWith("https://") || value.startsWith("http://") ||
                value.startsWith("//")
    }
}
