package ai.kelaska.app.data.online

import ai.kelaska.app.data.SceneDto
import ai.kelaska.app.data.StageDocument
import ai.kelaska.app.data.StageMeta
import ai.kelaska.app.data.offline.StandalonePlayerHtml
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

class OnlineCourseBuilderTest {

    @get:Rule
    val temporary = TemporaryFolder()

    private val stageId = "stage-abc"
    private val imageRef = "ast_0123456789abcdefghjkmnpq"
    private val backgroundRef = "ast_1123456789abcdefghjkmnpq"
    private val videoRef = "ast_2123456789abcdefghjkmnpq"
    private val audioElementRef = "ast_3123456789abcdefghjkmnpq"
    private val narrationRef = "ast_4123456789abcdefghjkmnpq"
    private val pointImageRef = "ast_5123456789abcdefghjkmnpq"
    private val legacyAudio = "/api/classroom-media/stage-abc/audio/legacy.mp3"
    private val rootRelativeImage = "/guide-course/img/cover.webp"
    private val rootRelativeAudio = "/guide-course/en/audio/s1_1.mp3"

    private val pngBytes = byteArrayOf(
        0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02,
    )
    private val mp3Bytes = "ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000".toByteArray()
    private val mp4Bytes = byteArrayOf(
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
        0x6D, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
    )

    @Test
    fun `builds a playable package from an online document`() = runTest {
        val document = sampleDocument()
        val calls = AtomicInteger(0)
        val builder = OnlineCourseBuilder(temporary.newFolder("cache"), "1.5.0")

        val course = builder.build(stageId, document, fetch = { ref ->
            calls.incrementAndGet()
            when (ref) {
                imageRef, backgroundRef, pointImageRef, rootRelativeImage ->
                    OnlineCourseBuilder.DownloadedMedia(pngBytes, "image/png")

                videoRef -> OnlineCourseBuilder.DownloadedMedia(mp4Bytes, "video/mp4")
                audioElementRef, narrationRef, legacyAudio, rootRelativeAudio ->
                    OnlineCourseBuilder.DownloadedMedia(mp3Bytes, "audio/mpeg")

                else -> null
            }
        })

        assertEquals("online-$stageId", course.meta.id)
        assertEquals("Kursus Contoh", course.meta.displayName)
        assertEquals(2, course.scenes.size)
        assertEquals(9, course.manifest.mediaIndex.size)
        assertEquals(9, course.manifest.mediaIndex.values.count { !it.missing })
        assertNotNull(course.media(imageRef))
        assertNotNull(course.media(backgroundRef))
        assertNotNull(course.media(videoRef))
        assertNotNull(course.media(audioElementRef))
        assertNotNull(course.media(narrationRef))
        assertNotNull(course.media(legacyAudio))
        assertNotNull(course.media(pointImageRef))
        assertNotNull(course.media(rootRelativeImage))
        assertNotNull(course.media(rootRelativeAudio))
        assertTrue(course.media(imageRef)!!.readBytes().contentEquals(pngBytes))
        assertTrue(course.media(narrationRef)!!.readBytes().contentEquals(mp3Bytes))

        val manifest = File(course.rootDir, "manifest.json").readText()
        assertTrue(manifest.contains("\"actions\""))
        assertTrue(manifest.contains(narrationRef))
        assertTrue(manifest.contains(imageRef))
        assertTrue(manifest.contains(legacyAudio))
        assertTrue(manifest.contains(rootRelativeAudio))
        assertTrue(manifest.contains(pointImageRef))

        // Pemutar menerima media sebagai data: URI/base64, bukan referensi
        // jaringan — WebView memblokir seluruh muatan jaringan.
        val html = StandalonePlayerHtml.build(
            course,
            testPlayerAssets(),
        )
        assertTrue(html.contains("data:image/png;base64,"))
        assertTrue(html.contains("data:audio/mpeg;base64,"))
        assertTrue(html.contains("openmaic-media"))

        // Untuk pemeriksaan manual/peramban: tulis dokumen jadi bila diminta.
        System.getenv("KELASKA_PLAYER_OUT")?.takeIf { it.isNotBlank() }?.let { path ->
            File(path).apply { parentFile?.mkdirs() }.writeText(html)
        }
    }

    @Test
    fun `reuses cache until the document changes`() = runTest {
        val root = temporary.newFolder("cache")
        val firstCalls = AtomicInteger(0)
        val first = OnlineCourseBuilder(root, "1.5.0").build(
            stageId,
            sampleDocument(),
            fetch = { ref ->
                firstCalls.incrementAndGet()
                when (ref) {
                    narrationRef -> OnlineCourseBuilder.DownloadedMedia(mp3Bytes, "audio/mpeg")
                    else -> null
                }
            },
        )

        val secondCalls = AtomicInteger(0)
        val second = OnlineCourseBuilder(root, "1.5.0").build(
            stageId,
            sampleDocument(),
            fetch = { ref ->
                secondCalls.incrementAndGet()
                when (ref) {
                    narrationRef -> OnlineCourseBuilder.DownloadedMedia(mp3Bytes, "audio/mpeg")
                    else -> null
                }
            },
        )

        assertEquals(9, firstCalls.get())
        assertEquals(0, secondCalls.get())
        assertEquals(first.meta.id, second.meta.id)
        assertEquals(first.rootDir.absolutePath, second.rootDir.absolutePath)

        // Dokumen berubah → sidik berbeda → paket dibangun ulang.
        val changedCalls = AtomicInteger(0)
        OnlineCourseBuilder(root, "1.5.0").build(
            stageId,
            sampleDocument().copy(stage = sampleDocument().stage.copy(updatedAt = 2_000)),
            fetch = { ref ->
                changedCalls.incrementAndGet()
                when (ref) {
                    narrationRef -> OnlineCourseBuilder.DownloadedMedia(mp3Bytes, "audio/mpeg")
                    else -> null
                }
            },
        )
        assertEquals(9, changedCalls.get())
    }

    @Test
    fun `skips unreachable media instead of failing the course`() = runTest {
        val course = OnlineCourseBuilder(temporary.newFolder("cache"), "1.5.0").build(
            stageId,
            sampleDocument(),
            fetch = { null },
        )

        assertEquals(0, course.manifest.mediaIndex.size)
        assertEquals(2, course.scenes.size)
    }

    /**
     * Aset pemutar untuk pengujian. Dengan `KELASKA_PLAYER_ASSETS` diarahkan ke
     * `android/app/src/main/assets/player`, dokumen yang dihasilkan memakai
     * bundle asli sehingga bisa dibuka di peramban untuk pemeriksaan visual.
     */
    private fun testPlayerAssets(): StandalonePlayerHtml.PlayerAssets {
        val dir = System.getenv("KELASKA_PLAYER_ASSETS")?.takeIf { it.isNotBlank() }?.let(::File)
        fun read(name: String, fallback: String): String {
            val file = dir?.let { File(it, name) } ?: return fallback
            return if (file.isFile) file.readText() else fallback
        }
        return StandalonePlayerHtml.PlayerAssets(
            script = read("player.min.js", "/*player*/"),
            style = read("player.min.css", "/*style*/"),
            mathFonts = read("katex-fonts.min.css", ""),
            chartsScript = read("player-charts.min.js", ""),
        )
    }

    private fun sampleDocument(): StageDocument {
        val slide = SceneDto(
            id = "scene-1",
            stageId = stageId,
            title = "Pembuka",
            order = 0,
            type = "slide",
            content = buildJsonObject {
                put("type", JsonPrimitive("slide"))
                put("canvas", buildJsonObject {
                    put("background", buildJsonObject {
                        put("type", JsonPrimitive("image"))
                        put("image", buildJsonObject { put("src", JsonPrimitive(backgroundRef)) })
                    })
                    put("elements", buildJsonArray {
                        add(buildJsonObject {
                            put("id", JsonPrimitive("img-1"))
                            put("type", JsonPrimitive("image"))
                            put("src", JsonPrimitive(imageRef))
                        })
                        add(buildJsonObject {
                            put("id", JsonPrimitive("audio-1"))
                            put("type", JsonPrimitive("audio"))
                            put("src", JsonPrimitive(audioElementRef))
                        })
                        add(buildJsonObject {
                            put("id", JsonPrimitive("video-1"))
                            put("type", JsonPrimitive("video"))
                            put("src", JsonPrimitive(videoRef))
                        })
                        // Path statis di origin aplikasi, mis. kursus panduan.
                        add(buildJsonObject {
                            put("id", JsonPrimitive("img-2"))
                            put("type", JsonPrimitive("image"))
                            put("src", JsonPrimitive(rootRelativeImage))
                        })
                        // Gambar titik chart memakai nama titik sebagai kunci.
                        add(buildJsonObject {
                            put("id", JsonPrimitive("chart-1"))
                            put("type", JsonPrimitive("chart"))
                            put("importedStyle", buildJsonObject {
                                put("series", buildJsonArray {
                                    add(buildJsonObject {
                                        put("pointImages", buildJsonObject {
                                            put("1", JsonPrimitive(pointImageRef))
                                        })
                                    })
                                })
                            })
                        })
                    })
                })
            },
            actions = buildJsonArray {
                add(buildJsonObject {
                    put("id", JsonPrimitive("speech-1"))
                    put("type", JsonPrimitive("speech"))
                    put("text", JsonPrimitive("Selamat datang"))
                    put("audioId", JsonPrimitive(narrationRef))
                })
                add(buildJsonObject {
                    put("id", JsonPrimitive("speech-2"))
                    put("type", JsonPrimitive("speech"))
                    put("text", JsonPrimitive("Narasi lama"))
                    put("audioUrl", JsonPrimitive(legacyAudio))
                })
                add(buildJsonObject {
                    put("id", JsonPrimitive("speech-3"))
                    put("type", JsonPrimitive("speech"))
                    put("text", JsonPrimitive("Narasi kursus panduan"))
                    put("audioUrl", JsonPrimitive(rootRelativeAudio))
                })
            },
        )
        val quiz = SceneDto(
            id = "scene-2",
            stageId = stageId,
            title = "Kuis",
            order = 1,
            type = "quiz",
            content = JsonObject(
                mapOf(
                    "type" to JsonPrimitive("quiz"),
                    "questions" to JsonArray(emptyList()),
                ),
            ),
        )
        return StageDocument(
            stage = StageMeta(
                id = stageId,
                name = "Kursus Contoh",
                description = "Deskripsi",
                languageDirective = "id",
                style = "warm",
                createdAt = 1_000,
                updatedAt = 1_100,
            ),
            scenes = listOf(slide, quiz),
        )
    }
}
