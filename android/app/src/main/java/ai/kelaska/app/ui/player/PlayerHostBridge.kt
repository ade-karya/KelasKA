package ai.kelaska.app.ui.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * Jembatan `window.KelasKaHost` yang dipasang aplikasi sebelum dokumen pemutar
 * dimuat (lihat `lib/standalone-player/host.ts`):
 *
 * - `setFullscreen(enabled)` memakai mode layar penuh milik aplikasi, bukan
 *   custom view WebView. Custom view ikut dilepas saat perangkat diputar,
 *   sedangkan mode aplikasi bertahan karena `MainActivity` menangani
 *   `configChanges`;
 * - `speak(teks, id)` membacakan narasi tanpa berkas audio memakai
 *   [NarrationTts] dan melaporkan akhir/gagalnya lewat
 *   `window.dispatchEvent(new CustomEvent('kelaska:speech', …))`.
 *
 * Metode `@JavascriptInterface` dipanggil di thread JavaBridge, jadi setiap
 * sentuhan ke UI/TTS dipindahkan ke main thread.
 */
class PlayerHostBridge(
    context: Context,
    private val webView: WebView,
    private val onFullscreenChanged: (Boolean) -> Unit,
) {

    private val main = Handler(Looper.getMainLooper())
    private val tts = NarrationTts(context)

    @Volatile
    private var released = false

    @JavascriptInterface
    fun speak(text: String, requestId: String): String {
        if (released || text.isBlank() || !tts.available) return ERROR
        main.post {
            if (!released) {
                tts.speak(
                    text = text,
                    onEnd = { dispatchSpeech(requestId, "end") },
                    onFailure = { dispatchSpeech(requestId, "error") },
                )
            }
        }
        return OK
    }

    @JavascriptInterface
    fun pauseSpeech() {
        main.post { if (!released) tts.pause() }
    }

    @JavascriptInterface
    fun resumeSpeech() {
        main.post { if (!released) tts.resume() }
    }

    @JavascriptInterface
    fun stopSpeech() {
        main.post { if (!released) tts.stop() }
    }

    @JavascriptInterface
    fun setFullscreen(enabled: Boolean) {
        main.post { if (!released) onFullscreenChanged(enabled) }
    }

    /** Lepas mesin TTS dan hentikan suaranya; dipanggil di main thread. */
    fun release() {
        released = true
        tts.release()
    }

    private fun dispatchSpeech(requestId: String, type: String) {
        main.post {
            if (!released) {
                val detail = """{"id":"${escape(requestId)}","type":"$type"}"""
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('kelaska:speech',{detail:$detail}))",
                    null,
                )
            }
        }
    }

    /** Utterance id dibuat aplikasi, tetapi kutip/garis baru tetap diamankan. */
    private fun escape(value: String): String = buildString {
        for (char in value) {
            when (char) {
                '\\' -> append("\\\\")
                '\'' -> append("\\'")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                else -> if (char < ' ') append("\\u%04x".format(char.code)) else append(char)
            }
        }
    }

    companion object {
        /** Nama objek yang terlihat sebagai `window.KelasKaHost`. */
        const val JS_NAME = "KelasKaHost"

        private const val OK = "ok"
        private const val ERROR = "error"
    }
}
