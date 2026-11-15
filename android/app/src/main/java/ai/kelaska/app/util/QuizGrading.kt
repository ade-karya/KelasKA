package ai.kelaska.app.util

/** Jenis soal kuis pada dokumen kursus Kelas KA. */
enum class QuizKind { SINGLE, MULTIPLE, SHORT_ANSWER }

data class QuizOption(
    val label: String,
    val value: String,
)

/** Satu soal kuis, terlepas dari representasi JSON-nya. */
data class QuizQuestion(
    val id: String,
    val kind: QuizKind,
    val text: String,
    val options: List<QuizOption>,
    /** Kunci jawaban (mis. ["A"] atau ["A","C"]); kosong untuk soal esai. */
    val answer: List<String>,
    /** Penjelasan yang ditampilkan setelah pemeriksaan. */
    val analysis: String?,
    val points: Int,
    /** Apakah soal dapat dinilai otomatis (kunci tersedia). */
    val autoGradable: Boolean,
)

/** Hasil evaluasi semua soal. */
data class QuizResult(
    val earned: Int,
    val total: Int,
    val autoGraded: Int,
)

object QuizGrading {

    /**
     * Nilai satu soal dari pilihan terpilih (bandingkan himpunan).
     * Mengembalikan `null` bila soal tidak bisa dinilai otomatis.
     */
    fun isCorrect(question: QuizQuestion, selected: Set<String>): Boolean? {
        if (!question.autoGradable) return null
        val key = question.answer.toSet()
        if (key.isEmpty()) return null
        return selected == key
    }

    /** Akumulasi skor untuk satu kuis. */
    fun grade(questions: List<QuizQuestion>, selected: Map<String, Set<String>>): QuizResult {
        var earned = 0
        var total = 0
        var autoGraded = 0
        for (question in questions) {
            if (!question.autoGradable) continue
            total += question.points
            autoGraded += 1
            val picks = selected[question.id] ?: emptySet()
            if (isCorrect(question, picks) == true) earned += question.points
        }
        return QuizResult(earned = earned, total = total, autoGraded = autoGraded)
    }
}
