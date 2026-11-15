package ai.kelaska.app.util

/** Mengubah HTML dari konten slide menjadi teks polos yang layak baca. */
object HtmlText {

    private val blockBreak = Regex("(?i)<\\s*(br|/p|/div|/li|/ul|/ol|/h[1-6]|/blockquote|/tr|/table)[^>]*>")
    private val listItem = Regex("(?i)<\\s*li[^>]*>")
    private val tag = Regex("<[^>]*>")
    private val tabsAndSpaces = Regex("[\\t ]+")
    private val spaceBeforeNewline = Regex(" *\n *")
    private val repeatedNewlines = Regex("\n{3,}")
    private val numericEntity = Regex("&#(\\d+);")
    private val hexEntity = Regex("&#x([0-9a-fA-F]+);")

    /**
     * Potongan teks berarti (non-kosong) dari sebuah dokumen HTML.
     * Contoh: `"<p>Selamat <b>Pagi</b></p><p>Semua</p>"` → `["Selamat Pagi", "Semua"]`.
     */
    fun paragraphs(html: String?): List<String> {
        val text = strip(html)
        return text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
    }

    fun strip(html: String?): String {
        if (html.isNullOrBlank()) return ""
        var s = html
            .replace("\r\n", "\n")
            .replace("\u00A0", " ")
        s = listItem.replace(s, "• ")
        s = blockBreak.replace(s, "\n")
        s = tag.replace(s, "")
        s = decodeEntities(s)
        s = tabsAndSpaces.replace(s, " ")
        s = spaceBeforeNewline.replace(s, "\n")
        s = repeatedNewlines.replace(s, "\n\n")
        return s.trim()
    }

    private fun decodeEntities(input: String): String {
        var s = input
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&nbsp;", " ")
        s = numericEntity.replace(s) { match ->
            runCatching { String(Character.toChars(match.groupValues[1].toInt())) }.getOrDefault("")
        }
        s = hexEntity.replace(s) { match ->
            runCatching { String(Character.toChars(match.groupValues[1].toInt(16))) }.getOrDefault("")
        }
        return s
    }
}
