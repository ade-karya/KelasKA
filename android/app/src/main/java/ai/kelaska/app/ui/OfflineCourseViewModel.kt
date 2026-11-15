package ai.kelaska.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.SceneContent
import ai.kelaska.app.data.offline.OfflineCourse
import ai.kelaska.app.data.offline.OfflinePackageStore
import ai.kelaska.app.data.offline.OfflineScene
import ai.kelaska.app.util.QuizGrading
import ai.kelaska.app.util.QuizKind
import ai.kelaska.app.util.QuizQuestion
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class OfflineCourseUiState(
    val loading: Boolean = true,
    val course: OfflineCourse? = null,
    val error: String? = null,
)

/** Memuat satu paket offline dari penyimpanan; tidak ada permintaan jaringan. */
class OfflineCourseViewModel(
    private val store: OfflinePackageStore,
    private val packageId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(OfflineCourseUiState())
    val state: StateFlow<OfflineCourseUiState> = _state.asStateFlow()

    private val _quizzes = MutableStateFlow<Map<String, SceneQuizState>>(emptyMap())
    val quizzes: StateFlow<Map<String, SceneQuizState>> = _quizzes.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _state.value = OfflineCourseUiState(loading = true)
            val course = withContext(Dispatchers.IO) { store.load(packageId) }
            _state.value = if (course == null) {
                OfflineCourseUiState(
                    loading = false,
                    error = "Paket offline tidak ditemukan atau sudah dihapus.",
                )
            } else {
                OfflineCourseUiState(loading = false, course = course)
            }
        }
    }

    fun questionsOf(scene: OfflineScene): List<QuizQuestion> = SceneContent.parseQuiz(scene.content)

    fun sceneQuiz(sceneId: String): SceneQuizState = _quizzes.value[sceneId] ?: SceneQuizState()

    fun selectOption(sceneId: String, question: QuizQuestion, value: String, checked: Boolean) {
        val current = sceneQuiz(sceneId)
        if (current.checked) return
        val existing = current.selected[question.id] ?: emptySet()
        val updated = when (question.kind) {
            QuizKind.SINGLE -> if (checked) setOf(value) else emptySet()
            QuizKind.MULTIPLE -> if (checked) existing + value else existing - value
            QuizKind.SHORT_ANSWER -> existing
        }
        _quizzes.value = _quizzes.value + (sceneId to current.copy(
            selected = current.selected + (question.id to updated),
        ))
    }

    fun checkAnswers(sceneId: String, content: kotlinx.serialization.json.JsonObject) {
        val current = sceneQuiz(sceneId)
        val result = QuizGrading.grade(SceneContent.parseQuiz(content), current.selected)
        _quizzes.value = _quizzes.value + (sceneId to current.copy(
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
