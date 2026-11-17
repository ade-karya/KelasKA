package ai.kelaska.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ClassWebLinkTest {
    @Test
    fun classroomUrl_memotongSlashesDanMengkodekanId() {
        assertEquals(
            "https://kelaska.riau.ai/classroom/abc-123",
            ClassWebLink.classroomUrl("https://kelaska.riau.ai/", "abc-123"),
        )
        assertEquals(
            "https://kelaska.riau.ai/classroom/abc%2F123",
            ClassWebLink.classroomUrl("https://kelaska.riau.ai", "abc/123"),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun classroomUrl_menolakBaseTanpaHttp() {
        ClassWebLink.classroomUrl("kelaska.riau.ai", "abc")
    }

    @Test(expected = IllegalArgumentException::class)
    fun classroomUrl_menolakIdKosong() {
        ClassWebLink.classroomUrl("https://kelaska.riau.ai", " ")
    }

    @Test
    fun sessionCookie_mengikutiAtributCookieWeb() {
        assertEquals(
            "kelaska_session=tok123; Path=/; HttpOnly; SameSite=Lax; Secure",
            ClassWebLink.sessionCookie("tok123"),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun sessionCookie_menolakTokenKosong() {
        ClassWebLink.sessionCookie("")
    }

    @Test
    fun baseHost_mengambilHost() {
        assertEquals("kelaska.riau.ai", ClassWebLink.baseHost("https://kelaska.riau.ai/"))
        assertNull(ClassWebLink.baseHost("bukan-url"))
    }
}
