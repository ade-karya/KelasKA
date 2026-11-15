package ai.kelaska.app.ui.screens

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import androidx.compose.ui.layout.ContentScale
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.data.SceneContent
import ai.kelaska.app.data.SceneDto
import ai.kelaska.app.ui.CourseDetailUiState
import ai.kelaska.app.ui.CourseDetailViewModel
import ai.kelaska.app.ui.SceneQuizState
import ai.kelaska.app.util.IndonesianDate
import ai.kelaska.app.util.QuizKind
import ai.kelaska.app.util.QuizQuestion

@Composable
fun CourseDetailScreen(
    viewModel: CourseDetailViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsState()
    val quizzes by viewModel.quizzes.collectAsState()

    when {
        state.loading ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

        state.error != null ->
            Column(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    "Gagal memuat kursus",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                )
                Text(
                    state.error!!,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
                )
                FilledTonalButton(onClick = viewModel::load) { Text("Coba lagi") }
            }

        state.document != null -> DetailContent(
            state = state,
            quizzes = quizzes,
            viewModel = viewModel,
            onBack = onBack,
            modifier = modifier,
        )
    }
}

@Composable
private fun DetailContent(
    state: CourseDetailUiState,
    quizzes: Map<String, SceneQuizState>,
    viewModel: CourseDetailViewModel,
    onBack: () -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val doc = state.document!!
    val slides = doc.scenes.count { it.type == "slide" }
    val quizCount = doc.scenes.count { it.type == "quiz" }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, contentDescription = "Kembali") }
                Text(
                    "Detail Kursus",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                )
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
                        Spacer(Modifier.width(10.dp))
                        Text(
                            doc.stage.name,
                            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                    if (!doc.stage.description.isNullOrBlank()) {
                        Text(
                            doc.stage.description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f),
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(top = 12.dp),
                    ) {
                        MetaChip("${doc.scenes.size} materi")
                        if (slides > 0) MetaChip("$slides slide")
                        if (quizCount > 0) MetaChip("$quizCount kuis")
                        MetaChip("Diubah ${IndonesianDate.format(doc.stage.updatedAt)}")
                    }
                }
            }
        }

        items(doc.scenes.sortedBy { it.order }, key = { it.id }) { scene ->
            when (scene.type) {
                "slide" -> SlideSceneCard(scene)
                "quiz" -> QuizSceneCard(
                    scene = scene,
                    quizState = quizzes[scene.id] ?: SceneQuizState(),
                    questions = viewModel.questionsOf(scene),
                    onSelect = { question, value, checked -> viewModel.selectOption(scene, question, value, checked) },
                    onCheck = { viewModel.checkAnswers(scene) },
                    onReset = { viewModel.resetQuiz(scene.id) },
                )
                else -> OpenWebSceneCard(
                    scene = scene,
                    onOpenWeb = { openInCustomTab(context, "${BuildConfig.BASE_URL}/classroom/${doc.stage.id}") },
                )
            }
        }

        item {
            OutlinedButton(
                onClick = { openInCustomTab(context, "${BuildConfig.BASE_URL}/classroom/${doc.stage.id}") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(999.dp),
            ) {
                Icon(Icons.Filled.OpenInNew, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                Text("Pengalaman penuh di kelaska.riau.ai")
            }
        }
    }
}

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

@Composable
private fun SlideSceneCard(scene: SceneDto) {
    val reading = remember(scene.id) { SceneContent.parseSlide(scene.content) }
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FilterChip(
                    selected = false,
                    onClick = {},
                    label = { Text("MATERI") },
                    shape = RoundedCornerShape(999.dp),
                )
                Text(
                    scene.title.ifBlank { "Materi" },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
            reading.paragraphs.forEach { paragraph ->
                Text(
                    paragraph,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            reading.imageUrls.forEach { url ->
                AsyncImage(
                    model = url,
                    contentDescription = null,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp)
                        .height(180.dp)
                        .clip(RoundedCornerShape(14.dp)),
                )
            }
            if (reading.paragraphs.isEmpty() && reading.imageUrls.isEmpty()) {
                Text(
                    "Slide ini berisi konten visual. Buka di web untuk tampilan penuh.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun QuizSceneCard(
    scene: SceneDto,
    quizState: SceneQuizState,
    questions: List<QuizQuestion>,
    onSelect: (QuizQuestion, String, Boolean) -> Unit,
    onCheck: () -> Unit,
    onReset: () -> Unit,
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
                    label = { Text("KUIS") },
                    leadingIcon = { Icon(Icons.Filled.Quiz, null, modifier = Modifier.size(16.dp)) },
                    shape = RoundedCornerShape(999.dp),
                )
                Text(
                    scene.title.ifBlank { "Kuis" },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 10.dp),
                )
            }

            questions.forEachIndexed { index, question ->
                QuestionBlock(
                    number = index + 1,
                    question = question,
                    quizState = quizState,
                    onSelect = onSelect,
                )
            }

            if (questions.isNotEmpty()) {
                if (quizState.checked) {
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.padding(top = 12.dp).fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Text(
                                "Skor: ${quizState.scoreEarned} / ${quizState.scoreTotal}",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.ExtraBold),
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                            Text(
                                "${quizState.autoGraded} soal dinilai otomatis. Soal esai tidak dinilai.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
                            )
                        }
                    }
                }
                Button(
                    onClick = if (quizState.checked) onReset else onCheck,
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    shape = RoundedCornerShape(999.dp),
                ) {
                    Text(if (quizState.checked) "Ulangi Kuis" else "Periksa Jawaban", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun QuestionBlock(
    number: Int,
    question: QuizQuestion,
    quizState: SceneQuizState,
    onSelect: (QuizQuestion, String, Boolean) -> Unit,
) {
    val selected = quizState.selected[question.id] ?: emptySet()
    val checked = quizState.checked

    Column(Modifier.padding(top = 16.dp)) {
        Row {
            Text(
                "$number.",
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold),
                modifier = Modifier.padding(end = 8.dp),
            )
            Text(question.text, style = MaterialTheme.typography.bodyLarge)
        }

        when (question.kind) {
            QuizKind.SHORT_ANSWER -> {
                Text(
                    "Soal esai — tidak dinilai otomatis.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            QuizKind.SINGLE -> {
                question.options.forEach { option ->
                    val isCorrect = checked && option.value in question.answer
                    val isPickedWrong = checked && option.value in selected && option.value !in question.answer
                    val background = when {
                        isCorrect -> Color(0xFF1B5E20).copy(alpha = 0.18f)
                        isPickedWrong -> MaterialTheme.colorScheme.error.copy(alpha = 0.15f)
                        else -> Color.Transparent
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(background)
                            .padding(horizontal = 4.dp),
                    ) {
                        RadioButton(
                            selected = option.value in selected,
                            onClick = { onSelect(question, option.value, true) },
                            enabled = !checked,
                        )
                        Text(option.label, modifier = Modifier.padding(vertical = 8.dp))
                        if (isCorrect) {
                            Icon(Icons.Filled.CheckCircle, null, tint = Color(0xFF2E7D32), modifier = Modifier.padding(start = 8.dp))
                        } else if (isPickedWrong) {
                            Icon(Icons.Filled.Cancel, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }

            QuizKind.MULTIPLE -> {
                question.options.forEach { option ->
                    val isCorrect = checked && option.value in question.answer
                    val isPickedWrong = checked && option.value in selected && option.value !in question.answer
                    val background = when {
                        isCorrect -> Color(0xFF1B5E20).copy(alpha = 0.18f)
                        isPickedWrong -> MaterialTheme.colorScheme.error.copy(alpha = 0.15f)
                        else -> Color.Transparent
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(background)
                            .padding(horizontal = 4.dp),
                    ) {
                        Checkbox(
                            checked = option.value in selected,
                            onCheckedChange = { on -> onSelect(question, option.value, on) },
                            enabled = !checked,
                        )
                        Text(option.label, modifier = Modifier.padding(vertical = 8.dp))
                        if (isCorrect) {
                            Icon(Icons.Filled.CheckCircle, null, tint = Color(0xFF2E7D32), modifier = Modifier.padding(start = 8.dp))
                        } else if (isPickedWrong) {
                            Icon(Icons.Filled.Cancel, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
            }
        }

        if (checked && !question.analysis.isNullOrBlank()) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.secondaryContainer,
                modifier = Modifier.padding(top = 6.dp).fillMaxWidth(),
            ) {
                Text(
                    "Pembahasan: ${question.analysis}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun OpenWebSceneCard(scene: SceneDto, onOpenWeb: () -> Unit) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FilterChip(
                    selected = false,
                    onClick = {},
                    label = { Text(scene.type.uppercase()) },
                    shape = RoundedCornerShape(999.dp),
                )
                Text(
                    scene.title.ifBlank { "Konten interaktif" },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
            Text(
                "Konten interaktif/proyek ini paling baik ditampilkan langsung di situs Kelas KA.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
            FilledTonalButton(
                onClick = onOpenWeb,
                modifier = Modifier.padding(top = 12.dp),
                shape = RoundedCornerShape(999.dp),
            ) {
                Icon(Icons.Filled.OpenInNew, null, modifier = Modifier.padding(end = 8.dp))
                Text("Buka di Web")
            }
        }
    }
}

private fun openInCustomTab(context: Context, url: String) {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
}
