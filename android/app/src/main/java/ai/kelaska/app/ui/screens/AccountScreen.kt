package ai.kelaska.app.ui.screens

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.data.CachedProfile
import ai.kelaska.app.ui.BrandGradient
import ai.kelaska.app.ui.GovernmentLogos

@Composable
fun AccountScreen(
    profile: CachedProfile,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var showAbout by remember { mutableStateOf(false) }
    var showSignOutConfirm by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        /* -------------------------------------------------- Avatar */
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(BrandGradient),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initials(profile.name),
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                color = Color.White,
            )
        }
        Text(
            profile.name,
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
            modifier = Modifier.padding(top = 16.dp),
        )
        Text(
            profile.email,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Surface(
            shape = RoundedCornerShape(999.dp),
            color = MaterialTheme.colorScheme.secondaryContainer,
            modifier = Modifier.padding(top = 10.dp),
        ) {
            Text(
                roleLabel(profile.role),
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }

        /* -------------------------------------------------- Aksi */
        Card(
            shape = RoundedCornerShape(22.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 26.dp),
        ) {
            Column(Modifier.padding(6.dp)) {
                AccountAction(
                    icon = { Icon(Icons.Filled.OpenInNew, null) },
                    title = "Buka kelaska.riau.ai",
                    subtitle = "Situs web Kelas KA di browser",
                    onClick = { openCustomTab(context, BuildConfig.BASE_URL) },
                )
                HorizontalDivider(modifier = Modifier.padding(horizontal = 12.dp))
                AccountAction(
                    icon = { Icon(Icons.Filled.Info, null) },
                    title = "Tentang Aplikasi",
                    subtitle = "Versi dan informasi lembaga",
                    onClick = { showAbout = true },
                )
                HorizontalDivider(modifier = Modifier.padding(horizontal = 12.dp))
                AccountAction(
                    icon = { Icon(Icons.Filled.Logout, null, tint = MaterialTheme.colorScheme.error) },
                    title = "Keluar",
                    titleColor = MaterialTheme.colorScheme.error,
                    subtitle = "Akhiri sesi di perangkat ini",
                    onClick = { showSignOutConfirm = true },
                )
            }
        }

        GovernmentLogos(logoHeight = 40, modifier = Modifier.padding(top = 28.dp))
        Text(
            "Kelas Kecerdasan Artifisial",
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 10.dp),
        )
        Text(
            "versi ${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
    }

    if (showAbout) {
        AlertDialog(
            onDismissRequest = { showAbout = false },
            title = { Text("Tentang Kelas KA") },
            text = {
                Column {
                    Text(
                        "Kelas Kecerdasan Artifisial adalah ruang kelas interaktif berbasis AI: materi, kuis, dan diskusi dibuat otomatis dan disajikan dalam Bahasa Indonesia.",
                    )
                    HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
                    Text("Diselenggarakan oleh Kemendikdasmen dan DPRD.", style = MaterialTheme.typography.bodyMedium)
                    Text("kelaska.riau.ai", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
                    Text("Versi aplikasi ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 10.dp))
                }
            },
            confirmButton = { TextButton(onClick = { showAbout = false }) { Text("Tutup") } },
        )
    }

    if (showSignOutConfirm) {
        AlertDialog(
            onDismissRequest = { showSignOutConfirm = false },
            title = { Text("Keluar?") },
            text = { Text("Sesi di perangkat ini akan dihapus. Anda perlu masuk lagi dengan Google.") },
            confirmButton = {
                TextButton(onClick = {
                    showSignOutConfirm = false
                    onSignOut()
                }) {
                    Text("Keluar", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { showSignOutConfirm = false }) { Text("Batal") } },
        )
    }
}

@Composable
private fun AccountAction(
    icon: @Composable () -> Unit,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    titleColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon()
        Column(Modifier.padding(start = 14.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, color = titleColor)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun initials(name: String): String =
    name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar()?.toString() }.joinToString("").ifEmpty { "?" }

private fun roleLabel(role: String): String = when (role) {
    "admin" -> "Administrator"
    "teacher" -> "Pengajar"
    else -> "Siswa"
}

private fun openCustomTab(context: Context, url: String) {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
}
