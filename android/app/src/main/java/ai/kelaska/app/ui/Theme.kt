package ai.kelaska.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/** Warna merek Kelas KA (selaras dengan gradien di web: biru → indigo → ungu). */
val BrandBlue = Color(0xFF2563EB)
val BrandIndigo = Color(0xFF4F46E5)
val BrandPurple = Color(0xFF9333EA)
val BrandLightBackground = Color(0xFFF6F6FF)
val BrandDarkBackground = Color(0xFF0E0E1C)
val BrandLightSurface = Color(0xFFFFFFFF)
val BrandDarkSurface = Color(0xFF181830)
val BrandLightSurfaceVariant = Color(0xFFE7E7F8)
val BrandDarkSurfaceVariant = Color(0xFF232347)

/** Gradien merek untuk hero dan header lembar. */
val BrandGradient = Brush.linearGradient(listOf(BrandBlue, BrandIndigo, BrandPurple))

private val LightColors = lightColorScheme(
    primary = BrandIndigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE4E1FF),
    onPrimaryContainer = Color(0xFF191553),
    secondary = BrandBlue,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDDE6FF),
    onSecondaryContainer = Color(0xFF0F2359),
    tertiary = BrandPurple,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF0DDFF),
    onTertiaryContainer = Color(0xFF3B0A54),
    background = BrandLightBackground,
    onBackground = Color(0xFF1B1B29),
    surface = BrandLightSurface,
    onSurface = Color(0xFF1B1B29),
    surfaceVariant = BrandLightSurfaceVariant,
    onSurfaceVariant = Color(0xFF46455E),
    outline = Color(0xFFC7C5DD),
    surfaceContainer = Color(0xFFEDEDFA),
    surfaceContainerHigh = Color(0xFFE7E7F8),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFB9B4FF),
    onPrimary = Color(0xFF2C2868),
    primaryContainer = Color(0xFF403C8F),
    onPrimaryContainer = Color(0xFFE9E6FF),
    secondary = Color(0xFFA9C4FF),
    onSecondary = Color(0xFF17305F),
    secondaryContainer = Color(0xFF2C4472),
    onSecondaryContainer = Color(0xFFDDE6FF),
    tertiary = Color(0xFFE2B8FF),
    onTertiary = Color(0xFF4A1A62),
    tertiaryContainer = Color(0xFF63397E),
    onTertiaryContainer = Color(0xFFF0DDFF),
    background = BrandDarkBackground,
    onBackground = Color(0xFFE4E1EF),
    surface = BrandDarkSurface,
    onSurface = Color(0xFFE4E1EF),
    surfaceVariant = BrandDarkSurfaceVariant,
    onSurfaceVariant = Color(0xFFC7C5DD),
    outline = Color(0xFF57566F),
    surfaceContainer = Color(0xFF1F1F38),
    surfaceContainerHigh = Color(0xFF262644),
)

@Composable
fun KelasKaTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
