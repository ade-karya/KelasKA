package ai.kelaska.app

import android.app.Application
import ai.kelaska.app.data.KelasKaApi
import ai.kelaska.app.data.SessionStore
import ai.kelaska.app.data.SupabasePkce

/**
 * Grafik aplikasi: satu SessionStore, satu klien HTTP, satu klien Supabase PKCE.
 * Layar-layar tidak membuat klien sendiri supaya pemeriksaan sesi konsisten.
 */
class KelasKaApplication : Application() {

    lateinit var sessionStore: SessionStore
        private set

    lateinit var api: KelasKaApi
        private set

    lateinit var supabase: SupabasePkce
        private set

    override fun onCreate() {
        super.onCreate()
        sessionStore = SessionStore(this)
        api = KelasKaApi(sessionStore, BuildConfig.BASE_URL)
        supabase = SupabasePkce(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
            deepLink = BuildConfig.AUTH_DEEP_LINK,
        )
    }
}
