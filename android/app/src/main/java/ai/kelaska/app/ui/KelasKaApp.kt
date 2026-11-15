package ai.kelaska.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import ai.kelaska.app.KelasKaApplication
import ai.kelaska.app.ui.screens.AccountScreen
import ai.kelaska.app.ui.screens.AdminScreen
import ai.kelaska.app.ui.screens.CourseDetailScreen
import ai.kelaska.app.ui.screens.CoursesScreen
import ai.kelaska.app.ui.screens.HomeScreen
import ai.kelaska.app.ui.screens.LoginScreen

/** Root aplikasi: gerbang autentikasi → shell responsif + NavHost. */
@Composable
fun KelasKaApp(mainViewModel: MainViewModel) {
    val context = LocalContext.current
    val application = context.applicationContext as KelasKaApplication

    val authState by mainViewModel.authState.collectAsState()

    when (val state = authState) {
        is AuthState.Loading ->
            LoginScreen(
                loading = true,
                error = null,
                pendingApproval = false,
                onSignIn = { "" },
                modifier = Modifier.fillMaxSize(),
            )

        is AuthState.SignedOut ->
            LoginScreen(
                loading = false,
                error = state.error,
                pendingApproval = false,
                onSignIn = { mainViewModel.startGoogleSignIn() },
                modifier = Modifier.fillMaxSize(),
            )

        is AuthState.PendingApproval ->
            LoginScreen(
                loading = false,
                error = null,
                pendingApproval = true,
                onSignIn = { mainViewModel.startGoogleSignIn() },
                modifier = Modifier.fillMaxSize(),
            )

        is AuthState.SignedIn ->
            SignedInApp(
                mainViewModel = mainViewModel,
                application = application,
                profile = state.profile,
            )
    }
}

@Composable
private fun SignedInApp(
    mainViewModel: MainViewModel,
    application: KelasKaApplication,
    profile: ai.kelaska.app.data.CachedProfile,
) {
    val navController = rememberNavController()

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
                        initializer { CourseDetailViewModel(application.api, stageId) }
                    },
                )
                CourseDetailScreen(
                    viewModel = detailViewModel,
                    onBack = { navController.popBackStack() },
                )
            }
            composable("account") {
                AccountScreen(
                    profile = profile,
                    onSignOut = { mainViewModel.signOut() },
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
