package ai.kelaska.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.kelaska.app.ui.SceneQuizState
import ai.kelaska.app.util.QuizKind
import ai.kelaska.app.util.QuizQuestion

/** Kartu kuis interaktif; dipakai jalur daring dan offline. */
@Composable
fun QuizSceneCard(
    title: String,
    quizState: SceneQuizState,
    questions: List<QuizQuestion>,
    onSelect: (QuizQuestion, String, Boolean) -> Unit,
    onCheck: () -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
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
                    title.ifBlank { "Kuis" },
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
