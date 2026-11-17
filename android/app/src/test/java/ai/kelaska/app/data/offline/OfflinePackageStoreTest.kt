package ai.kelaska.app.data.offline

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class OfflinePackageStoreTest {

    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private val tolerantJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

    private fun zip(entries: Map<String, ByteArray>): File {
        val file = temporaryFolder.newFile("course-${System.nanoTime()}.maic.zip")
        ZipOutputStream(file.outputStream()).use { output ->
            for ((name, bytes) in entries) {
                output.putNextEntry(ZipEntry(name))
                output.write(bytes)
                output.closeEntry()
            }
        }
        return file
    }

    private fun manifestJson(
        formatVersion: Int = 1,
        capabilities: String = "[]",
        sceneType: String = "slide",
    ): String =
        """
        {
          "formatVersion": $formatVersion,
          "requiredCapabilities": $capabilities,
          "exportedAt": "2026-11-15T00:00:00.000Z",
          "appVersion": "1.5.0",
          "stage": {
            "name": "Fotosintesis",
            "description": "Kursus contoh",
            "createdAt": 1700000000000,
            "updatedAt": 1700000000000
          },
          "agents": [{"name": "Bu Rina", "role": "teacher"}],
          "scenes": [
            {
              "type": "quiz",
              "title": "Kuis Akhir",
              "order": 0,
              "content": {"type": "quiz", "questions": []}
            },
            {
              "type": "$sceneType",
              "title": "Pengantar",
              "order": 1,
              "content": {
                "type": "slide",
                "canvas": {
                  "background": {"type": "image", "image": {"src": "ast_bg"}},
                  "elements": [
                    {"type": "text", "top": 10, "left": 10, "content": "<p>Halo murid</p>"},
                    {"type": "image", "top": 20, "left": 10, "src": "ast_img"},
                    {"type": "audio", "top": 30, "left": 10, "src": "ast_slide_audio"}
                  ]
                }
              },
              "actions": [
                {"type": "speech", "text": "Selamat pagi", "audioRef": "audio/audio-1.mp3"}
              ]
            }
          ],
          "mediaIndex": {
            "audio/audio-1.mp3": {"type": "audio", "format": "mp3", "sourceRef": "ast_audio"},
            "media/asset-1.png": {"type": "generated", "mimeType": "image/png", "sourceRef": "ast_img"},
            "media/asset-2.jpg": {"type": "generated", "mimeType": "image/jpeg", "sourceRef": "ast_bg"},
            "media/asset-3.mp3": {"type": "generated", "mimeType": "audio/mpeg", "sourceRef": "ast_slide_audio"}
          }
        }
        """.trimIndent()

    private fun fullZip(formatVersion: Int = 1, capabilities: String = "[]"): File =
        zip(
            mapOf(
                "manifest.json" to manifestJson(formatVersion, capabilities).toByteArray(),
                "audio/audio-1.mp3" to "audio-bytes".toByteArray(),
                "media/asset-1.png" to "png-bytes".toByteArray(),
                "media/asset-2.jpg" to "jpg-bytes".toByteArray(),
                "media/asset-3.mp3" to "audio-slide".toByteArray(),
                "pbl/abc/project.json" to "{}".toByteArray(),
            ),
        )

    @Test
    fun `imports a course and resolves manifest media by path and source ref`() {
        val root = temporaryFolder.newFolder("offline")
        val store = OfflinePackageStore(root)

        val meta = store.importZip(fullZip(), "fotosintesis.maic.zip")

        assertEquals("Fotosintesis", meta.displayName)
        assertEquals(2, meta.sceneCount)
        assertEquals(1, store.list().size)

        val course = store.load(meta.id)
        assertNotNull(course)
        val loaded = course!!
        assertEquals("Kuis Akhir", loaded.scenes.first().title)

        val image = loaded.media("ast_img")
        assertNotNull(image)
        assertEquals("png-bytes", image!!.readText())

        val audio = loaded.media("audio/audio-1.mp3")
        assertNotNull(audio)
        assertEquals("audio-bytes", audio!!.readText())

        // Arsip lama bisa tidak menulis sourceRef: nama berkas tanpa folder/ext
        // tetap harus menemukan media yang sama.
        assertEquals(image, loaded.media("asset-1"))
        assertNotNull(loaded.media("ast_bg"))
        assertNotNull(loaded.media("ast_slide_audio"))

        // Direktori di luar audio/media (mis. pbl) tidak ikut diekstrak.
        assertFalse(File(loaded.rootDir, "pbl/abc/project.json").exists())

        val slide = loaded.scenes.last()
        val clips = loaded.narration(slide)
        assertEquals(1, clips.size)
        assertEquals("Selamat pagi", clips[0].text)
        assertNotNull(clips[0].audioPath)
        assertTrue(File(clips[0].audioPath!!).isFile)
    }

    @Test
    fun `accepts format version 2 with pbl capability`() {
        val store = OfflinePackageStore(temporaryFolder.newFolder("offline-v2"))
        val meta = store.importZip(
            fullZip(formatVersion = 2, capabilities = "[\"pbl-v3-projects@1\"]"),
        )
        assertEquals(2, meta.formatVersion)
        assertEquals(1, store.list().size)
    }

    @Test
    fun `rejects unsupported format version and leaves no package`() {
        val root = temporaryFolder.newFolder("offline-bad-version")
        val store = OfflinePackageStore(root)

        val error = runCatching { store.importZip(fullZip(formatVersion = 3)) }.exceptionOrNull()

        assertTrue(error is OfflineImportException)
        assertTrue(error!!.message.orEmpty().contains("Versi format"))
        assertTrue(store.list().isEmpty())
        assertTrue(root.listFiles().orEmpty().none { it.isDirectory })
    }

    @Test
    fun `rejects unknown capabilities`() {
        val store = OfflinePackageStore(temporaryFolder.newFolder("offline-bad-capability"))
        val error = runCatching {
            store.importZip(fullZip(capabilities = "[\"quantum-runtime@9\"]"))
        }.exceptionOrNull()

        assertTrue(error is OfflineImportException)
        assertTrue(error!!.message.orEmpty().contains("quantum-runtime@9"))
    }

    @Test
    fun `rejects a zip without manifest`() {
        val store = OfflinePackageStore(temporaryFolder.newFolder("offline-no-manifest"))
        val file = zip(mapOf("audio/a.mp3" to "x".toByteArray()))

        val error = runCatching { store.importZip(file) }.exceptionOrNull()

        assertTrue(error is OfflineImportException)
        assertTrue(error!!.message.orEmpty().contains("manifest.json"))
    }

    @Test
    fun `rejects zip slip entries before writing anything`() {
        val store = OfflinePackageStore(temporaryFolder.newFolder("offline-zip-slip"))
        val outside = File(temporaryFolder.root, "evil.bin")
        val file = zip(
            mapOf(
                "manifest.json" to manifestJson().toByteArray(),
                "../evil.bin" to "owned".toByteArray(),
            ),
        )

        val error = runCatching { store.importZip(file) }.exceptionOrNull()

        assertTrue(error is OfflineImportException)
        assertFalse(outside.exists())
        assertTrue(store.list().isEmpty())
    }

    @Test
    fun `rejects a course without scenes`() {
        val store = OfflinePackageStore(temporaryFolder.newFolder("offline-empty"))
        val file = zip(
            mapOf(
                "manifest.json" to """
                    {"formatVersion":1,"stage":{"name":"Kosong"},"scenes":[],"mediaIndex":{}}
                """.trimIndent().toByteArray(),
            ),
        )

        val error = runCatching { store.importZip(file) }.exceptionOrNull()

        assertTrue(error is OfflineImportException)
        assertTrue(error!!.message.orEmpty().contains("materi"))
    }

    @Test
    fun `delete removes the package from disk`() {
        val root = temporaryFolder.newFolder("offline-delete")
        val store = OfflinePackageStore(root)
        val meta = store.importZip(fullZip())

        assertTrue(store.delete(meta.id))
        assertTrue(store.list().isEmpty())
        assertFalse(File(root, meta.id).exists())
    }

    @Test
    fun `media ref fallback mirrors the web importer`() {
        assertEquals("asset-1", mediaRefFromArchivePath("media/asset-1.jpg", "image/jpeg"))
        assertEquals("asset-1", mediaRefFromArchivePath("media/asset-1", "image/png"))
        assertEquals("nested/name", mediaRefFromArchivePath("media/nested/name.webp", null))
        assertEquals("audio/audio-1", mediaRefFromArchivePath("audio/audio-1.mp3", null))
    }

    @Test
    fun `manifest tolerant of unknown fields and null description`() {
        val parsed = tolerantJson.decodeFromString(
            OfflineManifest.serializer(),
            """
                {
                  "formatVersion": 1,
                  "futureField": {"x": 1},
                  "stage": {"name": "Baru", "description": null, "unknown": true},
                  "scenes": [{"type":"slide","title":"Satu","order":0,"content":{"type":"slide","canvas":{"elements":[]}},"future":1}],
                  "mediaIndex": {}
                }
            """.trimIndent(),
        )
        assertEquals("Baru", parsed.stage.name)
        assertEquals(null, parsed.stage.description)
        assertEquals(1, parsed.scenes.size)
        assertEquals(0, parsed.scenes[0].content.jsonObject["canvas"]!!.jsonObject["elements"]!!.jsonArray.size)
    }
}
