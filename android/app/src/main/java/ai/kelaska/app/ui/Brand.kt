package ai.kelaska.app.ui

import ai.kelaska.app.R
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Kunci merek: dua logo lembaga (Kemendikdasmen & DPRD) dengan tinggi yang
 * sama — rasio kanvasnya berbeda (300×240 vs 251×240), jadi gambarnya diberi
 * tinggi, bukan lebar, supaya berpasangan seimbang.
 */
@Composable
fun GovernmentLogos(
    modifier: Modifier = Modifier,
    logoHeight: Int = 44,
) {
    Row(
        modifier = modifier.semantics { contentDescription = "Kemendikdasmen dan DPRD" },
        horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(
            painter = painterResource(R.drawable.logo_kemendikdasmen),
            contentDescription = "Logo Kemendikdasmen",
            modifier = Modifier.height(logoHeight.dp),
        )
        Image(
            painter = painterResource(R.drawable.logo_dprd),
            contentDescription = "Logo DPRD",
            modifier = Modifier.height(logoHeight.dp),
        )
    }
}
