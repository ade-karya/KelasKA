package ai.kelaska.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Mode presentasi pemutar, dibagikan ke seluruh pohon Compose.
 *
 * Pemutar berada di dalam `NavHost` yang dibungkus [AppShell]. Tanpa status
 * bersama, layar penuh hanya menyembunyikan bilah milik pemutar: sidebar
 * navigasi aplikasi (rail/sidebar ringkas) dan bilah atas tetap memakan ruang,
 * sehingga slide tidak pernah mengisi seluruh layar. Pemutar mengubah status
 * ini lewat [LocalPresentationState]; [AppShell] dan jalur offline membacanya
 * untuk melepas chrome aplikasi serta inset sistem selama presentasi.
 */
class PresentationState {
    var active by mutableStateOf(false)
        internal set

    fun set(active: Boolean) {
        this.active = active
    }
}

/**
 * Satu instance disediakan di akar aplikasi (lihat `KelasKaApp`), sehingga
 * pemutar di layar mana pun berbicara dengan shell yang sedang aktif.
 */
val LocalPresentationState = staticCompositionLocalOf { PresentationState() }
