package ai.kelaska.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.PermanentNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScaffoldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.compose.currentBackStackEntryAsState
import ai.kelaska.app.BuildConfig
import ai.kelaska.app.R
import ai.kelaska.app.data.CachedProfile
import kotlinx.coroutines.launch

/** Satu tujuan navigasi utama. */
internal data class NavDest(val route: String, val label: String, val icon: ImageVector)

internal fun navDestinations(isAdmin: Boolean): List<NavDest> = buildList {
    add(NavDest("home", "Beranda", Icons.Filled.Home))
    add(NavDest("courses", "Kursus Saya", Icons.AutoMirrored.Filled.MenuBook))
    add(NavDest("offline", "Offline", Icons.Filled.CloudOff))
    if (isAdmin) add(NavDest("admin", "Admin", Icons.Filled.Shield))
    add(NavDest("account", "Akun", Icons.Filled.Person))
}

/**
 * Shell responsif:
 * - ponsel landscape / jendela pendek: sidebar ringkas yang selalu terlihat
 *   dan bisa digulir — navigasi tidak lagi tersembunyi di balik tombol menu;
 * - layar ringkas portrait (<840dp): ModalNavigationDrawer;
 * - layar medium (≥840dp): NavigationRail di kiri;
 * - layar lapang (≥1200dp): PermanentNavigationDrawer.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AppShell(
    navController: androidx.navigation.NavHostController,
    profile: CachedProfile,
    onSignOut: () -> Unit,
    content: @Composable (PaddingValues) -> Unit,
) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val isAdmin = profile.role == "admin"
    val destinations = navDestinations(isAdmin)
    val goTo: (String) -> Unit = { route ->
        navController.navigate(route) { launchSingleTop = true }
    }
    // Presentasi layar penuh milik pemutar: seluruh chrome shell (sidebar,
    // rail, drawer, bilah atas) dan inset sistem dilepas supaya slide memakai
    // seluruh layar. Slot `content` tetap di posisi komposisi yang sama, jadi
    // WebView pemutar tidak dibuat ulang saat masuk/keluar presentasi.
    val presenting = LocalPresentationState.current.active

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val landscape = maxWidth > maxHeight
        // Di bawah 480dp tinggi, NavigationRail penuh (logo + lima tujuan +
        // keluar) tidak muat di ponsel landscape; sidebar ringkas yang bisa
        // digulir dipakai supaya semua tujuan tetap terjangkau.
        val compactRail = landscape && maxHeight < 480.dp
        when {
            compactRail -> Row(
                Modifier.fillMaxSize().then(
                    if (presenting) Modifier else Modifier.safeDrawingPadding(),
                ),
            ) {
                if (!presenting) {
                    CompactSidebar(
                        destinations = destinations,
                        currentRoute = currentRoute,
                        onNavigate = goTo,
                        onSignOut = onSignOut,
                    )
                }
                Box(Modifier.weight(1f)) { content(PaddingValues(0.dp)) }
            }

            maxWidth >= 1200.dp ->
                PermanentNavigationDrawer(
                    drawerContent = {
                        // Drawer kosong saat presentasi: kolomnya menjadi 0 dp
                        // dan slide memakai seluruh lebar.
                        if (!presenting) {
                            PermanentDrawerSheet(Modifier.width(300.dp)) {
                                SidebarContent(
                                    destinations = destinations,
                                    currentRoute = currentRoute,
                                    onNavigate = goTo,
                                    onSignOut = onSignOut,
                                )
                            }
                        }
                    },
                ) {
                    content(PaddingValues(0.dp))
                }

            maxWidth >= 840.dp ->
                Row(Modifier.fillMaxSize()) {
                    if (!presenting) {
                        NavigationRail(
                            containerColor = MaterialTheme.colorScheme.surfaceContainer,
                            header = {
                                androidx.compose.foundation.Image(
                                    painterResource(R.drawable.logo_kemendikdasmen),
                                    contentDescription = "Kemendikdasmen",
                                    modifier = Modifier.height(40.dp).padding(top = 12.dp),
                                )
                            },
                        ) {
                            Spacer(Modifier)
                            destinations.forEach { dest ->
                                NavigationRailItem(
                                    selected = currentRoute == dest.route,
                                    onClick = { goTo(dest.route) },
                                    icon = { Icon(dest.icon, contentDescription = null) },
                                    label = { Text(dest.label) },
                                    alwaysShowLabel = true,
                                )
                            }
                            Spacer(Modifier)
                            IconButton(onClick = onSignOut, modifier = Modifier.padding(bottom = 16.dp)) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Logout,
                                    contentDescription = "Keluar",
                                    tint = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                    Box(Modifier.weight(1f)) { content(PaddingValues(0.dp)) }
                }

            landscape -> Row(
                Modifier.fillMaxSize().then(
                    if (presenting) Modifier else Modifier.safeDrawingPadding(),
                ),
            ) {
                if (!presenting) {
                    CompactSidebar(
                        destinations = destinations,
                        currentRoute = currentRoute,
                        onNavigate = goTo,
                        onSignOut = onSignOut,
                    )
                }
                Box(Modifier.weight(1f)) { content(PaddingValues(0.dp)) }
            }

            else -> {
                val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
                val scope = androidx.compose.runtime.rememberCoroutineScope()
                ModalNavigationDrawer(
                    drawerState = drawerState,
                    // Presentasi tidak boleh membuka drawer lewat geser tepi.
                    gesturesEnabled = !presenting,
                    drawerContent = {
                        ModalDrawerSheet(Modifier.width(300.dp)) {
                            SidebarContent(
                                destinations = destinations,
                                currentRoute = currentRoute,
                                onNavigate = { route ->
                                    scope.launch { drawerState.close() }
                                    goTo(route)
                                },
                                onSignOut = onSignOut,
                            )
                        }
                    },
                ) {
                    Scaffold(
                        // Tanpa bilah atas dan tanpa inset: slide mengisi
                        // seluruh jendela, termasuk area kamera depan.
                        contentWindowInsets = if (presenting) {
                            WindowInsets(0, 0, 0, 0)
                        } else {
                            ScaffoldDefaults.contentWindowInsets
                        },
                        topBar = {
                            if (!presenting) {
                                TopAppBar(
                                    title = {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            androidx.compose.foundation.Image(
                                                painterResource(R.drawable.logo_kemendikdasmen),
                                                contentDescription = null,
                                                modifier = Modifier.height(26.dp),
                                            )
                                            Spacer(Modifier.width(6.dp))
                                            androidx.compose.foundation.Image(
                                                painterResource(R.drawable.logo_dprd),
                                                contentDescription = null,
                                                modifier = Modifier.height(26.dp),
                                            )
                                            Spacer(Modifier.width(10.dp))
                                            Text(
                                                "Kelas KA",
                                                style = MaterialTheme.typography.titleMedium.copy(
                                                    fontWeight = FontWeight.ExtraBold,
                                                ),
                                            )
                                        }
                                    },
                                    navigationIcon = {
                                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                            Icon(Icons.Filled.Menu, contentDescription = "Buka menu")
                                        }
                                    },
                                )
                            }
                        },
                    ) { padding ->
                        content(padding)
                    }
                }
            }
        }
    }
}

/** Isi sidebar: brand, daftar tujuan, keluar, dan versi. */
@Composable
private fun SidebarContent(
    destinations: List<NavDest>,
    currentRoute: String?,
    onNavigate: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxHeight()
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        GovernmentLogos(logoHeight = 46, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        Text(
            "Kelas KA",
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
            modifier = Modifier.padding(top = 16.dp),
        )
        Text(
            "Kecerdasan Artifisial",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        HorizontalDivider(modifier = Modifier.padding(vertical = 14.dp))

        destinations.forEach { dest ->
            val selected = currentRoute == dest.route
            NavigationDrawerItem(
                selected = selected,
                onClick = { onNavigate(dest.route) },
                icon = { Icon(dest.icon, contentDescription = null) },
                label = {
                    Text(dest.label, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
                },
                shape = RoundedCornerShape(14.dp),
                colors = NavigationDrawerItemDefaults.colors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
                modifier = Modifier.padding(vertical = 2.dp),
            )
        }

        Spacer(Modifier)

        HorizontalDivider(modifier = Modifier.padding(vertical = 14.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .clickable(onClick = onSignOut)
                .padding(horizontal = 16.dp, vertical = 14.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = MaterialTheme.colorScheme.error)
            Text(
                "Keluar",
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 12.dp),
            )
        }
        Text(
            "v${BuildConfig.VERSION_NAME} · kelaska.riau.ai",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
    }
}

/**
 * Sidebar ringkas untuk landscape sempit: ikon dan label satu baris dalam
 * kolom yang bisa digulir, selalu terlihat tanpa tombol menu. Tinggi ponsel
 * landscape (sekitar 360–420dp) tidak cukup untuk rail penuh, jadi isinya
 * digulir, bukan dipotong.
 */
@Composable
private fun CompactSidebar(
    destinations: List<NavDest>,
    currentRoute: String?,
    onNavigate: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxHeight().width(92.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 6.dp, vertical = 8.dp),
        ) {
            androidx.compose.foundation.Image(
                painterResource(R.drawable.logo_kemendikdasmen),
                contentDescription = "Kemendikdasmen",
                modifier = Modifier.height(28.dp).padding(top = 4.dp),
            )
            Spacer(Modifier.height(10.dp))
            destinations.forEach { dest ->
                val selected = currentRoute == dest.route
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .then(
                            if (selected) {
                                Modifier.background(MaterialTheme.colorScheme.primaryContainer)
                            } else {
                                Modifier
                            },
                        )
                        .clickable { onNavigate(dest.route) }
                        .padding(vertical = 8.dp),
                ) {
                    Icon(
                        dest.icon,
                        contentDescription = null,
                        tint = if (selected) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    Text(
                        dest.label,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 2.dp, start = 2.dp, end = 2.dp),
                    )
                }
            }
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            IconButton(onClick = onSignOut) {
                Icon(
                    Icons.AutoMirrored.Filled.Logout,
                    contentDescription = "Keluar",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
            Text(
                "v${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}
