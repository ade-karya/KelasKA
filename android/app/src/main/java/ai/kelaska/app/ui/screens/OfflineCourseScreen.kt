package ai.kelaska.app.ui.screens

import android.content.Context
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.kelaska.app.data.SceneContent
import ai.kelaska.app.data.offline.OfflineCourse
import ai.kelaska.app.data.offline.OfflineNarrationClip
import ai.kelaska.app.data.offline.OfflineScene
import ai.kelaska.app.ui.CenteredContent
import ai.kelaska.app.ui.OfflineCourseViewModel
import ai.kelaska.app.ui.SceneQuizState
import ai.kelaska.app.ui.components.InteractiveContentDialog
import ai.kelaska.app.ui.components.QuizSceneCard
import ai.kelaska.app.ui.components.SlideSceneCard
import ai.kelaska.app.ui.player.NarrationTts
import ai.kelaska.app.util.IndonesianDate
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Pemutar kursus dari paket `.maic.zip`: slide (teks/gambar/audio/video),
 * narasi, kuis, dan konten interaktif HTML yang sudah inlin. Tidak ada
 * permintaan jaringan; seluruh media dibaca dari folder paket.
 */
@Composable
fun OfflineCourseScreen(
    viewModel: OfflineCourseViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsState()
    val quizzes by viewModel.quizzes.collectAsState()

    when {
        state.loading -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }

        state.error != null || state.course == null -> Column(
            modifier = modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                "Kursus offline tidak bisa dibuka",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            )
            Text(
                state.error.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
            )
            FilledTonalButton(onClick = viewModel::load) { Text("Coba lagi") }
            TextButton(onClick = onBack) { Text("Kembali") }
        }

        else -> {
            var showList by remember(state.course!!.meta.id) { mutableStateOf(false) }
            if (!showList) {
                // Default: putar kelas persis seperti versi web (bundle pemutar
                // dan HTML yang sama dipakai ekspor standalone kelaska.riau.ai).
                ClassPlayerScreen(
                    course = state.course!!,
                    onBack = onBack,
                    onOpenList = { showList = true },
                    modifier = modifier,
                )
            } else {
                OfflineCourseContent(
                    course = state.course!!,
                    quizzes = quizzes,
                    viewModel = viewModel,
                    onBack = onBack,
                    onPlay = { showList = false },
                    modifier = modifier,
                )
            }
        }
    }
}

@Composable
private fun OfflineCourseContent(
    course: OfflineCourse,
    quizzes: Map<String, SceneQuizState>,
    viewModel: OfflineCourseViewModel,
    onBack: () -> Unit,
    onPlay: () -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val narrationPlayer = remember(course.meta.id) { NarrationPlayer(context) }
    DisposableEffect(narrationPlayer) {
        onDispose { narrationPlayer.release() }
    }
    var interactive by remember { mutableStateOf<InteractiveTarget?>(null) }

    val slides = course.scenes.count { it.type == "slide" }
    val quizCount = course.scenes.count { it.type == "quiz" }

    CenteredContent(modifier = modifier) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali")
                }
                Text(
                    "Kursus Offline",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    modifier = Modifier.weight(1f),
                )
                FilledTonalButton(onClick = onPlay) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(" Putar Kelas")
                }
            }
        }

        item {
            Card(
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Column(Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Filled.School,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(28.dp),
                        )
                        Text(
                            course.manifest.stage.name,
                            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(start = 10.dp),
                        )
                    }
                    if (!course.manifest.stage.description.isNullOrBlank()) {
                        Text(
                            course.manifest.stage.description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f),
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(top = 12.dp),
                    ) {
                        MetaChip("${course.scenes.size} materi")
                        if (slides > 0) MetaChip("$slides slide")
                        if (quizCount > 0) MetaChip("$quizCount kuis")
                        MetaChip("Diimpor ${IndonesianDate.format(course.meta.importedAt)}")
                    }
                }
            }
        }

        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    Icons.Filled.CloudOff,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    " Mode offline — semua materi dibaca dari perangkat ini",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        itemsIndexed(course.scenes) { index, scene ->
            val sceneId = "scene-$index"
            when (scene.type) {
                "slide" -> {
                    val reading = remember(course.meta.id, index) {
                        SceneContent.parseSlide(scene.content, course::resolveSlideMedia)
                    }
                    val clips = remember(course.meta.id, index) {
                        // Audio elemen slide sudah punya tombol sendiri di
                        // SlideSceneCard; di sini hanya narasi (speech).
                        course.narration(scene)
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SlideSceneCard(
                            title = scene.title,
                            reading = reading,
                            emptyHint = "Slide ini tidak memiliki teks atau media yang bisa ditampilkan offline.",
                        )
                        if (clips.isNotEmpty()) {
                            NarrationCard(
                                clips = clips,
                                player = narrationPlayer,
                            )
                        }
                    }
                }

                "quiz" -> QuizSceneCard(
                    title = scene.title,
                    quizState = quizzes[sceneId] ?: SceneQuizState(),
                    questions = viewModel.questionsOf(scene),
                    onSelect = { question, value, checked ->
                        viewModel.selectOption(sceneId, question, value, checked)
                    },
                    onCheck = { viewModel.checkAnswers(sceneId, scene.content) },
                    onReset = { viewModel.resetQuiz(sceneId) },
                )

                "interactive" -> {
                    val html = scene.content["html"]?.jsonPrimitive?.contentOrNull
                    val url = scene.content["url"]?.jsonPrimitive?.contentOrNull
                    InteractiveSceneCard(
                        scene = scene,
                        hasHtml = !html.isNullOrBlank(),
                        url = url,
                        onOpen = {
                            html?.takeIf { it.isNotBlank() }?.let {
                                interactive = InteractiveTarget(scene.title, it)
                            }
                        },
                    )
                }

                else -> PblSceneCard(scene)
            }
        }

        item {
            Text(
                "Kursus ini diimpor dari “${course.meta.sourceName ?: "berkas .maic.zip"}”. Jika ada bagian yang belum tampil, ekspor ulang dari kelaska.riau.ai.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        }
    }

    interactive?.let { target ->
        InteractiveContentDialog(
            title = target.title,
            html = target.html,
            onDismiss = { interactive = null },
        )
    }
}

private data class InteractiveTarget(val title: String, val html: String)

@Composable
private fun MetaChip(text: String) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.08f),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

/**
 * Pemutar narasi berurutan, mengikuti versi web: klip dengan berkas audio
 * diputar lewat MediaPlayer, sedangkan klip tanpa berkas ("audio tidak ada
 * source") dibacakan mesin TTS perangkat lewat [NarrationTts]. Satu klip
 * selesai otomatis lanjut ke klip berikutnya supaya alur bercerita tetap utuh.
 */
private class NarrationPlayer(context: Context) {
    private val tts = NarrationTts(context)
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var clips: List<OfflineNarrationClip> = emptyList()
    var currentIndex by mutableStateOf<Int?>(null)
        private set

    fun play(clips: List<OfflineNarrationClip>, startIndex: Int) {
        stop()
        this.clips = clips
        if (clips.isEmpty()) return
        playAt(startIndex.coerceIn(0, clips.lastIndex))
    }

    fun stop() {
        currentIndex = null
        releaseAudio()
        tts.stop()
    }

    fun release() {
        stop()
        tts.release()
        clips = emptyList()
    }

    private fun playAt(index: Int) {
        val clip = clips.getOrNull(index) ?: run {
            stop()
            return
        }
        stop()
        currentIndex = index
        val path = clip.audioPath
        if (path != null) {
            playFile(path, index)
            return
        }
        // Tidak ada berkas audio: bacakan teksnya, sama seperti pemutar web
        // memakai browser-native TTS untuk baris tanpa audio.
        if (clip.text.isNotBlank()) {
            val accepted = tts.speak(
                text = clip.text,
                onEnd = { advanceFrom(index) },
                onFailure = { advanceFrom(index) },
            )
            if (accepted) return
        }
        advanceFrom(index)
    }

    private fun playFile(path: String, index: Int) {
        val next = MediaPlayer()
        player = next
        try {
            next.setDataSource(path)
            next.setOnPreparedListener { it.start() }
            next.setOnCompletionListener { main.post { advanceFrom(index) } }
            next.setOnErrorListener { _, _, _ ->
                // Berkas rusak: lewati klip ini, jangan hentikan seluruh narasi.
                main.post { advanceFrom(index) }
                true
            }
            next.prepareAsync()
        } catch (_: Exception) {
            advanceFrom(index)
        }
    }

    /** Lanjut hanya bila klip ini masih aktif, supaya callback lama tidak menimpa. */
    private fun advanceFrom(index: Int) {
        if (currentIndex != index) return
        val next = index + 1
        if (next <= clips.lastIndex) playAt(next) else stop()
    }

    private fun releaseAudio() {
        player?.let { active ->
            runCatching { active.reset() }
            runCatching { active.release() }
        }
        player = null
    }
}

@Composable
private fun NarrationCard(
    clips: List<OfflineNarrationClip>,
    player: NarrationPlayer,
    modifier: Modifier = Modifier,
) {
    // Klip tanpa berkas audio tetap bisa diputar: teksnya dibacakan TTS.
    val playable = clips.withIndex().filter { it.value.audioPath != null || it.value.text.isNotBlank() }
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.AutoAwesome,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    "Narasi",
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.padding(start = 8.dp),
                )
                if (playable.isNotEmpty()) {
                    TextButton(
                        onClick = {
                            if (player.currentIndex != null) {
                                player.stop()
                            } else {
                                player.play(clips, 0)
                            }
                        },
                        modifier = Modifier.padding(start = 6.dp),
                    ) {
                        Icon(
                            if (player.currentIndex != null) Icons.Filled.Stop else Icons.Filled.PlayArrow,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(if (player.currentIndex != null) " Berhenti" else " Putar semua")
                    }
                }
            }
            clips.forEachIndexed { index, clip ->
                Row(
                    verticalAlignment = Alignment.Top,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                ) {
                    if (clip.audioPath != null || clip.text.isNotBlank()) {
                        IconButton(
                            onClick = {
                                if (player.currentIndex == index) {
                                    player.stop()
                                } else {
                                    player.play(clips, index)
                                }
                            },
                            modifier = Modifier.size(32.dp),
                        ) {
                            Icon(
                                if (player.currentIndex == index) Icons.Filled.Stop else Icons.Filled.PlayArrow,
                                contentDescription = "Putar klip ${index + 1}",
                                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                        }
                    }
                    Text(
                        clip.text.ifBlank { "Klip narasi ${index + 1}" },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.padding(start = 6.dp, top = 6.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun InteractiveSceneCard(
    scene: OfflineScene,
    hasHtml: Boolean,
    url: String?,
    onOpen: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FilterChip(
                    selected = false,
                    onClick = {},
                    label = { Text("INTERAKTIF") },
                    shape = RoundedCornerShape(999.dp),
                )
                Text(
                    scene.title.ifBlank { "Konten interaktif" },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
            Text(
                if (hasHtml) {
                    "Simulasi/konten interaktif ini tersimpan lengkap di paket dan berjalan tanpa internet."
                } else {
                    "Konten ini hanya tersedia sebagai tautan daring sehingga tidak bisa dibuka saat offline."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
            if (!hasHtml && !url.isNullOrBlank()) {
                Text(
                    url,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            if (hasHtml) {
                FilledTonalButton(
                    onClick = onOpen,
                    modifier = Modifier.padding(top = 12.dp),
                    shape = RoundedCornerShape(999.dp),
                ) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                    Text("Buka Konten")
                }
            }
        }
    }
}

@Composable
private fun PblSceneCard(scene: OfflineScene) {
    val projectId = runCatching {
        scene.content["projectV3"]?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull
    }.getOrNull()
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FilterChip(
                    selected = false,
                    onClick = {},
                    label = { Text("PROYEK") },
                    shape = RoundedCornerShape(999.dp),
                )
                Text(
                    scene.title.ifBlank { "Proyek belajar" },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
            Text(
                "Proyek PBL membutuhkan lingkungan sandbox dan koneksi ke server, jadi belum bisa dijalankan sepenuhnya offline." +
                    (projectId?.let { " Proyek: $it." } ?: ""),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
    }
}
