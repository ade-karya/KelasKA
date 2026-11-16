package ai.kelaska.app.data.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GithubReleaseParserTest {

    private val latestReleaseJson = """
        {
          "url": "https://api.github.com/repos/ade-karya/KelasKA/releases/12345",
          "html_url": "https://github.com/ade-karya/KelasKA/releases/tag/v1.3.0",
          "id": 12345,
          "author": { "login": "ade-karya", "id": 1 },
          "tag_name": "v1.3.0",
          "name": "Kelas KA 1.3.0",
          "body": "## Perubahan\n- Pemutar kursus .maic.zip offline\n- Pembaruan aplikasi dari GitHub",
          "draft": false,
          "prerelease": false,
          "target_commitish": "main",
          "assets": [
            {
              "name": "KelasKA-v1.3.0.apk",
              "browser_download_url": "https://github.com/ade-karya/KelasKA/releases/download/v1.3.0/KelasKA-v1.3.0.apk",
              "content_type": "application/vnd.android.package-archive",
              "size": 12345678,
              "uploader": { "login": "github-actions[bot]" }
            },
            {
              "name": "KelasKA-v1.3.0.apk.sha256",
              "browser_download_url": "https://github.com/ade-karya/KelasKA/releases/download/v1.3.0/KelasKA-v1.3.0.apk.sha256",
              "content_type": "text/plain",
              "size": 64
            }
          ]
        }
    """.trimIndent()

    @Test
    fun parsesLatestReleasePayload() {
        val release = GithubReleaseParser.parseLatestRelease(latestReleaseJson)

        assertEquals("v1.3.0", release.tag)
        assertEquals(SemanticVersion(1, 3, 0), release.version)
        assertEquals("Kelas KA 1.3.0", release.title)
        assertTrue(release.notes.contains("offline"))
        assertEquals("https://github.com/ade-karya/KelasKA/releases/tag/v1.3.0", release.htmlUrl)
        assertEquals("KelasKA-v1.3.0.apk", release.apk.name)
        assertEquals("KelasKA-v1.3.0.apk.sha256", release.checksum?.name)
        assertTrue(release.apk.downloadUrl.endsWith("KelasKA-v1.3.0.apk"))
    }

    @Test
    fun fallsBackToTagWhenReleaseNameIsBlank() {
        val json = latestReleaseJson.replace("\"name\": \"Kelas KA 1.3.0\",", "\"name\": \"\",")
        assertEquals("v1.3.0", GithubReleaseParser.parseLatestRelease(json).title)
    }

    @Test
    fun prefersReleaseApkOverDebugArtifact() {
        val assets = listOf(
            asset("app-debug.apk"),
            asset("app-release-unsigned.apk"),
            asset("notes.txt"),
        )
        assertEquals("app-release-unsigned.apk", GithubReleaseParser.selectApkAsset(assets)?.name)
    }

    @Test
    fun skipsApkWithBlankDownloadUrl() {
        val assets = listOf(
            GithubAsset(name = "KelasKA.apk", downloadUrl = ""),
            GithubAsset(name = "KelasKA-lain.apk", downloadUrl = "https://example.test/lain.apk"),
        )
        assertEquals("KelasKA-lain.apk", GithubReleaseParser.selectApkAsset(assets)?.name)
    }

    @Test
    fun checksumAssetMustMatchApkName() {
        val assets = listOf(
            asset("KelasKA-v1.3.0.apk"),
            asset("KelasKA-v1.2.0.apk.sha256"),
            asset("KelasKA-v1.3.0.APK.SHA256"),
        )
        assertEquals(
            "KelasKA-v1.3.0.APK.SHA256",
            GithubReleaseParser.findChecksumAsset(assets, "KelasKA-v1.3.0.apk")?.name,
        )
    }

    @Test
    fun rejectsReleaseWithoutApk() {
        val release = GithubRelease(
            tagName = "v1.3.0",
            assets = listOf(asset("KelasKA-v1.3.0.apk.sha256")),
        )
        val error = failure { GithubReleaseParser.toAppRelease(release) }
        assertTrue(error is UpdateException)
        assertTrue(error.message.orEmpty().contains("APK"))
    }

    @Test
    fun missingChecksumIsAllowedAtParseTimeButBlocksDownloadLater() {
        // Rilis lama (mis. android-v1.0.0) tidak punya .sha256. Pemeriksaan
        // tetap harus bisa menyimpulkan "sudah terbaru"; unduhan ditolak di
        // UpdateViewModel karena tidak ada hash untuk diverifikasi.
        val release = GithubReleaseParser.parseLatestRelease(
            latestReleaseJson.replace("KelasKA-v1.3.0.apk.sha256", "lain.txt"),
        )
        assertTrue(release.checksum == null)
    }

    @Test
    fun rejectsDraftPrereleaseAndInvalidTag() {
        assertTrue(
            failure {
                GithubReleaseParser.toAppRelease(
                    GithubRelease(tagName = "v1.3.0", prerelease = true, assets = validAssets()),
                )
            } is UpdateException,
        )
        assertTrue(
            failure {
                GithubReleaseParser.toAppRelease(
                    GithubRelease(tagName = "v1.3.0", draft = true, assets = validAssets()),
                )
            } is UpdateException,
        )
        assertTrue(
            failure {
                GithubReleaseParser.toAppRelease(
                    GithubRelease(tagName = "rilis-terbaru", assets = validAssets()),
                )
            } is UpdateException,
        )
        assertTrue(
            failure {
                GithubReleaseParser.toAppRelease(GithubRelease(tagName = "", assets = validAssets()))
            } is UpdateException,
        )
    }

    @Test
    fun parsesRealWorldLegacyReleaseWithoutChecksum() {
        // Bentuk rilis pertama repo ini: tag berprefiks dan tanpa .sha256.
        val payload = """
            {
              "tag_name": "android-v1.0.0",
              "name": "Kelas KA Android v1.0.0",
              "body": "APK pertama",
              "draft": false,
              "prerelease": false,
              "assets": [
                {
                  "name": "KelasKA-v1.0.0-release.apk",
                  "browser_download_url": "https://github.com/ade-karya/KelasKA/releases/download/android-v1.0.0/KelasKA-v1.0.0-release.apk"
                }
              ]
            }
        """.trimIndent()
        val release = GithubReleaseParser.parseLatestRelease(payload)
        assertEquals(SemanticVersion(1, 0, 0), release.version)
        assertEquals("KelasKA-v1.0.0-release.apk", release.apk.name)
        assertTrue(release.checksum == null)
    }

    @Test
    fun rejectsMalformedJson() {
        assertTrue(failure { GithubReleaseParser.parseLatestRelease("bukan json") } is UpdateException)
        assertTrue(failure { GithubReleaseParser.parseLatestRelease("{}") } is UpdateException)
    }

    @Test
    fun parsesSha256FromHashOnlyAndSha256sumFormats() {
        val hash = "a".repeat(64)
        val upper = "ABCDEF0123456789".repeat(4)

        assertEquals(hash, GithubReleaseParser.parseSha256(hash))
        assertEquals(hash, GithubReleaseParser.parseSha256("$hash  KelasKA-v1.3.0.apk"))
        assertEquals(upper.lowercase(), GithubReleaseParser.parseSha256("$upper\n"))
        assertEquals(hash, GithubReleaseParser.parseSha256("SHA256(KelasKA.apk)= $hash"))
    }

    @Test
    fun rejectsInvalidChecksumPayload() {
        assertTrue(failure { GithubReleaseParser.parseSha256("") } is UpdateException)
        assertTrue(failure { GithubReleaseParser.parseSha256("bukan-hash") } is UpdateException)
        assertTrue(failure { GithubReleaseParser.parseSha256("a".repeat(63)) } is UpdateException)
    }

    @Test
    fun checksumPayloadThatIsTooShortIsNotSilentlyTruncated() {
        val short = "0123456789abcdef"
        val error = failure { GithubReleaseParser.parseSha256(short) }
        assertTrue(error is UpdateException)
        assertFalse(error.message.orEmpty().contains("null"))
    }

    private fun validAssets(): List<GithubAsset> = listOf(
        GithubAsset(
            name = "KelasKA-v1.3.0.apk",
            downloadUrl = "https://example.test/KelasKA-v1.3.0.apk",
        ),
        GithubAsset(
            name = "KelasKA-v1.3.0.apk.sha256",
            downloadUrl = "https://example.test/KelasKA-v1.3.0.apk.sha256",
        ),
    )

    private fun asset(name: String): GithubAsset =
        GithubAsset(name = name, downloadUrl = "https://example.test/$name")

    private fun failure(block: () -> Unit): Throwable {
        try {
            block()
        } catch (error: Throwable) {
            return error
        }
        throw AssertionError("Operasi seharusnya gagal")
    }
}
