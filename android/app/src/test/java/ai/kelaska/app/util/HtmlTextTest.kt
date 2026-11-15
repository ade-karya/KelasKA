package ai.kelaska.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HtmlTextTest {

    @Test
    fun `strip removes tags and keeps text`() {
        assertEquals("Selamat pagi", HtmlText.strip("<p>Selamat <b>pagi</b></p>"))
    }

    @Test
    fun `strip decodes common entities`() {
        assertEquals(
            "5 < 6 & 7 > 4",
            HtmlText.strip("5 &lt; 6 &amp; 7 &gt; 4"),
        )
        assertEquals("don't", HtmlText.strip("don&#39;t"))
    }

    @Test
    fun `block elements become line breaks`() {
        val text = HtmlText.strip("<p>Satu</p><p>Dua</p>")
        assertEquals("Satu\nDua", text)
    }

    @Test
    fun `list items become bullet lines`() {
        val paragraphs = HtmlText.paragraphs("<ul><li>Satu</li><li>Dua</li></ul>")
        assertEquals(listOf("• Satu", "• Dua"), paragraphs)
    }

    @Test
    fun `paragraphs splits and drops empties`() {
        val paragraphs = HtmlText.paragraphs("<p>Satu</p><p> </p><p>Dua</p>")
        assertEquals(listOf("Satu", "Dua"), paragraphs)
    }

    @Test
    fun `null input produces empty output`() {
        assertEquals("", HtmlText.strip(null))
        assertTrue(HtmlText.paragraphs(null).isEmpty())
    }
}
