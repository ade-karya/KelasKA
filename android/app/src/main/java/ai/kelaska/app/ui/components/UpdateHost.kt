package ai.kelaska.app.ui.components

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.data.update.UpdateInstaller
import ai.kelaska.app.ui.UpdateState
import ai.kelaska.app.ui.UpdateViewModel
import java.io.File
import kotlin.math.roundToInt

/**
 * Versi yang menerima ViewModel dari [ai.kelaska.app.ui.KelasKaApp]. Dialog
 * pembaruan dirender di atas seluruh layar supaya muncul di mana pun pengguna
 * berada, termasuk sebelum masuk akun.
 */
@Composable
fun UpdateHost(
    viewModel: UpdateViewModel,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val installer = remember(context) { UpdateInstaller(context.applicationContext) }
    var pendingInstall by remember { mutableStateOf<File?>(null) }

    // Kembali dari Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES: izin dicek lagi,
    // lalu pemasangan dilanjutkan tanpa pengguna harus menekan tombol ulang.
    val settingsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        val file = pendingInstall ?: return@rememberLauncherForActivityResult
        pendingInstall = null
        if (installer.canRequestPackageInstalls()) {
            launchInstaller(
                context = context,
                installer = installer,
                file = file,
                onLaunched = viewModel::onInstallLaunched,
                onError = viewModel::reportError,
            )
        } else {
            viewModel.reportError(
                "Izin pemasangan belum aktif. Aktifkan “Izinkan dari sumber ini”, lalu coba lagi.",
            )
        }
    }

    val requestInstall: (File) -> Unit = { file ->
        if (installer.canRequestPackageInstalls()) {
            launchInstaller(
                context = context,
                installer = installer,
                file = file,
                onLaunched = viewModel::onInstallLaunched,
                onError = viewModel::reportError,
            )
        } else {
            pendingInstall = file
            try {
                settingsLauncher.launch(installer.unknownSourcesSettingsIntent())
            } catch (error: Exception) {
                pendingInstall = null
                viewModel.reportError(
                    "Pengaturan izin pemasangan tidak bisa dibuka. Aktifkan izin “Pasang aplikasi tak dikenal” secara manual.",
                )
            }
        }
    }

    Box(modifier.fillMaxSize()) {
        content()

        when (val current = state) {
            is UpdateState.Idle -> Unit

            is UpdateState.Checking -> AlertDialog(
                onDismissRequest = {},
                title = { Text("Memeriksa pembaruan") },
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        Text(
                            "Menghubungi GitHub Releases…",
                            modifier = Modifier.padding(start = 14.dp),
                        )
                    }
                },
                confirmButton = {},
            )

            is UpdateState.Available -> AlertDialog(
                onDismissRequest = viewModel::dismiss,
                title = { Text("Pembaruan tersedia") },
                text = {
                    Column {
                        Text(
                            "Versi ${current.release.version} sudah tersedia. Versi terpasang ${BuildConfig.VERSION_NAME}.",
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            current.release.notes.ifBlank { "Tidak ada catatan rilis." },
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier
                                .heightIn(max = 240.dp)
                                .verticalScroll(rememberScrollState()),
                        )
                    }
                },
                confirmButton = {
                    Button(onClick = viewModel::download) { Text("Update") }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::dismiss) { Text("Nanti") }
                },
            )

            is UpdateState.Downloading -> AlertDialog(
                onDismissRequest = {},
                title = { Text("Mengunduh pembaruan") },
                text = {
                    Column {
                        if (current.indeterminate) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                        } else {
                            LinearProgressIndicator(
                                progress = { current.progress },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Text(
                            if (current.indeterminate) {
                                "Menyiapkan unduhan…"
                            } else {
                                "${(current.progress * 100).roundToInt()}% terunduh"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                        Text(
                            "APK akan diverifikasi dengan SHA-256 sebelum dipasang.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = viewModel::cancelDownload) { Text("Batal") }
                },
            )

            is UpdateState.ReadyToInstall -> AlertDialog(
                onDismissRequest = viewModel::dismiss,
                title = { Text("Siap dipasang") },
                text = {
                    Text(
                        "Pembaruan sudah diunduh dan SHA-256 cocok. Tekan “Pasang” lalu setujui pemasangan di dialog sistem.",
                    )
                },
                confirmButton = {
                    Button(onClick = { requestInstall(current.file) }) { Text("Pasang") }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::dismiss) { Text("Nanti") }
                },
            )

            is UpdateState.UpToDate -> AlertDialog(
                onDismissRequest = viewModel::dismiss,
                title = { Text("Aplikasi sudah terbaru") },
                text = {
                    Text("Versi terpasang ${current.installedVersion} adalah versi terbaru yang dirilis.")
                },
                confirmButton = {
                    TextButton(onClick = viewModel::dismiss) { Text("Tutup") }
                },
            )

            is UpdateState.Error -> AlertDialog(
                onDismissRequest = viewModel::dismiss,
                title = { Text("Pembaruan gagal") },
                text = { Text(current.message) },
                confirmButton = {
                    TextButton(onClick = viewModel::checkManually) { Text("Coba lagi") }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::dismiss) { Text("Tutup") }
                },
            )
        }
    }
}

private fun launchInstaller(
    context: Context,
    installer: UpdateInstaller,
    file: File,
    onLaunched: () -> Unit,
    onError: (String) -> Unit,
) {
    if (installer.install(file)) {
        onLaunched()
    } else {
        onError("Pemasang aplikasi tidak tersedia atau berkas unduhan hilang. Coba unduh ulang pembaruan.")
    }
}
