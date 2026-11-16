package ai.kelaska.app.ui.screens

import android.graphics.Color
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.List
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import android.view.ViewGroup
import ai.kelaska.app.data.offline.OfflineCourse
import ai.kelaska.app.data.offline.StandalonePlayerHtml
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Memutar kelas memakai bundle pemutar yang persis sama dengan versi web.
 * Dokumen HTML yang dimuat adalah hasil [StandalonePlayerHtml.build] dari
 * paket `.maic.zip` — slide, kuis, narasi, efek, dan diskusi dirender oleh
 * kode React yang sama dengan yang dipakai kelaska.riau.ai. Tidak ada
 * permintaan jaringan: semua gambar dan media sudah berupa `data:` URI/blok
 * base64 di dalam dokumen, dan WebView memblokir semua muatan jaringan.
 */
@Composable
fun ClassPlayerScreen(
    course: OfflineCourse,
    onBack: () -> Unit,
    onOpenList: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var loadError by remember(course.meta.id) { mutableStateOf<String?>(null) }

    val htmlFile by produceState<File?>(initialValue = null, course.meta.id) {
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val assets = StandalonePlayerHtml.PlayerAssets(
                    script = context.assets.open("player/player.min.js").bufferedReader().use { it.readText() },
                    style = context.assets.open("player/player.min.css").bufferedReader().use { it.readText() },
                    mathFonts = context.assets.open("player/katex-fonts.min.css").bufferedReader().use { it.readText() },
                    chartsScript = context.assets.open("player/player-charts.min.js").bufferedReader().use { it.readText() },
                )
                val html = StandalonePlayerHtml.build(course, assets)
                val dir = File(context.filesDir, "player").apply { mkdirs() }
                val file = File(dir, "${course.meta.id}.html")
                file.writeText(html)
                file
            }
        }
        value = result.onFailure { error ->
            loadError = error.message ?: "HTML pemutar gagal disusun"
        }.getOrNull()
    }

    Column(modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali")
            }
            Text(
                course.manifest.stage.name.ifBlank { "Kelas" },
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            FilledTonalButton(onClick = onOpenList) {
                Icon(Icons.Filled.List, contentDescription = null)
                Text(" Daftar materi")
            }
        }

        Box(modifier = Modifier.fillMaxSize().weight(1f)) {
            when {
                loadError != null -> Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                ) {
                    Text(
                        "Kelas tidak bisa diputar",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        loadError.orEmpty(),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    FilledTonalButton(onClick = onOpenList, modifier = Modifier.padding(top = 16.dp)) {
                        Text("Buka daftar materi")
                    }
                }

                htmlFile == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }

                else -> WebPlayer(file = htmlFile!!)
            }
        }
    }
}

@Composable
private fun WebPlayer(file: File, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val webView = remember { WebView(context) }

    LaunchedEffect(webView) {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Dokumen dan seluruh medianya berada di dalam file yang sama.
            allowFileAccess = true
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            blockNetworkLoads = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            setGeolocationEnabled(false)
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            layoutAlgorithm = WebSettings.LayoutAlgorithm.NORMAL
        }
        webView.setBackgroundColor(Color.WHITE)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val scheme = request?.url?.scheme?.lowercase()
                // Halaman hanya boleh tetap di dokumen lokal; tautan keluar
                // (mis. "lanjutkan online") sengaja diblokir di sini.
                return scheme !in setOf("file", "about", "data", "blob")
            }
        }
        webView.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
    }

    DisposableEffect(webView) {
        onDispose {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
    }

    LaunchedEffect(file.absolutePath) {
        webView.loadUrl("file://${file.absolutePath}")
    }

    androidx.compose.ui.viewinterop.AndroidView(
        factory = { webView },
        modifier = modifier.fillMaxSize(),
    )
}
