package ai.kelaska.app.data.offline

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.io.path.createTempDirectory

/** Menguji bahwa HTML yang dibangun identik bentuknya dengan ekspor pemutar web. */
class StandalonePlayerHtmlTest {

    private val assets = StandalonePlayerHtml.PlayerAssets(
        script = "/* player bundle */",
        style = "/* player css */",
        mathFonts = "/* math fonts */",
        chartsScript = "/* charts */",
    )

    private fun writeZip(zip: File, manifest: String, media: Map<String, ByteArray>) {
        ZipOutputStream(FileOutputStream(zip)).use { out ->
            out.putNextEntry(ZipEntry("manifest.json"))
            out.write(manifest.toByteArray(Charsets.UTF_8))
            out.closeEntry()
            for ((path, bytes) in media) {
                out.putNextEntry(ZipEntry(path))
                out.write(bytes)
                out.closeEntry()
            }
        }
    }

    @Test
    fun `builds the same document shape as the web standalone player`() {
        val dir = createTempDirectory("kelaska-player").toFile()
        val zip = File(dir, "course.maic.zip")
        val manifest = """
            {
              "formatVersion": 1,
              "stage": {"name": "Daur Air", "videoManifest": {"v1": {"type": "video"}}},
              "agents": [{"name": "Bu Wati"}],
              "scenes": [
                {
                  "type": "slide", "title": "Slide 1", "order": 2,
                  "content": {"type": "slide", "canvas": {
                    "viewportSize": 1000, "viewportRatio": 0.5625,
                    "elements": [
                      {"id": "text_1", "type": "text", "content": "<script>window.pwned=1</script><p style=\\\"color:red\\\">Halo</p>", "top": 0, "left": 0, "width": 100, "height": 40},
                      {"id": "image_1", "type": "image", "src": "ast_img", "top": 10, "left": 20, "width": 100, "height": 80},
                      {"id": "video_1", "type": "video", "mediaRef": "ast_vid", "src": "ast_vid", "top": 90, "left": 20, "width": 100, "height": 80}
                    ]
                  }},
                  "actions": [
                    {"id": "a1", "type": "spotlight", "elementId": "image_1"},
                    {"id": "a2", "type": "speech", "text": "Halo anak-anak"},
                    {"id": "a3", "type": "discussion", "topic": "Ke mana air pergi?", "agentIndex": 2}
                  ]
                },
                {"type": "quiz", "title": "Kuis", "order": 1,
                 "content": {"type": "quiz", "questions": []}}
              ],
              "mediaIndex": {
                "media/asset-1.webp": {"sourceRef": "ast_img", "mimeType": "image/webp", "size": 4},
                "media/asset-2.mp4": {"sourceRef": "ast_vid", "mimeType": "video/mp4", "size": 4}
              }
            }
        """.trimIndent()
        writeZip(zip, manifest, mapOf("media/asset-1.webp" to byteArrayOf(1, 2, 3, 4), "media/asset-2.mp4" to byteArrayOf(5, 6, 7, 8)))

        val course = OfflinePackageStore(dir).importZip(zip, "contoh.maic.zip")
            .let { OfflinePackageStore(dir).load(it.id)!! }
        val html = StandalonePlayerHtml.build(course, assets)

        assertTrue(html.startsWith("<!doctype html>"))
        assertTrue(html.contains("<div id=\"openmaic-player\"></div>"))
        assertTrue(html.contains("default-src 'none'"))
        assertTrue(html.contains("connect-src 'none'"))
        assertTrue(html.contains("<script type=\"application/json\" id=\"openmaic-classroom\">"))
        assertTrue(html.contains("<script type=\"application/json\" id=\"openmaic-player-config\">"))
        assertTrue(html.contains("/* player bundle */"))
        assertTrue(html.contains("Putar kelas"))

        // Aksi discussion dipangkas menjadi topic saja (seperti prepareStandaloneActions).
        assertTrue(html.contains("Ke mana air pergi?"))
        assertFalse(html.contains("agentIndex"))
        // Rich text disanitasi seperti ekspor web (skrip tidak ikut tertanam).
        assertFalse(html.contains("window.pwned"))
        assertTrue(html.contains("color:red"))

        // Manifest tidak membawa videoManifest/agents/mediaIndex.
        assertFalse(html.contains("\"videoManifest\""))
        assertFalse(html.contains("ast_img"))

        // Media gambar di-inline sebagai data URI, video jadi blok base64.
        assertTrue(html.contains("data:image/webp;base64,"))
        assertTrue(html.contains("<script type=\"application/json\" id=\"openmaic-media\">"))
        assertTrue(html.contains("openmaic-media-1"))
        assertTrue(html.contains("video/mp4"))
        assertTrue(html.contains("\"embedded\":\"openmaic-media-1\""))

        // Scenes diurutkan berdasarkan `order` (kuis order 1 lebih dulu).
        val quizPos = html.indexOf("Kuis")
        val slidePos = html.indexOf("Slide 1")
        assertTrue("kuis harus tampil lebih dulu", quizPos >= 0 && quizPos < slidePos)
    }
}
