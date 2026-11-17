package ai.kelaska.app.util

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Membuka URL di Custom Tab.
 *
 * Dipakai untuk tautan di luar situs dan untuk `/login`: Google memblokir
 * OAuth di dalam WebView, jadi halaman masuk harus dibuka di browser biasa.
 */
fun openInCustomTab(context: Context, url: String) {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, Uri.parse(url))
}
