package ai.kelaska.app.data

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneContentTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `parseSlide orders text elements top to bottom and strips html`() {
        val content = json.parseToJsonElement(
            """
            {
              "type": "slide",
              "canvas": {
                "elements": [
                  {"type": "text", "top": 300, "left": 10, "content": "<p>Bagian bawah</p>"},
                  {"type": "text", "top": 10,  "left": 10, "content": "<h1>Judul</h1>"}
                ]
              }
            }
            """,
        ) as kotlinx.serialization.json.JsonObject

        val reading = SceneContent.parseSlide(content)
        assertEquals(listOf("Judul", "Bagian bawah"), reading.paragraphs)
    }

    @Test
    fun `parseSlide keeps only direct http image urls`() {
        val content = json.parseToJsonElement(
            """
            {
              "type": "slide",
              "canvas": {
                "elements": [
                  {"type": "image", "top": 0, "left": 0, "src": "https://kelaska.riau.ai/a.png"},
                  {"type": "image", "top": 10, "left": 0, "src": "ast_0123456789abcdef"}
                ]
              }
            }
            """,
        ) as kotlinx.serialization.json.JsonObject

        val reading = SceneContent.parseSlide(content)
        assertEquals(listOf("https://kelaska.riau.ai/a.png"), reading.imageUrls)
    }

    @Test
    fun `parseQuiz normalizes kinds answers and options`() {
        val content = json.parseToJsonElement(
            """
            {
              "type": "quiz",
              "questions": [
                {
                  "id": "q1",
                  "type": "single",
                  "question": "<p>2 + 2 = ?</p>",
                  "options": [
                    {"label": "<b>3</b>", "value": "A"},
                    {"label": "4", "value": "B"}
                  ],
                  "answer": ["B"],
                  "analysis": "<p>Dasar penjumlahan</p>",
                  "points": 2
                },
                {
                  "id": "q2",
                  "type": "short_answer",
                  "question": "Ceritakan riwayatmu",
                  "hasAnswer": false
                }
              ]
            }
            """,
        ) as kotlinx.serialization.json.JsonObject

        val questions = SceneContent.parseQuiz(content)
        assertEquals(2, questions.size)
        assertEquals("2 + 2 = ?", questions[0].text)
        assertEquals(listOf("A", "B"), questions[0].options.map { it.value })
        assertEquals("3", questions[0].options[0].label)
        assertEquals(listOf("B"), questions[0].answer)
        assertEquals(2, questions[0].points)
        assertTrue(questions[0].autoGradable)
        assertEquals("Dasar penjumlahan", questions[0].analysis)
    }

    @Test
    fun `parseQuiz tolerates missing fields`() {
        val content = json.parseToJsonElement("""{"type": "quiz", "questions": [{}]}""")
            as kotlinx.serialization.json.JsonObject

        val questions = SceneContent.parseQuiz(content)
        assertEquals(1, questions.size)
        assertEquals(1, questions[0].points)
        assertEquals("", questions[0].text)
    }
}
