package ai.kelaska.app.ui.screens

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.data.SceneContent
import ai.kelaska.app.data.SceneDto
import ai.kelaska.app.ui.CenteredContent
import ai.kelaska.app.ui.CourseDetailUiState
import ai.kelaska.app.ui.CourseDetailViewModel
import ai.kelaska.app.ui.SceneQuizState
import ai.kelaska.app.ui.components.QuizSceneCard
import ai.kelaska.app.ui.components.SlideSceneCard
import ai.kelaska.app.util.IndonesianDate

@Composable
fun CourseDetailScreen(
    viewModel: CourseDetailViewModel,
    onBack: () -> Unit,
    onOpenClass: (String) -> Unit,
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
            onOpenClass = onOpenClass,
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
    onOpenClass: (String) -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val doc = state.document!!
    val slides = doc.scenes.count { it.type == "slide" }
    val quizCount = doc.scenes.count { it.type == "quiz" }

    CenteredContent(modifier = modifier) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali") }
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

        item {
            // Kelas dibuka di WebView memakai halaman web yang sama dengan
            // situs (tampilan mobile), bukan pemutar native yang terbatas.
            FilledTonalButton(
                onClick = { onOpenClass(doc.stage.id) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(999.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, null, modifier = Modifier.padding(end = 8.dp))
                Text("Buka Kelas (tampilan web)")
            }
        }

        items(doc.scenes.sortedBy { it.order }, key = { it.id }) { scene ->
            when (scene.type) {
                "slide" -> {
                    val reading = remember(scene.id) { SceneContent.parseSlide(scene.content) }
                    SlideSceneCard(title = scene.title, reading = reading)
                }
                "quiz" -> QuizSceneCard(
                    title = scene.title,
                    quizState = quizzes[scene.id] ?: SceneQuizState(),
                    questions = viewModel.questionsOf(scene),
                    onSelect = { question, value, checked -> viewModel.selectOption(scene, question, value, checked) },
                    onCheck = { viewModel.checkAnswers(scene) },
                    onReset = { viewModel.resetQuiz(scene.id) },
                )
                else -> OpenWebSceneCard(
                    scene = scene,
                    onOpenWeb = { onOpenClass(doc.stage.id) },
                )
            }
        }

        item {
            OutlinedButton(
                onClick = { openInCustomTab(context, "${BuildConfig.BASE_URL}/classroom/${doc.stage.id}") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(999.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                Text("Buka kelas di browser")
            }
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
                Icon(Icons.AutoMirrored.Filled.OpenInNew, null, modifier = Modifier.padding(end = 8.dp))
                Text("Buka di Web")
            }
        }
    }
}

private fun openInCustomTab(context: Context, url: String) {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
}
