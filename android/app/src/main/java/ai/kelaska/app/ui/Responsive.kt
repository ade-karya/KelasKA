package ai.kelaska.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Lebar baca nyaman untuk konten daftar/detail di tablet dan landscape. */
val CONTENT_MAX_WIDTH: Dp = 840.dp

/**
 * Menengahkan konten pada lebar maksimum [maxWidth]. Di ponsel (portrait
 * maupun landscape) konten tetap memenuhi lebar layar; di tablet atau jendela
 * lebar, baris teks dan kartu tidak lagi melar mengikuti seluruh layar.
 */
@Composable
fun CenteredContent(
    modifier: Modifier = Modifier,
    maxWidth: Dp = CONTENT_MAX_WIDTH,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Box(
            modifier = Modifier.widthIn(max = maxWidth).fillMaxSize(),
            contentAlignment = Alignment.TopStart,
            content = content,
        )
    }
}
