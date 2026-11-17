package ai.kelaska.app.ui.screens

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Environment
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.zIndex
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.KelasKaApplication
import ai.kelaska.app.util.ClassWebLink

/**
 * Kelas daring ditampilkan dengan WebView memakai halaman web yang SAMA dengan
 * desktop (`/classroom/<id>`), bukan pemutar native yang terpotong fiturnya.
 * Karena viewport web memakai `width=device-width`, WebView dengan UA ponsel
 * otomatis mendapat tampilan mobile — tidak ada parameter "mobile" khusus.
 *
 * Sesi aplikasi (`kelaska_session`) disuntikkan ke cookie jar WebView sebelum
 * memuat halaman supaya gate auth di sisi server mengenali akun yang sudah
 * masuk di aplikasi. Semua fitur web (discussion, PBL, kuis, unggah berkas,
 * video, TTS browser) hidup di sini karena ini benar-benar situs yang dimuat
 * ulang, bukan salinan native.
 */
@Composable
fun ClassWebViewScreen(
    stageId: String,
    onBack: () -> Unit,
    onOpenDetail: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val application = context.applicationContext as KelasKaApplication
    val sessionToken = remember { application.sessionStore.sessionToken }
    val classUrl = remember(stageId) { ClassWebLink.classroomUrl(BuildConfig.BASE_URL, stageId) }

    var webView by remember { mutableStateOf<WebView?>(null) }
    var loading by remember { mutableStateOf(true) }
    var progress by remember { mutableStateOf(0f) }
    var filePathCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var permissionRequest by remember { mutableStateOf<PermissionRequest?>(null) }
    var fullscreenView by remember { mutableStateOf<View?>(null) }
    var fullscreenCallback by remember { mutableStateOf<WebChromeClient.CustomViewCallback?>(null) }

    // Unggah berkas (gambar/PDF di PBL atau kuis): WebView menyerahkan URI yang
    // dipilih pengguna kembali ke halaman lewat ValueCallback.
    val fileChooserLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        val callback = filePathCallback
        filePathCallback = null
        if (uris.isNotEmpty()) callback?.onReceiveValue(uris.toTypedArray())
        else callback?.onReceiveValue(null)
    }

    // Fitur mikropon di diskusiweb memakai getUserMedia; WebView butuh izin
    // Android dan grant lewat onPermissionRequest.
    val micPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val request = permissionRequest
        permissionRequest = null
        if (request == null) return@rememberLauncherForActivityResult
        val resources = request.resources
        if (granted && resources.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }) {
            request.grant(resources)
        } else {
            request.deny()
        }
    }

    fun goBackFromClass() {
        val active = webView
        if (fullscreenView != null) {
            fullscreenCallback?.onCustomViewHidden()
            fullscreenView = null
            fullscreenCallback = null
        } else if (active != null && active.canGoBack()) {
            active.goBack()
        } else {
            onBack()
        }
    }

    BackHandler { goBackFromClass() }

    DisposableEffect(Unit) {
        onDispose {
            // Jangan biarkan callback menggantung bila layar ditutup saat
            // chooser/izin sedang terbuka.
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
            permissionRequest?.deny()
            permissionRequest = null
            fullscreenCallback?.onCustomViewHidden()
            fullscreenCallback = null
            webView?.destroy()
            webView = null
        }
    }

    Column(modifier.fillMaxSize()) {
        Surface(tonalElevation = 2.dp) {
            Row(
                modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { goBackFromClass() }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali")
                }
                Text(
                    "Kelas KA",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f).padding(start = 4.dp),
                )
                IconButton(onClick = onOpenDetail) {
                    Icon(Icons.Filled.Info, contentDescription = "Detail kursus")
                }
                IconButton(onClick = { openInCustomTab(context, classUrl) }) {
                    Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Buka di browser")
                }
            }
        }

        if (loading) {
            if (progress > 0f) {
                LinearProgressIndicator(
                    progress = { progress / 100f },
                    modifier = Modifier.fillMaxWidth().height(3.dp),
                )
            } else {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth().height(3.dp))
            }
        }

        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        configureOnlineWebView(
                            context = ctx,
                            sessionToken = sessionToken,
                            classUrl = classUrl,
                            onProgress = { value, isLoading ->
                                progress = value.toFloat()
                                loading = isLoading
                            },
                            onFileChooser = { callback, acceptTypes ->
                                filePathCallback?.onReceiveValue(null)
                                filePathCallback = callback
                                fileChooserLauncher.launch(acceptTypes)
                            },
                            onPermission = { request ->
                                permissionRequest?.deny()
                                permissionRequest = request
                                micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            },
                            onFullscreen = { view, callback ->
                                fullscreenView = view
                                fullscreenCallback = callback
                            },
                            onHideFullscreen = {
                                fullscreenView = null
                                fullscreenCallback?.onCustomViewHidden()
                                fullscreenCallback = null
                            },
                        )
                    }.also { webView = it }
                },
                modifier = Modifier.fillMaxSize(),
            )

            // Fullscreen API dari situs (mis. presentasi slide) ditampilkan
            // sebagai overlay; MainActivity sudah configChanges sehingga view
            // ini tidak hancur saat rotasi.
            fullscreenView?.let { view ->
                key(view) {
                    AndroidView(
                        factory = {
                            (view.parent as? ViewGroup)?.removeView(view)
                            view
                        },
                        modifier = Modifier.fillMaxSize().zIndex(1f),
                    )
                }
            }
        }
    }
}

/** Memasang cookie sesi lalu mengizinkan semua kemampuan web yang dipakai kelas. */
@SuppressLint("SetJavaScriptEnabled")
private fun WebView.configureOnlineWebView(
    context: Context,
    sessionToken: String?,
    classUrl: String,
    onProgress: (Int, Boolean) -> Unit,
    onFileChooser: (ValueCallback<Array<Uri>>, String) -> Unit,
    onPermission: (PermissionRequest) -> Unit,
    onFullscreen: (View, WebChromeClient.CustomViewCallback) -> Unit,
    onHideFullscreen: () -> Unit,
) {
    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        mediaPlaybackRequiresUserGesture = false
        javaScriptCanOpenWindowsAutomatically = false
        setSupportMultipleWindows(false)
        loadWithOverviewMode = true
        useWideViewPort = true
        builtInZoomControls = false
        displayZoomControls = false
        blockNetworkLoads = false
        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        cacheMode = WebSettings.LOAD_DEFAULT
        setGeolocationEnabled(false)
        allowFileAccess = false
        allowContentAccess = false
    }
    setBackgroundColor(Color.WHITE)

    // Suntik sesi aplikasi ke cookie jar WebView. Hapus dulu nilai lama untuk
    // host yang sama supaya cookie basi tidak menimpa token baru.
    CookieManager.getInstance().apply {
        setAcceptCookie(true)
        if (sessionToken != null) {
            getCookie(classUrl)
                ?.split(";")
                ?.map { it.trim() }
                ?.filter { it.startsWith("kelaska_session=") }
                ?.forEach { setCookie(classUrl, "kelaska_session=; Path=/; Max-Age=0") }
            setCookie(classUrl, ClassWebLink.sessionCookie(sessionToken))
        }
        flush()
    }

    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
            handleOnlineNavigation(context, request?.url?.toString().orEmpty())

        @Suppress("DEPRECATION")
        override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
            handleOnlineNavigation(context, url.orEmpty())

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            onProgress(0, true)
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            onProgress(100, false)
        }
    }

    webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            onProgress(newProgress, newProgress < 100)
        }

        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?,
        ): Boolean {
            if (filePathCallback == null) return false
            val accept = fileChooserParams?.acceptTypes
                ?.firstOrNull { it.isNotBlank() }
                ?.takeIf { it != "*/*" }
                ?: "image/*"
            onFileChooser(filePathCallback, accept)
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest?) {
            if (request == null) return
            val resources = request.resources
            if (resources.isNotEmpty() && resources.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }) {
                onPermission(request)
            } else {
                request.deny()
            }
        }

        override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
            if (view == null) return
            onFullscreen(view, callback ?: object : CustomViewCallback {
                override fun onCustomViewHidden() = Unit
            })
        }

        override fun onHideCustomView() {
            onHideFullscreen()
        }
    }

    setDownloadListener(object : DownloadListener {
        override fun onDownloadStart(
            url: String?,
            userAgent: String?,
            contentDisposition: String?,
            mimetype: String?,
            contentLength: Long,
        ) {
            if (url.isNullOrBlank()) return
            val target = URLUtil.guessFileName(url, contentDisposition, mimetype)
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(target)
                .setMimeType(mimetype)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, target)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            try {
                val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                manager.enqueue(request)
                Toast.makeText(context, "Mengunduh $target", Toast.LENGTH_SHORT).show()
            } catch (error: Exception) {
                openInCustomTab(context, url)
            }
        }
    })

    loadUrl(classUrl)
}

/**
 * Navigasi internal (host BASE_URL) tetap di WebView. Tautan lain, skema telepon
 * dan mailto dibuka di aplikasi lain. Jika sesi berakhir dan web mengalihkan ke
 * `/login`, halaman login dibuka di Custom Tab — Google memblokir OAuth di
 * dalam WebView, jadi ini memang tidak boleh ditangani di sini.
 */
private fun handleOnlineNavigation(context: Context, rawUrl: String): Boolean {
    if (rawUrl.isBlank()) return false
    if (rawUrl.startsWith("tel:") || rawUrl.startsWith("mailto:") || rawUrl.startsWith("intent:")) {
        return try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl)))
            true
        } catch (_: Exception) {
            true
        }
    }
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) return false

    val baseHost = ClassWebLink.baseHost(BuildConfig.BASE_URL)
    val targetUri = Uri.parse(rawUrl)
    val sameSite = targetUri.host == baseHost ||
        (baseHost != null && targetUri.host?.endsWith(".$baseHost") == true)
    if (sameSite) {
        val path = targetUri.path.orEmpty()
        if (path == "/login" || path.startsWith("/login/")) {
            openInCustomTab(context, rawUrl)
            Toast.makeText(context, "Sesi berakhir. Masuk kembali di browser.", Toast.LENGTH_LONG).show()
            return true
        }
        return false
    }
    openInCustomTab(context, rawUrl)
    return true
}

private fun openInCustomTab(context: Context, url: String) {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
}
