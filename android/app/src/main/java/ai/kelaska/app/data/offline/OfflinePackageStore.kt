package ai.kelaska.app.data.offline

import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile

/** Kursus `.maic.zip` yang sudah diekstrak ke penyimpanan aplikasi. */
class OfflineCourse(
    val meta: OfflinePackageMeta,
    val manifest: OfflineManifest,
    val rootDir: File,
) {
    /** Scene terurut; indeksnya dipakai sebagai id stabil di UI. */
    val scenes: List<OfflineScene> = manifest.scenes
        .withIndex()
        .sortedWith(compareBy({ it.value.order }, { it.index }))
        .map { it.value }

    /**
     * Peta referensi → berkas lokal. Kunci peta mencakup path ZIP (dipakai
     * `speech.audioRef`), `sourceRef` (dipakai slide/quiz), dan nama berkas
     * tanpa folder/ekstensi untuk arsip lama yang tidak menulis `sourceRef`.
     */
    private val mediaByRef: Map<String, File> = buildMediaMap()

    fun media(ref: String?): File? {
        if (ref.isNullOrBlank()) return null
        mediaByRef[ref]?.let { return it }
        return resolveArchiveFile(ref)
    }

    /** Klip narasi berurutan untuk satu scene. */
    fun narration(scene: OfflineScene): List<OfflineNarrationClip> =
        scene.actions
            .filter { it.type == "speech" }
            .map { action ->
                val file = action.audioRef?.let(::media) ?: action.audioId?.let(::media)
                OfflineNarrationClip(
                    text = action.text.orEmpty().trim(),
                    audioPath = file?.absolutePath,
                )
            }

    /** Gambar/audio/video slide yang sudah dipetakan ke berkas lokal. */
    fun resolveSlideMedia(ref: String?): String? = media(ref)?.absolutePath

    private fun buildMediaMap(): Map<String, File> {
        val map = LinkedHashMap<String, File>()
        for ((path, entry) in manifest.mediaIndex) {
            if (entry.missing) continue
            val file = resolveArchiveFile(path) ?: continue
            map.putIfAbsent(path, file)
            entry.sourceRef
                ?.takeIf { it.isNotBlank() }
                ?.let { map.putIfAbsent(it, file) }
            map.putIfAbsent(mediaRefFromArchivePath(path, entry.mimeType), file)
        }
        return map
    }

    private fun resolveArchiveFile(path: String): File? {
        val normalized = path.replace('\\', '/')
        if (normalized.startsWith("/")) return null
        val segments = normalized.split('/')
        if (segments.any { it.isEmpty() || it == "." || it == ".." }) return null
        val root = runCatching { rootDir.canonicalFile }.getOrNull() ?: return null
        val candidate = runCatching { File(root, normalized).canonicalFile }.getOrNull() ?: return null
        if (!candidate.path.startsWith(root.path + File.separator)) return null
        return candidate.takeIf { it.isFile }
    }
}

/**
 * Penyimpanan paket offline: satu direktori per paket di bawah `filesDir`.
 * Tidak menyentuh Android API supaya ekstraksi & validasi bisa diuji di JVM.
 */
class OfflinePackageStore(private val root: File) {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
        coerceInputValues = true
    }

    /** Semua paket terpasang, terbaru lebih dulu. */
    fun list(): List<OfflinePackageMeta> {
        sweepStaleStaging()
        return root.listFiles()
            .orEmpty()
            .asSequence()
            .filter { it.isDirectory && !it.name.startsWith(".") }
            .mapNotNull { readMeta(it) }
            .sortedByDescending { it.importedAt }
            .toList()
    }

    fun load(id: String): OfflineCourse? {
        val dir = packageDir(id) ?: return null
        val meta = readMeta(dir) ?: return null
        val manifestFile = File(dir, "manifest.json")
        if (!manifestFile.isFile) return null
        val manifest = runCatching {
            json.decodeFromString(OfflineManifest.serializer(), manifestFile.readText())
        }.getOrNull() ?: return null
        return OfflineCourse(meta, manifest, dir)
    }

    fun delete(id: String): Boolean {
        val dir = packageDir(id) ?: return false
        return dir.deleteRecursively()
    }

    fun totalBytes(): Long =
        list().sumOf { meta ->
            packageDir(meta.id)?.walkTopDown()?.filter { it.isFile }?.sumOf { it.length() } ?: 0L
        }

    /**
     * Ekstrak satu berkas ZIP ke penyimpanan. Direktori staging baru
     * dipublikasikan (di-rename) setelah manifest valid dan semua byte media
     * selesai ditulis, jadi impor yang gagal tidak meninggalkan kursus setengah.
     */
    fun importZip(
        zipFile: File,
        sourceName: String? = null,
        onProgress: (Float) -> Unit = {},
    ): OfflinePackageMeta {
        root.mkdirs()
        val id = UUID.randomUUID().toString()
        val staging = File(root, ".import-$id")
        if (staging.exists()) staging.deleteRecursively()
        if (!staging.mkdirs()) {
            throw OfflineImportException("Tidak bisa menyiapkan penyimpanan untuk impor.")
        }

        try {
            val extracted = extract(zipFile, staging, onProgress)
            val meta = OfflinePackageMeta(
                id = id,
                displayName = extracted.manifest.stage.name.trim().ifBlank {
                    sourceName?.substringBeforeLast('.')?.trim().orEmpty().ifBlank { "Kursus offline" }
                },
                importedAt = System.currentTimeMillis(),
                sizeBytes = extracted.sizeBytes,
                sourceName = sourceName,
                formatVersion = extracted.manifest.formatVersion,
                sceneCount = extracted.manifest.scenes.size,
            )
            File(staging, META_FILE).writeText(json.encodeToString(OfflinePackageMeta.serializer(), meta))
            val finalDir = File(root, id)
            if (!staging.renameTo(finalDir)) {
                throw OfflineImportException("Tidak bisa menyimpan kursus offline.")
            }
            onProgress(1f)
            return meta
        } catch (error: OfflineImportException) {
            staging.deleteRecursively()
            throw error
        } catch (error: Exception) {
            staging.deleteRecursively()
            throw OfflineImportException(
                "Impor gagal: ${error.message?.take(200) ?: "berkas tidak dapat dibaca"}",
            )
        }
    }

    private data class Extracted(val manifest: OfflineManifest, val sizeBytes: Long)

    private fun extract(zipFile: File, target: File, onProgress: (Float) -> Unit): Extracted {
        ZipFile(zipFile).use { zip ->
            val manifestEntry = zip.getEntry(MANIFEST_FILE)
                ?: throw OfflineImportException(
                    "File bukan paket .maic.zip yang valid: manifest.json tidak ditemukan.",
                )
            val manifest = readManifest(zip, manifestEntry)
            validate(manifest)

            val candidates = ArrayList<ZipEntry>()
            var entryCount = 0
            var declaredBytes = 0L
            val entries = zip.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                if (entry.isDirectory) continue
                entryCount += 1
                if (entryCount > MAX_ENTRIES) {
                    throw OfflineImportException("Arsip berisi terlalu banyak berkas.")
                }
                val name = entry.name
                // Setiap nama divalidasi, termasuk yang nanti dilewati: arsip yang
                // membawa `../evil.bin` harus ditolak, bukan diabaikan diam-diam.
                if (safeChild(target, name) == null) {
                    throw OfflineImportException("Arsip berisi path yang tidak aman: $name")
                }
                if (name == MANIFEST_FILE) {
                    candidates += entry
                    continue
                }
                if (!name.startsWith("audio/") && !name.startsWith("media/")) continue
                candidates += entry
                if (entry.size > 0) declaredBytes += entry.size
            }

            val expectedBytes = declaredBytes.coerceAtLeast(1L)
            var writtenBytes = 0L
            for (entry in candidates) {
                val destination = safeChild(target, entry.name)
                    ?: throw OfflineImportException("Arsip berisi path yang tidak aman: ${entry.name}")
                destination.parentFile?.mkdirs()
                zip.getInputStream(entry).use { input ->
                    FileOutputStream(destination).use { output ->
                        val buffer = ByteArray(COPY_BUFFER_BYTES)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            writtenBytes += read
                            if (writtenBytes > MAX_TOTAL_BYTES) {
                                throw OfflineImportException(
                                    "Paket terlalu besar (lebih dari ${MAX_TOTAL_BYTES / (1024 * 1024)} MB).",
                                )
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }
                onProgress((writtenBytes.toFloat() / expectedBytes).coerceIn(0f, 1f))
            }
            return Extracted(manifest, writtenBytes)
        }
    }

    private fun readManifest(zip: ZipFile, entry: ZipEntry): OfflineManifest {
        if (entry.size > MAX_MANIFEST_BYTES) {
            throw OfflineImportException("manifest.json terlalu besar untuk dibaca.")
        }
        val text = zip.getInputStream(entry).bufferedReader(Charsets.UTF_8).use { reader ->
            val builder = StringBuilder()
            val buffer = CharArray(8 * 1024)
            var total = 0
            while (true) {
                val read = reader.read(buffer)
                if (read < 0) break
                total += read
                if (total > MAX_MANIFEST_BYTES) {
                    throw OfflineImportException("manifest.json terlalu besar untuk dibaca.")
                }
                builder.append(buffer, 0, read)
            }
            builder.toString()
        }
        return try {
            json.decodeFromString(OfflineManifest.serializer(), text)
        } catch (error: Exception) {
            throw OfflineImportException(
                "manifest.json tidak valid: ${error.message?.take(160) ?: "format tidak dikenal"}",
            )
        }
    }

    private fun validate(manifest: OfflineManifest) {
        if (manifest.formatVersion !in 1..2) {
            throw OfflineImportException(
                "Versi format kursus (${manifest.formatVersion}) belum didukung aplikasi ini.",
            )
        }
        val unsupported = manifest.requiredCapabilities.filterNot { it in SUPPORTED_OFFLINE_CAPABILITIES }
        if (unsupported.isNotEmpty()) {
            throw OfflineImportException(
                "Kursus membutuhkan fitur yang belum didukung pemutar offline: ${unsupported.joinToString()}.",
            )
        }
        if (manifest.stage.name.isBlank()) {
            throw OfflineImportException("Kursus tidak memiliki nama.")
        }
        if (manifest.scenes.isEmpty()) {
            throw OfflineImportException("Kursus tidak memiliki materi untuk diputar.")
        }
    }

    private fun readMeta(dir: File): OfflinePackageMeta? {
        val file = File(dir, META_FILE)
        if (!file.isFile) return null
        return runCatching {
            json.decodeFromString(OfflinePackageMeta.serializer(), file.readText())
        }.getOrNull()
    }

    private fun packageDir(id: String): File? {
        if (id.isBlank() || id.contains('/') || id.contains('\\') || id.contains("..")) return null
        val rootDir = runCatching { root.canonicalFile }.getOrNull() ?: return null
        val candidate = runCatching { File(rootDir, id).canonicalFile }.getOrNull() ?: return null
        if (candidate.parentFile?.path != rootDir.path) return null
        return candidate.takeIf { it.isDirectory }
    }

    /** Path anak yang aman: tidak absolut, tanpa segmen `..`, tetap di dalam target. */
    private fun safeChild(target: File, name: String): File? {
        val clean = name.replace('\\', '/')
        if (clean.startsWith("/") || clean.contains('\u0000')) return null
        val segments = clean.split('/')
        if (segments.any { it.isEmpty() || it == "." || it == ".." }) return null
        val targetRoot = runCatching { target.canonicalFile }.getOrNull() ?: return null
        val candidate = runCatching { File(targetRoot, clean).canonicalFile }.getOrNull() ?: return null
        if (!candidate.path.startsWith(targetRoot.path + File.separator)) return null
        return candidate
    }

    /** Impor yang terhenti (aplikasi dimatikan) tidak boleh menumpuk selamanya. */
    private fun sweepStaleStaging() {
        val cutoff = System.currentTimeMillis() - STAGING_MAX_AGE_MS
        root.listFiles()
            .orEmpty()
            .filter { it.isDirectory && it.name.startsWith(".import-") }
            .filter { it.lastModified() in 1L until cutoff }
            .forEach { it.deleteRecursively() }
    }

    private companion object {
        const val MANIFEST_FILE = "manifest.json"
        const val META_FILE = "meta.json"
        const val MAX_ENTRIES = 10_000
        const val MAX_MANIFEST_BYTES = 64 * 1024 * 1024
        const val MAX_TOTAL_BYTES = 2L * 1024 * 1024 * 1024
        const val COPY_BUFFER_BYTES = 64 * 1024
        const val STAGING_MAX_AGE_MS = 24L * 60 * 60 * 1000
    }
}

/**
 * Cermin `mediaRefFromZipPath` milik web: arsip lama tidak menulis
 * `mediaIndex[path].sourceRef`, jadi referensi slide jatuh ke nama berkas.
 */
internal fun mediaRefFromArchivePath(zipPath: String, mimeType: String?): String {
    val relative = if (zipPath.startsWith("media/")) zipPath.drop("media/".length) else zipPath
    val suffix = mimeType
        ?.substringAfter('/', "")
        ?.takeIf { it.isNotBlank() }
        ?.let { ".$it" }
    if (suffix != null && relative.endsWith(suffix)) {
        return relative.dropLast(suffix.length)
    }
    val slash = relative.lastIndexOf('/')
    val dot = relative.lastIndexOf('.')
    return if (dot > slash) relative.substring(0, dot) else relative
}
