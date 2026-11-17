package ai.kelaska.app.ui.screens

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.util.ClassWebLink

/**
 * Wizard API key (`/onboarding/api-key`) milik web, dibuka di WebView.
 *
 * Server menolak setiap halaman dan API lain untuk akun tanpa API key
 * terverifikasi (`403 API_KEY_REQUIRED` di API, redirect di halaman), jadi
 * aplikasi memakai halaman web yang sama alih-alih membuat formulir native
 * yang harus meniru aturan verifikasi model yang terus berubah.
 *
 * Layar ini ditutup dengan tombol kembali ke daftar kursus; pemanggil memuat
 * ulang data karena gate membaca status verifikasi terbaru.
 */
@Composable
fun ApiKeyOnboardingScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val url = remember { ClassWebLink.apiKeyOnboardingUrl(BuildConfig.BASE_URL) }
    OnlineWebViewScreen(
        url = url,
        title = "API key akun",
        onBack = onBack,
        modifier = modifier,
        // Kembali selalu menutup layar: riwayat wizard tidak berguna dan
        // menahan pengguna di halaman yang sama setelah key tersimpan.
        backNavigatesHistory = false,
    )
}
