package ai.kelaska.app.util

/** Format tanggal Bahasa Indonesia, tanpa dependensi Android. */
object IndonesianDate {

    private val MONTHS = listOf(
        "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
        "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
    )

    /** `2026-11-15T05:47:57Z` atau epoch millis → `15 Nov 2026, 05.47`. */
    fun format(value: Any?): String {
        val instant = when (value) {
            is Number -> java.time.Instant.ofEpochMilli(value.toLong())
            is String -> runCatching { java.time.Instant.parse(value) }.getOrNull()
                ?: runCatching { java.time.OffsetDateTime.parse(value).toInstant() }.getOrNull()
                ?: java.time.Instant.ofEpochMilli(value.toLongOrNull() ?: 0L)
            else -> return "-"
        }
        val zoned = instant.atZone(java.time.ZoneId.systemDefault())
        return "%d %s %d, %02d.%02d".format(
            zoned.dayOfMonth,
            MONTHS[zoned.monthValue - 1],
            zoned.year,
            zoned.hour,
            zoned.minute,
        )
    }
}
