package ai.kelaska.app.ui.screens

import androidx.browser.customtabs.CustomTabsIntent
import android.content.Context
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.Image
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ai.kelaska.app.R
import ai.kelaska.app.ui.BrandGradient
import ai.kelaska.app.ui.GovernmentLogos

/** Layar masuk: brand + satu tombol Google; alurnya dibuka di browser (Custom Tab). */
@Composable
fun LoginScreen(
    loading: Boolean,
    error: String?,
    pendingApproval: Boolean,
    onSignIn: () -> String,
    modifier: Modifier = Modifier,
    onOpenOffline: () -> Unit = {},
) {
    val context = LocalContext.current
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(BrandGradient),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            GovernmentLogos(logoHeight = 72)

            Text(
                text = "Kelas Kecerdasan Artifisial",
                style = MaterialTheme.typography.headlineLarge.copy(fontWeight = FontWeight.ExtraBold),
                color = androidx.compose.ui.graphics.Color.White,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 28.dp),
            )
            Text(
                text = "Orkestrasi AI cerdas untuk ruang kelas yang menyenangkan.",
                style = MaterialTheme.typography.bodyLarge,
                color = androidx.compose.ui.graphics.Color(0xFFE4E1FF),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp, bottom = 36.dp),
            )

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 440.dp)
                    .clip(RoundedCornerShape(28.dp)),
                shape = RoundedCornerShape(28.dp),
                colors = androidx.compose.material3.CardDefaults.cardColors(
                    containerColor = androidx.compose.ui.graphics.Color(0xF2FFFFFF),
                ),
            ) {
                Column(
                    modifier = Modifier.padding(28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (pendingApproval) {
                        PendingApprovalContent()
                    } else {
                        GoogleButton(
                            loading = loading,
                            onClick = {
                                val url = onSignIn()
                                launchCustomTab(context, url)
                            },
                        )
                        if (error != null) {
                            Text(
                                text = error,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(top = 14.dp),
                            )
                        }
                        Text(
                            text = "Dengan masuk, Anda menyetujui Ketentuan dan Kebijakan Privasi Kelas KA.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 18.dp),
                        )
                    }
                }
            }

            TextButton(
                onClick = onOpenOffline,
                modifier = Modifier.padding(top = 18.dp),
                colors = ButtonDefaults.textButtonColors(
                    contentColor = androidx.compose.ui.graphics.Color.White,
                ),
            ) {
                Icon(Icons.Filled.CloudOff, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                Text("Buka Perpustakaan Offline", fontWeight = FontWeight.SemiBold)
            }
            Text(
                "Impor berkas .maic.zip dan belajar tanpa internet — tanpa perlu masuk.",
                style = MaterialTheme.typography.labelSmall,
                color = androidx.compose.ui.graphics.Color(0xFFCFCBF5),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

@Composable
private fun GoogleButton(loading: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = !loading,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        shape = RoundedCornerShape(999.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = androidx.compose.ui.graphics.Color.White,
            contentColor = androidx.compose.ui.graphics.Color(0xFF1F1F29),
        ),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 4.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier
                    .padding(end = 12.dp)
                    .height(20.dp)
                    .widthIn(min = 20.dp),
                strokeWidth = 2.dp,
                color = androidx.compose.ui.graphics.Color(0xFF4F46E5),
            )
            Text("Memproses…", fontWeight = FontWeight.SemiBold)
        } else {
            Image(
                painter = painterResource(R.drawable.ic_google_g),
                contentDescription = null,
                modifier = Modifier
                    .padding(end = 12.dp)
                    .fillMaxWidth(0.085f),
            )
            Text(
                "Masuk dengan Google",
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun PendingApprovalContent() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(MaterialTheme.colorScheme.primaryContainer)
                .padding(18.dp),
        ) {
            androidx.compose.material3.Icon(
                imageVector = Icons.Filled.Schedule,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier
                    .height(40.dp)
                    .widthIn(min = 40.dp),
            )
        }
        Text(
            "Akun menunggu persetujuan",
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.padding(top = 16.dp),
        )
        Text(
            "Akun Anda sudah terdaftar. Admin akan menyetujuinya — setelah disetujui, Anda bisa masuk.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

private fun launchCustomTab(context: Context, url: String) {
    CustomTabsIntent.Builder()
        .setShowTitle(true)
        .build()
        .launchUrl(context, Uri.parse(url))
}
