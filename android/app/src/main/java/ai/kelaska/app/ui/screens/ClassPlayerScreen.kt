package ai.kelaska.app.ui.screens

import android.annotation.SuppressLint
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
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import ai.kelaska.app.data.offline.OfflineCourse
import ai.kelaska.app.data.offline.StandalonePlayerHtml
import ai.kelaska.app.ui.player.PlayerHostBridge
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
 * Tombol "Layar penuh" milik pemutar memakai jembatan `window.KelasKaHost`
 * (lihat [PlayerHostBridge]): mode layar penuh dipegang Compose, sehingga
 * berputar dari portrait ke landscape tidak melepasnya seperti custom view
 * WebView. [PlayerChromeClient] tetap menjadi cadangan untuk fullscreen HTML
 * lain (mis. konten interaktif).
 */
@Composable
fun ClassPlayerScreen(
    course: OfflineCourse,
    onBack: () -> Unit,
    onOpenList: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val configuration = LocalConfiguration.current
    var loadError by remember(course.meta.id) { mutableStateOf<String?>(null) }
    // Layar penuh milik aplikasi: bilah atas dan bilah sistem disembunyikan.
    var fullscreen by remember(course.meta.id) { mutableStateOf(false) }

    var htmlFile by remember(course.meta.id) { mutableStateOf<File?>(null) }
    LaunchedEffect(course.meta.id) {
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
        result.onFailure { error ->
            loadError = error.message ?: "HTML pemutar gagal disusun"
        }
        htmlFile = result.getOrNull()
    }
    // Bilah sistem disembunyikan selama layar penuh. Efeknya diulang saat
    // konfigurasi berubah: controller insets dapat kembali menampilkan bilah
    // setelah rotasi, dan itulah yang dulu membuat layar penuh "keluar".
    LaunchedEffect(fullscreen, configuration, activity) {
        val window = activity?.window ?: return@LaunchedEffect
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (fullscreen) {
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    // Meninggalkan halaman saat layar penuh tidak boleh menyisakan bilah
    // sistem yang tetap tersembunyi.
    DisposableEffect(activity) {
        onDispose {
            val window = activity?.window ?: return@onDispose
            WindowInsetsControllerCompat(window, window.decorView)
                .show(WindowInsetsCompat.Type.systemBars())
        }
    }

    // Kembali dari layar penuh dulu, baru keluar dari halaman.
    BackHandler(enabled = fullscreen) { fullscreen = false }

    BoxWithConstraints(modifier.fillMaxSize()) {
        // Di landscape (dan layar sangat pendek) bilah aplikasi dipadatkan
        // supaya adegan tetap mendapat tinggi yang layak; rotasi tidak lagi
        // memuat ulang WebView karena MainActivity menangani configChanges.
        val compactBar = maxWidth > maxHeight || maxHeight < 420.dp
        Column(Modifier.fillMaxSize()) {
            if (!fullscreen) {
                PlayerTopBar(
                    title = course.manifest.stage.name.ifBlank { "Kelas" },
                    compact = compactBar,
                    onBack = onBack,
                    onOpenList = onOpenList,
                )
            }

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

                    else -> WebPlayer(
                        file = htmlFile!!,
                        fullscreen = fullscreen,
                        onFullscreenChanged = { fullscreen = it },
                    )
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
                        Icon(Icons.AutoMirrored.Filled.List, contentDescription = "Daftar materi")
                    }
                } else {
                    FilledTonalButton(onClick = onOpenList) {
                        Icon(Icons.AutoMirrored.Filled.List, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text(" Daftar materi")
                    }
                }
            }
            HorizontalDivider()
        }
    }
}

/**
 * Dokumen pemutar dijalankan dengan JavaScript aktif, tetapi seluruh media dan
 * skripnya sudah ditanam di dalam berkas lokal: `blockNetworkLoads` aktif
 * sehingga dokumen tidak dapat memuat jaringan, dan navigasi dibatasi ke
 * `file`/`about`/`data`/`blob`. Karena itu risiko XSS yang diperingatkan lint
 * di sini sudah disengaja dan dibatasi.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun WebPlayer(
    file: File,
    fullscreen: Boolean,
    onFullscreenChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val latestOnFullscreenChanged = rememberUpdatedState(onFullscreenChanged)
    var webFullscreen by remember { mutableStateOf(false) }

    val webView = remember {
        WebView(context).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                // Dokumen dan seluruh medianya berada di dalam file yang sama.
                // allowFileAccessFromFileURLs/allowUniversalAccessFromFileURLs
                // sudah default false sejak minSdk 26: dokumen tidak boleh
                // membaca berkas lain atau jaringan dari konteks file://.
                allowFileAccess = true
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

    // Jembatan harus terpasang sebelum dokumen dimuat, supaya tombol layar
    // penuh dan narasi TTS dari halaman langsung menemukannya.
    val bridge = remember(webView) {
        PlayerHostBridge(context, webView) { latestOnFullscreenChanged.value(it) }
            .also { webView.addJavascriptInterface(it, PlayerHostBridge.JS_NAME) }
    }

    val chrome = remember(webView, activity) {
        PlayerChromeClient(activity).also { client ->
            client.onFullscreenChanged = { webFullscreen = it }
            webView.webChromeClient = client
        }
    }

    DisposableEffect(webView, bridge, chrome) {
        onDispose {
            chrome.exitFullscreen()
            webView.removeJavascriptInterface(PlayerHostBridge.JS_NAME)
            bridge.release()
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
    }

    // Aplikasi juga bisa keluar dari layar penuh sendiri (tombol kembali);
    // beri tahu halaman supaya ikon tombolnya ikut berubah.
    LaunchedEffect(fullscreen) {
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('kelaska:fullscreen',{detail:$fullscreen}))",
            null,
        )
    }

    // Cadangan fullscreen HTML (mis. konten interaktif): kembali darinya
    // sebelum keluar dari halaman.
    BackHandler(enabled = webFullscreen) { chrome.exitFullscreen() }

    LaunchedEffect(file.absolutePath) {
        webView.loadUrl("file://${file.absolutePath}")
    }

    AndroidView(
        factory = { webView },
        modifier = modifier.fillMaxSize(),
    )
}

/**
 * Cadangan fullscreen HTML: konten interaktif (atau video) yang memanggil
 * `requestFullscreen()` tetap butuh `onShowCustomView`. Tampilan penuh
 * dipasang di atas `decorView` dan bilah sistem disembunyikan; keluar lewat
 * halaman, gestur kembali, atau saat layar ditinggalkan.
 *
 * Tombol "Layar penuh" milik pemutar sendiri tidak lewat sini lagi — ia memakai
 * jembatan `window.KelasKaHost` (lihat [PlayerHostBridge]) agar bertahan saat
 * perangkat diputar.
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
