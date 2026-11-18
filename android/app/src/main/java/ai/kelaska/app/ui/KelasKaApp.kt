package ai.kelaska.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.BackHandler
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import ai.kelaska.app.KelasKaApplication
import ai.kelaska.app.ui.components.UpdateHost
import ai.kelaska.app.ui.screens.AccountScreen
import ai.kelaska.app.ui.screens.AdminScreen
import ai.kelaska.app.ui.screens.CourseDetailScreen
import ai.kelaska.app.ui.screens.CoursesScreen
import ai.kelaska.app.ui.screens.HomeScreen
import ai.kelaska.app.ui.screens.LoginScreen
import ai.kelaska.app.ui.screens.OfflineCourseScreen
import ai.kelaska.app.ui.screens.OfflineLibraryScreen

/**
 * Root aplikasi: dialog pembaruan di atas gerbang autentikasi + shell/NavHost.
 *
 * Cek otomatis dijalankan di sini supaya pengguna yang belum masuk (atau hanya
 * membuka perpustakaan offline) juga bisa memperbarui aplikasi. ViewModel yang
 * membatasi frekuensi menjadi sekali per 24 jam.
 */
@Composable
fun KelasKaApp(mainViewModel: MainViewModel, updateViewModel: UpdateViewModel) {
    LaunchedEffect(updateViewModel) {
        updateViewModel.checkAutomatically()
    }
    // Satu status presentasi untuk seluruh aplikasi: pemutar offline (tanpa
    // AppShell) maupun pemutar di dalam AppShell memakai instance yang sama.
    val presentation = remember { PresentationState() }
    CompositionLocalProvider(LocalPresentationState provides presentation) {
        UpdateHost(viewModel = updateViewModel) {
            KelasKaContent(mainViewModel, updateViewModel)
        }
    }
}

@Composable
private fun KelasKaContent(mainViewModel: MainViewModel, updateViewModel: UpdateViewModel) {
    val context = LocalContext.current
    val application = context.applicationContext as KelasKaApplication

    val authState by mainViewModel.authState.collectAsState()
    // Perpustakaan offline bisa dibuka tanpa masuk; ini yang membuat aplikasi
    // tetap berguna saat perangkat sama sekali tidak punya internet.
    var offlineOnly by rememberSaveable { mutableStateOf(false) }
    // Setelah masuk, jalur offline-only ditutup supaya keluar akun kembali ke
    // layar masuk, bukan tiba-tiba membuka perpustakaan offline.
    LaunchedEffect(authState) {
        if (authState is AuthState.SignedIn) offlineOnly = false
    }

    if (authState is AuthState.SignedIn) {
        SignedInApp(
            mainViewModel = mainViewModel,
            updateViewModel = updateViewModel,
            application = application,
            profile = (authState as AuthState.SignedIn).profile,
        )
        return
    }

    if (offlineOnly) {
        OfflineOnlyApp(application = application, onExit = { offlineOnly = false })
        return
    }

    when (val state = authState) {
        is AuthState.Loading ->
            LoginScreen(
                loading = true,
                error = null,
                pendingApproval = false,
                onSignIn = { "" },
                onOpenOffline = { offlineOnly = true },
                modifier = Modifier.fillMaxSize(),
            )

        is AuthState.SignedOut ->
            LoginScreen(
                loading = false,
                error = state.error,
                pendingApproval = false,
                onSignIn = { mainViewModel.startGoogleSignIn() },
                onOpenOffline = { offlineOnly = true },
                modifier = Modifier.fillMaxSize(),
            )

        is AuthState.PendingApproval ->
            LoginScreen(
                loading = false,
                error = null,
                pendingApproval = true,
                onSignIn = { mainViewModel.startGoogleSignIn() },
                onOpenOffline = { offlineOnly = true },
                modifier = Modifier.fillMaxSize(),
            )

        is AuthState.SignedIn -> Unit
    }
}

/**
 * Navigasi khusus mode offline: perpustakaan → pemutar paket. Tidak ada
 * AppShell karena tidak ada akun, admin, atau data daring di jalur ini.
 */
@Composable
private fun OfflineOnlyApp(
    application: KelasKaApplication,
    onExit: () -> Unit,
) {
    val navController = rememberNavController()
    val currentEntry by navController.currentBackStackEntryAsState()
    val presentation = LocalPresentationState.current
    // Tombol kembali sistem di daftar paket mengembalikan ke layar masuk,
    // bukan menutup aplikasi.
    BackHandler(enabled = currentEntry?.destination?.route == "offline") { onExit() }
    NavHost(
        navController = navController,
        startDestination = "offline",
        // Jalur offline tidak memakai AppShell/Scaffold, jadi inset sistem
        // (status bar & navigasi) diterapkan di sini. Saat presentasi, inset
        // dilepas supaya slide memakai seluruh layar termasuk area kamera.
        modifier = Modifier
            .fillMaxSize()
            .then(if (presentation.active) Modifier else Modifier.safeDrawingPadding()),
    ) {
        composable("offline") {
            val libraryViewModel: OfflineLibraryViewModel = viewModel(
                factory = viewModelFactory {
                    initializer {
                        OfflineLibraryViewModel(application.offlineStore, application)
                    }
                },
            )
            OfflineLibraryScreen(
                viewModel = libraryViewModel,
                onOpenCourse = { packageId ->
                    navController.navigate("offline-course/$packageId")
                },
                onBack = onExit,
            )
        }
        composable(
            route = "offline-course/{packageId}",
            arguments = listOf(navArgument("packageId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val packageId = backStackEntry.arguments?.getString("packageId").orEmpty()
            val courseViewModel: OfflineCourseViewModel = viewModel(
                factory = viewModelFactory {
                    initializer { OfflineCourseViewModel(application.offlineStore, packageId) }
                },
            )
            OfflineCourseScreen(
                viewModel = courseViewModel,
                onBack = { navController.popBackStack() },
            )
        }
    }
}

@Composable
private fun SignedInApp(
    mainViewModel: MainViewModel,
    updateViewModel: UpdateViewModel,
    application: KelasKaApplication,
    profile: ai.kelaska.app.data.CachedProfile,
) {
    val navController = rememberNavController()
    val updateState by updateViewModel.state.collectAsState()

    // Satu CoursesViewModel dipakai oleh Beranda (statistik) dan Kursus Saya.
    val coursesViewModel: CoursesViewModel = viewModel(
        factory = viewModelFactory { initializer { CoursesViewModel(application.api) } },
    )
    val coursesState by coursesViewModel.state.collectAsState()

    AppShell(
        navController = navController,
        profile = profile,
        onSignOut = { mainViewModel.signOut() },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "home",
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            composable("home") {
                HomeScreen(
                    courses = coursesState,
                    onOpenCourses = { navController.navigate("courses") { launchSingleTop = true } },
                    onRetry = coursesViewModel::refresh,
                )
            }
            composable("courses") {
                CoursesScreen(
                    viewModel = coursesViewModel,
                    onOpenCourse = { stageId -> navController.navigate("course/$stageId") },
                )
            }
            composable(
                route = "course/{stageId}",
                arguments = listOf(navArgument("stageId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val stageId = backStackEntry.arguments?.getString("stageId").orEmpty()
                val detailViewModel: CourseDetailViewModel = viewModel(
                    factory = viewModelFactory {
                        initializer {
                            CourseDetailViewModel(
                                api = application.api,
                                stageId = stageId,
                                cacheDir = application.cacheDir,
                                appVersion = ai.kelaska.app.BuildConfig.VERSION_NAME,
                            )
                        }
                    },
                )
                CourseDetailScreen(
                    viewModel = detailViewModel,
                    onBack = { navController.popBackStack() },
                )
            }
            composable("offline") {
                val libraryViewModel: OfflineLibraryViewModel = viewModel(
                    factory = viewModelFactory {
                        initializer {
                            OfflineLibraryViewModel(application.offlineStore, application)
                        }
                    },
                )
                OfflineLibraryScreen(
                    viewModel = libraryViewModel,
                    onOpenCourse = { packageId ->
                        navController.navigate("offline-course/$packageId")
                    },
                )
            }
            composable(
                route = "offline-course/{packageId}",
                arguments = listOf(navArgument("packageId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val packageId = backStackEntry.arguments?.getString("packageId").orEmpty()
                val courseViewModel: OfflineCourseViewModel = viewModel(
                    factory = viewModelFactory {
                        initializer { OfflineCourseViewModel(application.offlineStore, packageId) }
                    },
                )
                OfflineCourseScreen(
                    viewModel = courseViewModel,
                    onBack = { navController.popBackStack() },
                )
            }
            composable("account") {
                AccountScreen(
                    profile = profile,
                    onSignOut = { mainViewModel.signOut() },
                    onCheckUpdate = updateViewModel::checkManually,
                    checkingUpdate = updateState == UpdateState.Checking,
                )
            }
            composable("admin") {
                val adminViewModel: AdminViewModel = viewModel(
                    factory = viewModelFactory { initializer { AdminViewModel(application.api) } },
                )
                AdminScreen(viewModel = adminViewModel, currentUserId = profile.id)
            }
        }
    }
}
