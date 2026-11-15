package ai.kelaska.app.ui.components

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * Menampilkan `content.html` scene interaktif di WebView. Eksportir sudah
 * menyatukan aset (KaTeX, Three.js, gambar) sebagai `data:` URI, jadi halaman
 * ini berjalan tanpa jaringan. Navigasi keluar diblokir: paket hanya boleh
 * menampilkan kontennya sendiri, bukan membuka situs lain diam-diam.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun InteractiveContentDialog(
    title: String,
    html: String,
    onDismiss: () -> Unit,
) {
    val webViewHolder = remember { mutableStateOf<WebView?>(null) }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            title.ifBlank { "Konten interaktif" },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Filled.Close, contentDescription = "Tutup")
                        }
                    },
                )
            },
        ) { padding ->
            Column(Modifier.padding(padding).fillMaxSize()) {
                AndroidView(
                    factory = { context ->
                        WebView(context).apply {
                            webViewHolder.value = this
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            // Konten interaktif sudah di-inline eksportir. Menolak
                            // seluruh permintaan jaringan menjaga janji "tanpa
                            // internet" walau HTML mencoba memuat aset luar.
                            settings.blockNetworkLoads = true
                            settings.setSupportMultipleWindows(false)
                            settings.javaScriptCanOpenWindowsAutomatically = false
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(
                                    view: WebView,
                                    request: WebResourceRequest,
                                ): Boolean {
                                    val scheme = request.url.scheme?.lowercase()
                                    return scheme != null && scheme !in ALLOWED_SCHEMES
                                }
                            }
                            loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            webViewHolder.value?.let { view ->
                view.stopLoading()
                view.loadUrl("about:blank")
                view.destroy()
            }
            webViewHolder.value = null
        }
    }
}

private val ALLOWED_SCHEMES = setOf("about", "data", "blob")
