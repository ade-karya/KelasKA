package ai.kelaska.app.ui.components

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ai.kelaska.app.data.SlideReading
import coil.compose.AsyncImage
import java.io.File

/**
 * Kartu satu slide. Dipakai layar kursus daring (URL gambar) dan pemutar
 * offline (path berkas lokal); nilai non-http dianggap path berkas.
 */
@Composable
fun SlideSceneCard(
    title: String,
    reading: SlideReading,
    modifier: Modifier = Modifier,
    emptyHint: String = "Slide ini berisi konten visual. Buka di web untuk tampilan penuh.",
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
                    label = { Text("MATERI") },
                    shape = RoundedCornerShape(999.dp),
                )
                Text(
                    title.ifBlank { "Materi" },
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
            reading.imageUrls.forEach { path ->
                AsyncImage(
                    model = mediaModel(path),
                    contentDescription = null,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp)
                        .height(180.dp)
                        .clip(RoundedCornerShape(14.dp)),
                )
            }
            reading.videoPaths.forEach { path ->
                SlideVideo(path, Modifier.padding(top = 12.dp))
            }
            reading.audioPaths.forEach { path ->
                AudioPlayButton(
                    path = path,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            if (reading.paragraphs.isEmpty() && reading.imageUrls.isEmpty() &&
                reading.videoPaths.isEmpty() && reading.audioPaths.isEmpty()
            ) {
                Text(
                    emptyHint,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
        }
    }
}

private fun mediaModel(value: String): Any =
    if (value.startsWith("http://") || value.startsWith("https://")) value else File(value)

/** URL jaringan diputar sebagai URI; nilai lain adalah path berkas lokal. */
private fun mediaUri(path: String): Uri =
    if (path.startsWith("http://") || path.startsWith("https://")) Uri.parse(path) else Uri.fromFile(File(path))

@Composable
private fun SlideVideo(path: String, modifier: Modifier = Modifier) {
    AndroidView(
        factory = { context ->
            VideoView(context).apply {
                setVideoURI(mediaUri(path))
                val controller = MediaController(context)
                controller.setAnchorView(this)
                setMediaController(controller)
                setOnPreparedListener { player -> player.isLooping = true }
            }
        },
        modifier = modifier
            .fillMaxWidth()
            .height(200.dp)
            .clip(RoundedCornerShape(14.dp)),
    )
}

/** Tombol putar audio lokal dengan MediaPlayer yang dilepas saat keluar layar. */
@Composable
fun AudioPlayButton(
    path: String,
    modifier: Modifier = Modifier,
    label: String = "Putar audio",
) {
    val context = LocalContext.current
    var playing by remember(path) { mutableStateOf(false) }
    val player = remember(path) {
        runCatching { android.media.MediaPlayer.create(context, mediaUri(path)) }.getOrNull()
    }
    DisposableEffect(player) {
        onDispose { runCatching { player?.release() } }
    }
    if (player == null) {
        Text(
            "Audio tidak dapat diputar.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.error,
            modifier = modifier,
        )
        return
    }
    player.setOnCompletionListener { playing = false }
    FilledTonalButton(
        onClick = {
            if (player.isPlaying) {
                player.pause()
                playing = false
            } else {
                player.start()
                playing = true
            }
        },
        modifier = modifier,
        shape = RoundedCornerShape(999.dp),
    ) {
        Icon(
            if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
            contentDescription = null,
            modifier = Modifier.size(18.dp).padding(end = 4.dp),
        )
        Text(label, fontWeight = FontWeight.SemiBold)
    }
}
