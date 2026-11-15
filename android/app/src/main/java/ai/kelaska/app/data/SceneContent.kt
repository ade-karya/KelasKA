package ai.kelaska.app.data

import ai.kelaska.app.util.HtmlText
import ai.kelaska.app.util.QuizKind
import ai.kelaska.app.util.QuizOption
import ai.kelaska.app.util.QuizQuestion
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Bacaan satu slide: paragraf teks + gambar/audio/video yang bisa dimuat.
 *
 * Nilai pada daftar media berupa URL `http(s)` saat dibaca online, atau path
 * berkas absolut saat slide berasal dari paket `.maic.zip` offline.
 */
data class SlideReading(
    val paragraphs: List<String>,
    val imageUrls: List<String>,
    val audioPaths: List<String> = emptyList(),
    val videoPaths: List<String> = emptyList(),
)

object SceneContent {

    /** Elemen teks slide diurutkan dari atas ke bawah, lalu kiri ke kanan. */
    private fun elementPosition(element: JsonObject): Pair<Double, Double> {
        val top = element["top"]?.jsonPrimitive?.intOrNull?.toDouble()
            ?: element["y"]?.jsonPrimitive?.intOrNull?.toDouble()
            ?: 0.0
        val left = element["left"]?.jsonPrimitive?.intOrNull?.toDouble()
            ?: element["x"]?.jsonPrimitive?.intOrNull?.toDouble()
            ?: 0.0
        return top to left
    }

    /**
     * Ekstrak bacaan dari `SlideContent`. Teks HTML (`<p>`, `<li>`, …) diubah
     * menjadi garis-garis teks polos.
     *
     * `resolveMedia` memetakan referensi aset (`ast_…`) ke path berkas lokal
     * untuk paket `.maic.zip`. Tanpa resolver, hanya `src` berupa URL langsung
     * yang dipakai — perilaku baca daring yang sudah ada.
     */
    fun parseSlide(
        content: JsonObject,
        resolveMedia: (String) -> String? = { null },
    ): SlideReading {
        val canvas = content["canvas"]?.jsonObject ?: return SlideReading(emptyList(), emptyList())
        val elements = canvas["elements"]?.jsonArray ?: return SlideReading(emptyList(), emptyList())

        val sorted = elements.mapNotNull { it as? JsonObject }
            .sortedWith(compareBy({ elementPosition(it).first }, { elementPosition(it).second }))

        fun mediaOf(ref: String?): String? {
            if (ref.isNullOrBlank()) return null
            return resolveMedia(ref)
                ?: ref.takeIf { it.startsWith("http://") || it.startsWith("https://") }
        }

        val paragraphs = mutableListOf<String>()
        val images = mutableListOf<String>()
        val audio = mutableListOf<String>()
        val videos = mutableListOf<String>()

        (canvas["background"] as? JsonObject)
            ?.takeIf { it["type"]?.jsonPrimitive?.contentOrNull == "image" }
            ?.get("image")
            ?.let { it as? JsonObject }
            ?.get("src")
            ?.jsonPrimitive
            ?.contentOrNull
            ?.let(::mediaOf)
            ?.let { images += it }

        for (element in sorted) {
            when (element["type"]?.jsonPrimitive?.contentOrNull) {
                "text" -> paragraphs += HtmlText.paragraphs(element["content"]?.jsonPrimitive?.contentOrNull)
                "latex" -> element["latex"]?.jsonPrimitive?.contentOrNull?.let { paragraphs += it }
                "image" -> mediaOf(element["src"]?.jsonPrimitive?.contentOrNull)?.let { images += it }
                "audio" -> mediaOf(element["src"]?.jsonPrimitive?.contentOrNull)?.let { audio += it }
                "video" -> mediaOf(element["src"]?.jsonPrimitive?.contentOrNull)?.let { videos += it }
                "code" -> (element["code"] as? JsonObject)?.get("code")?.jsonPrimitive?.contentOrNull
                    ?.takeIf { it.isNotBlank() }
                    ?.let { paragraphs += it }
                else -> Unit
            }
        }
        return SlideReading(paragraphs, images, audio, videos)
    }

    /** Parse `QuizContent` menjadi soal-soal yang siap dinilai. */
    fun parseQuiz(content: JsonObject): List<QuizQuestion> {
        val questions = content["questions"]?.jsonArray ?: return emptyList()
        return questions.mapIndexedNotNull { index, element ->
            val q = element as? JsonObject ?: return@mapIndexedNotNull null
            val kind = when (q["type"]?.jsonPrimitive?.contentOrNull) {
                "single" -> QuizKind.SINGLE
                "multiple" -> QuizKind.MULTIPLE
                else -> QuizKind.SHORT_ANSWER
            }
            val options = q["options"]?.jsonArray?.mapNotNull { option ->
                val o = option as? JsonObject ?: return@mapNotNull null
                val label = HtmlText.strip(o["label"]?.jsonPrimitive?.contentOrNull)
                val value = o["value"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                if (label.isEmpty()) null else QuizOption(label, value)
            } ?: emptyList()
            val answer = parseAnswer(q["answer"])
            val points = q["points"]?.jsonPrimitive?.intOrNull ?: 1
            val autoGradable = q["hasAnswer"]?.jsonPrimitive?.booleanOrNull
                ?: answer.isNotEmpty()
            QuizQuestion(
                id = q["id"]?.jsonPrimitive?.contentOrNull ?: "q-$index",
                kind = kind,
                text = HtmlText.strip(q["question"]?.jsonPrimitive?.contentOrNull),
                options = options,
                answer = answer,
                analysis = HtmlText.strip(q["analysis"]?.jsonPrimitive?.contentOrNull).ifEmpty { null },
                points = points,
                autoGradable = autoGradable,
            )
        }
    }

    /** Kunci jawaban bisa berupa string tunggal atau larik string. */
    private fun parseAnswer(value: kotlinx.serialization.json.JsonElement?): List<String> =
        when (value) {
            is JsonArray -> value.mapNotNull { it.jsonPrimitive.contentOrNull }
            is kotlinx.serialization.json.JsonPrimitive -> listOfNotNull(value.contentOrNull)
            else -> emptyList()
        }
}
