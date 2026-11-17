package ai.kelaska.app.ui.screens

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.List
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
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
 *
 * Tombol "Layar penuh" milik pemutar memanggil `requestFullscreen()` di
 * halaman. WebView hanya mengizinkannya bila [WebChromeClient] menyediakan
 * `onShowCustomView`/`onHideCustomView`; implementasinya ada di
 * [PlayerChromeClient] dan menaruh tampilan penuh di atas `decorView` sambil
 * menyembunyikan bilah sistem.
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

    BoxWithConstraints(modifier.fillMaxSize()) {
        // Di landscape (dan layar sangat pendek) bilah aplikasi dipadatkan
        // supaya adegan tetap mendapat tinggi yang layak; rotasi tidak lagi
        // memuat ulang WebView karena MainActivity menangani configChanges.
        val compactBar = maxWidth > maxHeight || maxHeight < 420.dp
        Column(Modifier.fillMaxSize()) {
            PlayerTopBar(
                title = course.manifest.stage.name.ifBlank { "Kelas" },
                compact = compactBar,
                onBack = onBack,
                onOpenList = onOpenList,
            )

            Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
                when {
                    loadError != null -> Column(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
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
}

/**
 * Bilah atas pemutar. Versi padat (landscape/sempit) hanya menampilkan ikon
 * daftar; versi normal menampilkan tombol berlabel.
 */
@Composable
private fun PlayerTopBar(
    title: String,
    compact: Boolean,
    onBack: () -> Unit,
    onOpenList: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(if (compact) 40.dp else 52.dp)
                    .padding(horizontal = if (compact) 2.dp else 4.dp),
            ) {
                IconButton(
                    onClick = onBack,
                    modifier = if (compact) Modifier.size(40.dp) else Modifier,
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali")
                }
                Text(
                    title,
                    style = if (compact) {
                        MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold)
                    } else {
                        MaterialTheme.typography.titleMedium
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(horizontal = 4.dp),
                )
                if (compact) {
                    IconButton(onClick = onOpenList, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Filled.List, contentDescription = "Daftar materi")
                    }
                } else {
                    FilledTonalButton(onClick = onOpenList) {
                        Icon(Icons.Filled.List, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text(" Daftar materi")
                    }
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun WebPlayer(file: File, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    var fullscreen by remember { mutableStateOf(false) }

    val webView = remember {
        WebView(context).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                // Dokumen dan seluruh medianya berada di dalam file yang sama.
                allowFileAccess = true
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                blockNetworkLoads = true
                // Narasi diputar tanpa gestur tambahan setelah tombol Putar.
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_NO_CACHE
                setGeolocationEnabled(false)
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                layoutAlgorithm = WebSettings.LayoutAlgorithm.NORMAL
                useWideViewPort = false
                loadWithOverviewMode = false
            }
            setBackgroundColor(Color.WHITE)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val scheme = request?.url?.scheme?.lowercase()
                    // Halaman hanya boleh tetap di dokumen lokal; tautan keluar
                    // (mis. "lanjutkan online") sengaja diblokir di sini.
                    return scheme !in setOf("file", "about", "data", "blob")
                }
            }
        }
    }

    val chrome = remember(webView, activity) {
        PlayerChromeClient(activity).also { client ->
            client.onFullscreenChanged = { fullscreen = it }
            webView.webChromeClient = client
        }
    }

    DisposableEffect(webView, chrome) {
        onDispose {
            chrome.exitFullscreen()
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
    }

    // Kembali dari layar penuh sebelum keluar dari halaman.
    BackHandler(enabled = fullscreen) { chrome.exitFullscreen() }

    LaunchedEffect(file.absolutePath) {
        webView.loadUrl("file://${file.absolutePath}")
    }

    AndroidView(
        factory = { webView },
        modifier = modifier.fillMaxSize(),
    )
}

/**
 * Jembatan fullscreen WebView: `requestFullscreen()` di halaman hanya berjalan
 * bila klien ini menyediakan `onShowCustomView`. Tampilan penuh dipasang di
 * atas `decorView` dan bilah sistem disembunyikan; keluar lewat tombol
 * fullscreen di halaman, gestur kembali, atau saat layar ditinggalkan.
 */
private class PlayerChromeClient(private val activity: Activity?) : WebChromeClient() {

    private var customView: View? = null
    private var callback: WebChromeClient.CustomViewCallback? = null

    /** Memberi tahu Compose bahwa mode layar penuh berubah. */
    var onFullscreenChanged: ((Boolean) -> Unit)? = null

    override fun onShowCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
        val host = activity?.window?.decorView as? ViewGroup
        if (host == null || customView != null) {
            callback.onCustomViewHidden()
            return
        }
        customView = view
        this.callback = callback
        host.addView(
            view,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        WindowInsetsControllerCompat(activity.window, host).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
        view.requestFocus()
        onFullscreenChanged?.invoke(true)
    }

    override fun onHideCustomView() {
        detach(notifyWebView = false)
    }

    /** Keluar dari layar penuh dari sisi aplikasi (tombol kembali). */
    fun exitFullscreen() {
        if (customView == null) return
        detach(notifyWebView = true)
    }

    private fun detach(notifyWebView: Boolean) {
        val view = customView ?: return
        val pending = callback
        val host = activity?.window?.decorView
        customView = null
        callback = null
        (host as? ViewGroup)?.removeView(view)
        if (host != null) {
            WindowInsetsControllerCompat(activity.window, host)
                .show(WindowInsetsCompat.Type.systemBars())
        }
        onFullscreenChanged?.invoke(false)
        if (notifyWebView) pending?.onCustomViewHidden()
    }
}

/** Activity dari context Compose, melewati wrapper tema. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
