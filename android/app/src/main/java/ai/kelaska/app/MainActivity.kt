package ai.kelaska.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ai.kelaska.app.ui.KelasKaApp
import ai.kelaska.app.ui.KelasKaTheme
import ai.kelaska.app.ui.MainViewModel

class MainActivity : ComponentActivity() {

    private val applicationGraph
        get() = application as KelasKaApplication

    private val viewModel: MainViewModel by viewModels {
        viewModelFactory {
            initializer {
                MainViewModel(
                    api = applicationGraph.api,
                    sessionStore = applicationGraph.sessionStore,
                    supabase = applicationGraph.supabase,
                )
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleAuthDeepLink(intent)
        setContent {
            KelasKaTheme {
                KelasKaApp(viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthDeepLink(intent)
    }

    /** Deep link `kelaskaapp://auth/callback?code=…` kembali dari consent Google. */
    private fun handleAuthDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != DeepLink.SCHEME || uri.host != DeepLink.HOST || uri.path != DeepLink.PATH) return
        // Tandai sudah diproses supaya rotasi / recreate tidak menukar kode dua kali.
        intent.data = null
        uri.getQueryParameter("code")?.let { code ->
            viewModel.onAuthCallback(code)
        } ?: run {
            viewModel.onAuthCallbackFailed(uri.getQueryParameter("error_description")
                ?: uri.getQueryParameter("error")
                ?: "Google membatalkan masuk.")
        }
    }

    private object DeepLink {
        const val SCHEME = "kelaskaapp"
        const val HOST = "auth"
        const val PATH = "/callback"
    }
}
