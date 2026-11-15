package ai.kelaska.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QuizGradingTest {

    private val single = QuizQuestion(
        id = "q1",
        kind = QuizKind.SINGLE,
        text = "Ibu kota Indonesia?",
        options = listOf(QuizOption("Jakarta", "A"), QuizOption("Nusantara", "B")),
        answer = listOf("A"),
        analysis = "Jakarta adalah ibu kota de facto.",
        points = 2,
        autoGradable = true,
    )

    private val multiple = QuizQuestion(
        id = "q2",
        kind = QuizKind.MULTIPLE,
        text = "Pilih genap:",
        options = listOf(QuizOption("2", "A"), QuizOption("3", "B"), QuizOption("4", "C")),
        answer = listOf("A", "C"),
        analysis = null,
        points = 3,
        autoGradable = true,
    )

    private val essay = QuizQuestion(
        id = "q3",
        kind = QuizKind.SHORT_ANSWER,
        text = "Ceritakan!",
        options = emptyList(),
        answer = emptyList(),
        analysis = "Lihat catatan.",
        points = 5,
        autoGradable = false,
    )

    @Test
    fun `single choice requires the exact key`() {
        assertEquals(true, QuizGrading.isCorrect(single, setOf("A")))
        assertEquals(false, QuizGrading.isCorrect(single, setOf("B")))
        assertEquals(false, QuizGrading.isCorrect(single, emptySet()))
    }

    @Test
    fun `multiple choice compares sets`() {
        assertEquals(true, QuizGrading.isCorrect(multiple, setOf("C", "A")))
        assertEquals(false, QuizGrading.isCorrect(multiple, setOf("A")))
        assertEquals(false, QuizGrading.isCorrect(multiple, setOf("A", "B", "C")))
    }

    @Test
    fun `essay questions are not auto graded`() {
        assertNull(QuizGrading.isCorrect(essay, setOf("jawaban")))
    }

    @Test
    fun `grade sums points only for auto graded questions`() {
        val result = QuizGrading.grade(
            listOf(single, multiple, essay),
            mapOf(
                "q1" to setOf("A"),       // 2 poin benar
                "q2" to setOf("A"),       // salah
                "q3" to setOf("bebas"),   // esai: diabaikan
            ),
        )
        assertEquals(2, result.earned)
        assertEquals(5, result.total)
        assertEquals(2, result.autoGraded)
    }
}
