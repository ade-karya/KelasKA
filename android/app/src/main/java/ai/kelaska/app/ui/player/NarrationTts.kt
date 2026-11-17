package ai.kelaska.app.ui.player

import android.content.Context
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import java.util.Locale

/**
 * Narasi dengan mesin TTS perangkat, mengikuti jalur browser-native TTS versi
 * web (`lib/playback/engine.ts#playBrowserTTS`): kalimat disintesis ke berkas
 * WAV lalu diputar lewat [MediaPlayer], sehingga jeda/lanjutkan pemutaran kelas
 * ikut menjeda/melanjutkan suara — `TextToSpeech` sendiri hanya bisa berhenti.
 *
 * Satu baris disintesis sekali. Bila mesin tidak tersedia (belum terpasang,
 * gagal inisialisasi), [speak] mengembalikan `false` dan pemanggil memakai
 * timer membaca seperti versi web saat browser TTS tidak ada.
 */
class NarrationTts(context: Context) {

    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val cacheDir = File(appContext.cacheDir, "narration-tts").apply { mkdirs() }

    @Volatile
    private var initStatus = TextToSpeech.ERROR

    private var engine: TextToSpeech? = null
    private var languageApplied = false
    private var serial = 0

    private var call: Call? = null
    private var player: MediaPlayer? = null
    private var prepared = false
    private var started = false
    private var paused = false

    private data class Call(
        val id: String,
        val file: File,
        val onEnd: () -> Unit,
        val onFailure: () -> Unit,
    )

    init {
        engine = TextToSpeech(appContext) { status ->
            initStatus = status
        }
    }

    /** Mesin siap dipakai (dipanggil dari thread mana pun). */
    val available: Boolean
        get() = initStatus == TextToSpeech.SUCCESS && engine != null

    /**
     * Sintesis [text] lalu putar. Panggil di main thread. Mengembalikan `false`
     * bila mesin belum siap atau sintesis ditolak; [onFailure] juga dipanggil
     * saat pemutaran gagal setelah diterima.
     */
    fun speak(text: String, onEnd: () -> Unit, onFailure: () -> Unit): Boolean {
        val tts = engine ?: return false
        if (!available) return false
        applyLanguage(tts)
        stop()

        val id = "tts-${++serial}"
        val file = File(cacheDir, "$id.wav")
        call = Call(id, file, onEnd, onFailure)
        tts.setOnUtteranceProgressListener(progress)
        val params = Bundle().apply {
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f)
        }
        val result = runCatching { tts.synthesizeToFile(text, params, file, id) }
            .getOrDefault(TextToSpeech.ERROR)
        if (result != TextToSpeech.SUCCESS) {
            val failed = call ?: return false
            clearCall()
            failed.onFailure()
            return false
        }
        return true
    }

    fun pause() {
        paused = true
        val media = player ?: return
        if (media.isPlaying) runCatching { media.pause() }
    }

    fun resume() {
        paused = false
        if (call == null) return
        when {
            prepared && !started -> startPlayback()
            started -> runCatching { player?.start() }
        }
    }

    fun stop() {
        paused = false
        val active = call
        call = null
        releasePlayer()
        engine?.stop()
        active?.file?.let { runCatching { it.delete() } }
        cacheDir.listFiles()?.forEach { runCatching { it.delete() } }
    }

    fun release() {
        stop()
        engine?.shutdown()
        engine = null
        initStatus = TextToSpeech.ERROR
    }

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit

        override fun onDone(utteranceId: String?) {
            main.post { onSynthesized(utteranceId) }
        }

        @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
        override fun onError(utteranceId: String?) {
            main.post { onSynthesisFailed(utteranceId) }
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            main.post { onSynthesisFailed(utteranceId) }
        }
    }

    private fun applyLanguage(tts: TextToSpeech) {
        if (languageApplied) return
        languageApplied = true
        val status = tts.setLanguage(Locale("id", "ID"))
        if (status == TextToSpeech.LANG_MISSING_DATA || status == TextToSpeech.LANG_NOT_SUPPORTED) {
            // Suara Indonesia belum terpasang: pakai bahasa perangkat bila ada.
            tts.setLanguage(Locale.getDefault())
        }
    }

    private fun onSynthesized(utteranceId: String?) {
        val active = call ?: return
        if (active.id != utteranceId) return
        play(active)
    }

    private fun onSynthesisFailed(utteranceId: String?) {
        val active = call ?: return
        if (active.id != utteranceId) return
        clearCall()
        active.onFailure()
    }

    private fun play(active: Call) {
        prepared = false
        started = false
        val media = MediaPlayer()
        player = media
        try {
            media.setDataSource(active.file.absolutePath)
            media.setOnPreparedListener {
                prepared = true
                if (!paused) startPlayback()
            }
            media.setOnCompletionListener {
                // Keluar dari callback MediaPlayer sebelum melepasnya.
                main.post {
                    if (call?.id == active.id) {
                        clearCall()
                        active.onEnd()
                    }
                }
            }
            media.setOnErrorListener { _, _, _ ->
                main.post {
                    if (call?.id == active.id) {
                        clearCall()
                        active.onFailure()
                    }
                }
                true
            }
            media.prepareAsync()
        } catch (_: Exception) {
            if (call?.id == active.id) {
                clearCall()
                active.onFailure()
            }
        }
    }

    private fun startPlayback() {
        val media = player ?: return
        if (started) return
        runCatching { media.start() }
            .onSuccess { started = true }
            .onFailure {
                val active = call ?: return
                clearCall()
                active.onFailure()
            }
    }

    /** Lepas pemutar aktif dan berkas sintesisnya; callback-nya sudah selesai. */
    private fun clearCall() {
        val active = call
        call = null
        releasePlayer()
        active?.file?.let { runCatching { it.delete() } }
    }

    private fun releasePlayer() {
        prepared = false
        started = false
        val media = player
        player = null
        media?.let {
            runCatching { it.reset() }
            runCatching { it.release() }
        }
    }
}
