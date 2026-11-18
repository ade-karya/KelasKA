package ai.kelaska.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.kelaska.app.data.KelasKaApi
import ai.kelaska.app.data.StageDocument
import ai.kelaska.app.data.SceneContent
import ai.kelaska.app.data.SceneDto
import ai.kelaska.app.data.offline.OfflineCourse
import ai.kelaska.app.data.online.OnlineCourseBuilder
import ai.kelaska.app.util.QuizGrading
import ai.kelaska.app.util.QuizKind
import ai.kelaska.app.util.QuizQuestion
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

data class CourseDetailUiState(
    val loading: Boolean = true,
    val document: StageDocument? = null,
    val error: String? = null,
)

/** Tahapan menyiapkan pemutar kelas daring. */
sealed interface CoursePlaybackState {
    data object Idle : CoursePlaybackState
    data class Preparing(val completed: Int = 0, val total: Int = 0) : CoursePlaybackState
    data class Ready(val course: OfflineCourse) : CoursePlaybackState
    data class Failed(val message: String) : CoursePlaybackState
}

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
    private val cacheDir: File,
    private val appVersion: String,
) : ViewModel() {

    private val _state = MutableStateFlow(CourseDetailUiState())
    val state: StateFlow<CourseDetailUiState> = _state.asStateFlow()

    /** State kuis per scene: id scene → state. */
    private val _quizzes = MutableStateFlow<Map<String, SceneQuizState>>(emptyMap())
    val quizzes: StateFlow<Map<String, SceneQuizState>> = _quizzes.asStateFlow()

    private val _playback = MutableStateFlow<CoursePlaybackState>(CoursePlaybackState.Idle)
    val playback: StateFlow<CoursePlaybackState> = _playback.asStateFlow()

    private var playbackJob: Job? = null

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

    /**
     * Siapkan pemutar: unduh media dokumen kursus ke cache lalu bungkus
     * sebagai paket lokal yang diputar [ai.kelaska.app.ui.screens.ClassPlayerScreen].
     * Hasil yang sudah tersimpan dipakai ulang selama kursus tidak berubah.
     */
    fun preparePlayback() {
        if (playbackJob?.isActive == true) return
        val document = _state.value.document ?: return
        playbackJob = viewModelScope.launch {
            _playback.value = CoursePlaybackState.Preparing()
            try {
                val builder = OnlineCourseBuilder(
                    cacheRoot = File(cacheDir, "online-classes"),
                    appVersion = appVersion,
                )
                val course = builder.build(
                    stageId = stageId,
                    document = document,
                    fetch = { ref ->
                        api.fetchMedia(ref)?.let { media ->
                            OnlineCourseBuilder.DownloadedMedia(media.bytes, media.mimeType)
                        }
                    },
                    onProgress = { completed, total ->
                        _playback.value = CoursePlaybackState.Preparing(completed, total)
                    },
                )
                _playback.value = CoursePlaybackState.Ready(course)
            } catch (error: CancellationException) {
                throw error
            } catch (error: ai.kelaska.app.data.AuthExpiredException) {
                _playback.value = CoursePlaybackState.Failed(
                    "Sesi berakhir. Keluar lalu masuk kembali, kemudian coba lagi.",
                )
            } catch (error: Exception) {
                _playback.value = CoursePlaybackState.Failed(
                    error.message ?: "Kelas tidak bisa disiapkan. Periksa koneksi Anda.",
                )
            }
        }
    }

    /** Batalkan persiapan; layar detail kembali tampil. */
    fun cancelPlayback() {
        playbackJob?.cancel()
        playbackJob = null
        _playback.value = CoursePlaybackState.Idle
    }

    /** Tutup pemutar (tombol kembali atau "Daftar materi"). */
    fun stopPlayback() {
        playbackJob?.cancel()
        playbackJob = null
        _playback.value = CoursePlaybackState.Idle
    }

    fun dismissPlaybackError() {
        _playback.value = CoursePlaybackState.Idle
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
