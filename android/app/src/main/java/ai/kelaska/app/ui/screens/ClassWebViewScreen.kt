package ai.kelaska.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.util.ClassWebLink
import ai.kelaska.app.util.openInCustomTab

/**
 * Kelas daring ditampilkan dengan WebView memakai halaman web yang SAMA dengan
 * desktop (`/classroom/<id>`), bukan pemutar native yang terpotong fiturnya.
 * Karena viewport web memakai `width=device-width`, WebView dengan UA ponsel
 * otomatis mendapat tampilan mobile — tidak ada parameter "mobile" khusus.
 *
 * Bila server mengalihkan halaman kelas ke wizard API key (akun belum punya
 * key terverifikasi), layar menampilkan spanduk supaya pengguna bisa membuka
 * wizard dari aplikasi, bukan tertahan di halaman kelas yang kosong.
 */
@Composable
fun ClassWebViewScreen(
    stageId: String,
    onBack: () -> Unit,
    onOpenDetail: () -> Unit,
    onConnectApiKey: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val classUrl = remember(stageId) { ClassWebLink.classroomUrl(BuildConfig.BASE_URL, stageId) }
    var apiKeyRequired by remember(stageId) { mutableStateOf(false) }

    OnlineWebViewScreen(
        url = classUrl,
        title = "Kelas KA",
        onBack = onBack,
        modifier = modifier,
        actions = {
            IconButton(onClick = onOpenDetail) {
                Icon(Icons.Filled.Info, contentDescription = "Detail kursus")
            }
            IconButton(onClick = { openInCustomTab(context, classUrl) }) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Buka di browser")
            }
        },
        banner = if (apiKeyRequired) {
            {
                ApiKeyRequiredBanner(onConnectApiKey = onConnectApiKey)
            }
        } else {
            null
        },
        onPageFinished = { loadedUrl ->
            apiKeyRequired = ClassWebLink.isApiKeyOnboardingUrl(loadedUrl)
        },
    )
}

@Composable
private fun ApiKeyRequiredBanner(onConnectApiKey: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.primaryContainer,
    ) {
        Row(
            modifier = Modifier.padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Filled.Key,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(22.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    "Kelas ini memerlukan API key",
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    "Hubungkan API key akun ini agar kelas bisa dimuat.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onConnectApiKey) { Text("Hubungkan") }
        }
    }
}
