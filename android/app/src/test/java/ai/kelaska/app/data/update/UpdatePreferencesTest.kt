package ai.kelaska.app.data.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatePreferencesTest {

    private val interval = UpdatePreferences.AUTO_CHECK_INTERVAL_MS
    private val now = 1_800_000_000_000L

    @Test
    fun neverCheckedMeansDue() {
        assertTrue(isAutoCheckDue(lastCheckAtMillis = 0L, nowMillis = now, intervalMillis = interval))
        assertTrue(isAutoCheckDue(lastCheckAtMillis = -1L, nowMillis = now, intervalMillis = interval))
    }

    @Test
    fun checkWithinTwentyFourHoursIsSkipped() {
        assertFalse(isAutoCheckDue(now - 60_000L, now, interval))
        assertFalse(isAutoCheckDue(now - interval + 1L, now, interval))
    }

    @Test
    fun checkAtOrAfterTwentyFourHoursIsDueAgain() {
        assertTrue(isAutoCheckDue(now - interval, now, interval))
        assertTrue(isAutoCheckDue(now - interval - 1L, now, interval))
    }

    @Test
    fun clockMovingBackwardsDoesNotDisableChecksForever() {
        assertTrue(isAutoCheckDue(lastCheckAtMillis = now + 86_400_000L, nowMillis = now, intervalMillis = interval))
    }
}
