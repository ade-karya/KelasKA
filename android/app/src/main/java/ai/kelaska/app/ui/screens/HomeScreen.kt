package ai.kelaska.app.ui.screens

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.ui.BrandGradient
import ai.kelaska.app.ui.CoursesUiState
import ai.kelaska.app.ui.CenteredContent
import ai.kelaska.app.ui.GovernmentLogos

@Composable
fun HomeScreen(
    courses: CoursesUiState,
    onOpenCourses: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val totalScenes = courses.stages.sumOf { it.sceneCount }

    CenteredContent(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 20.dp),
        ) {
        /* ---------------------------------------------- Hero gradien */
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(BrandGradient)
                .padding(24.dp),
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                GovernmentLogos(logoHeight = 56, modifier = Modifier.fillMaxWidth())
                Text(
                    text = "Kelas Kecerdasan Artifisial",
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                    color = androidx.compose.ui.graphics.Color.White,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 20.dp, bottom = 6.dp),
                )
                Text(
                    text = "Ruang kelas interaktif yang dirancang AI — materi, kuis, dan diskusi dalam Bahasa Indonesia.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = androidx.compose.ui.graphics.Color(0xFFE7E4FF),
                    textAlign = TextAlign.Center,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.padding(top = 18.dp),
                ) {
                    Button(
                        onClick = onOpenCourses,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = androidx.compose.ui.graphics.Color.White,
                            contentColor = androidx.compose.ui.graphics.Color(0xFF3730A3),
                        ),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text("Lihat Kursus Saya", fontWeight = FontWeight.Bold)
                    }
                    Button(
                        onClick = { openCustomTab(context, BuildConfig.BASE_URL) },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = androidx.compose.ui.graphics.Color(0x33FFFFFF),
                            contentColor = androidx.compose.ui.graphics.Color.White,
                        ),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text("Buka Situs", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        /* -------------------------------------------------- Statistik */
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = "Kursus saya",
                value = courses.stages.size.toString(),
                loading = courses.loading,
                error = courses.error != null,
                onRetry = onRetry,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = "Materi tersedia",
                value = totalScenes.toString(),
                loading = courses.loading,
                error = courses.error != null,
                onRetry = onRetry,
            )
        }
        if (courses.error != null) {
            Text(
                text = "Sebagian data gagal dimuat. Periksa koneksi Anda.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        /* --------------------------------------------------- Fitur */
        Text(
            text = "Kenapa Kelas KA?",
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.padding(top = 26.dp, bottom = 12.dp),
        )
        FeatureRow(
            icon = { androidx.compose.material3.Icon(Icons.Filled.AutoAwesome, null, tint = androidx.compose.ui.graphics.Color.White) },
            title = "Kursus hasil AI",
            body = "Brief singkat menjadi materi, kuis, dan diskusi terstruktur secara otomatis.",
        )
        FeatureRow(
            icon = { androidx.compose.material3.Icon(Icons.Filled.Quiz, null, tint = androidx.compose.ui.graphics.Color.White) },
            title = "Kuis interaktif",
            body = "Latihan langsung di aplikasi dengan penilaian otomatis dan pembahasan.",
        )
        FeatureRow(
            icon = { androidx.compose.material3.Icon(Icons.Filled.Translate, null, tint = androidx.compose.ui.graphics.Color.White) },
            title = "Bahasa Indonesia",
            body = "Narasi, antarmuka, dan materi sepenuhnya dalam Bahasa Indonesia.",
        )

        HorizontalDivider(modifier = Modifier.padding(vertical = 18.dp))
        Text(
            text = "Kemendikdasmen · DPRD RI · kelaska.riau.ai",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun StatCard(
    modifier: Modifier,
    label: String,
    value: String,
    loading: Boolean,
    error: Boolean,
    onRetry: () -> Unit,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.padding(18.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (loading) {
                CircularProgressIndicator(Modifier.size(26.dp).padding(top = 8.dp), strokeWidth = 2.dp)
            } else if (error) {
                Text(
                    "—",
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                    modifier = Modifier.clickable(onClickLabel = "Coba lagi", onClick = onRetry),
                )
            } else {
                Text(
                    value,
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                )
            }
        }
    }
}

@Composable
private fun FeatureRow(
    icon: @Composable () -> Unit,
    title: String,
    body: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(16.dp))
                .background(BrandGradient)
                .padding(14.dp),
        ) {
            icon()
        }
        Column(Modifier.padding(start = 16.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold))
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

private fun openCustomTab(context: Context, url: String) {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
}
