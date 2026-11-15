package ai.kelaska.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.KelasKaApi
import ai.kelaska.app.data.StageDocument
import ai.kelaska.app.data.SceneContent
import ai.kelaska.app.data.SceneDto
import ai.kelaska.app.util.QuizGrading
import ai.kelaska.app.util.QuizKind
import ai.kelaska.app.util.QuizQuestion
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CourseDetailUiState(
    val loading: Boolean = true,
    val document: StageDocument? = null,
    val error: String? = null,
)

/** State kuis satu scene. */
data class SceneQuizState(
    /** Pilihan per soal: id soal → himpunan value terpilih. */
    val selected: Map<String, Set<String>> = emptyMap(),
    val checked: Boolean = false,
    val scoreEarned: Int = 0,
    val scoreTotal: Int = 0,
    val autoGraded: Int = 0,
)

class CourseDetailViewModel(
    private val api: KelasKaApi,
    private val stageId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(CourseDetailUiState())
    val state: StateFlow<CourseDetailUiState> = _state.asStateFlow()

    /** State kuis per scene: id scene → state. */
    private val _quizzes = MutableStateFlow<Map<String, SceneQuizState>>(emptyMap())
    val quizzes: StateFlow<Map<String, SceneQuizState>> = _quizzes.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.value = CourseDetailUiState(loading = true)
            try {
                _state.value = CourseDetailUiState(document = api.getStageDocument(stageId))
            } catch (error: ai.kelaska.app.data.AuthExpiredException) {
                _state.value = CourseDetailUiState(error = "Sesi berakhir. Keluar lalu masuk kembali.")
            } catch (error: Exception) {
                _state.value = CourseDetailUiState(error = error.message ?: "Gagal memuat kursus")
            }
        }
    }

    fun questionsOf(scene: SceneDto) = SceneContent.parseQuiz(scene.content)

    fun sceneQuiz(sceneId: String): SceneQuizState = _quizzes.value[sceneId] ?: SceneQuizState()

    fun selectOption(scene: SceneDto, question: QuizQuestion, value: String, checked: Boolean) {
        val current = sceneQuiz(scene.id)
        if (current.checked) return
        val existing = current.selected[question.id] ?: emptySet()
        val updated = when (question.kind) {
            QuizKind.SINGLE -> if (checked) setOf(value) else emptySet()
            QuizKind.MULTIPLE -> if (checked) existing + value else existing - value
            QuizKind.SHORT_ANSWER -> existing
        }
        _quizzes.value = _quizzes.value + (scene.id to current.copy(selected = current.selected + (question.id to updated)))
    }

    fun checkAnswers(scene: SceneDto) {
        val current = sceneQuiz(scene.id)
        val questions = questionsOf(scene)
        val result = QuizGrading.grade(questions, current.selected)
        _quizzes.value = _quizzes.value + (scene.id to current.copy(
            checked = true,
            scoreEarned = result.earned,
            scoreTotal = result.total,
            autoGraded = result.autoGraded,
        ))
    }

    fun resetQuiz(sceneId: String) {
        _quizzes.value = _quizzes.value + (sceneId to SceneQuizState())
    }
}
