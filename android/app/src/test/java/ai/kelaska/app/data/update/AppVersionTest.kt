package ai.kelaska.app.data.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppVersionTest {

    @Test
    fun parsesThreeComponentsWithOrWithoutVPrefix() {
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("1.2.3"))
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("v1.2.3"))
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("V1.2.3"))
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("  v1.2.3  "))
    }

    @Test
    fun missingComponentsDefaultToZero() {
        assertEquals(SemanticVersion(1, 2, 0), SemanticVersion.parse("v1.2"))
        assertEquals(SemanticVersion(1, 0, 0), SemanticVersion.parse("1"))
    }

    @Test
    fun ignoresPrereleaseAndBuildMetadata() {
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("v1.2.3-rc.1"))
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("1.2.3+build.7"))
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("1.2.3-beta+exp.sha.5114f85"))
    }

    @Test
    fun acceptsVendorPrefixedTagsLikeAndroidV100() {
        // Rilis pertama repo ini memakai tag `android-v1.0.0`.
        assertEquals(SemanticVersion(1, 0, 0), SemanticVersion.parse("android-v1.0.0"))
        assertEquals(SemanticVersion(1, 2, 3), SemanticVersion.parse("KelasKA-v1.2.3"))
        assertFalse(isNewerVersion("android-v1.0.0", "1.2.0"))
    }

    @Test
    fun rejectsUnparseableTags() {
        assertNull(SemanticVersion.parse(null))
        assertNull(SemanticVersion.parse(""))
        assertNull(SemanticVersion.parse("v"))
        assertNull(SemanticVersion.parse("latar"))
        assertNull(SemanticVersion.parse("1.x"))
        assertNull(SemanticVersion.parse("1..3"))
        assertNull(SemanticVersion.parse("1.2.3.4"))
        assertNull(SemanticVersion.parse("-1.2.3"))
    }

    @Test
    fun comparesComponentsNumericallyNotLexicographically() {
        assertTrue(SemanticVersion(1, 10, 0) > SemanticVersion(1, 9, 9))
        assertTrue(SemanticVersion(2, 0, 0) > SemanticVersion(1, 99, 99))
        assertTrue(SemanticVersion(1, 2, 4) > SemanticVersion(1, 2, 3))
        assertEquals(0, SemanticVersion(1, 2, 3).compareTo(SemanticVersion(1, 2, 3)))
        assertTrue(SemanticVersion(1, 0, 0) < SemanticVersion(1, 0, 1))
    }

    @Test
    fun detectsNewerReleaseTags() {
        assertTrue(isNewerVersion("v1.3.0", "1.2.0"))
        assertTrue(isNewerVersion("1.2.1", "v1.2.0"))
        assertTrue(isNewerVersion("v1.10.0", "1.9.9"))
        assertTrue(isNewerVersion("v2", "1.99.99"))
    }

    @Test
    fun sameOrOlderTagsAreNotUpdates() {
        assertFalse(isNewerVersion("v1.2.0", "1.2.0"))
        assertFalse(isNewerVersion("v1.1.9", "1.2.0"))
        assertFalse(isNewerVersion("v01.2.0", "1.2.0"))
    }

    @Test
    fun invalidTagsNeverBecomeUpdates() {
        assertFalse(isNewerVersion("rilis-baru", "1.2.0"))
        assertFalse(isNewerVersion("v1.3.0", "versi-dev"))
        assertFalse(isNewerVersion(null, "1.2.0"))
        assertFalse(isNewerVersion("v1.3.0", null))
    }
}
