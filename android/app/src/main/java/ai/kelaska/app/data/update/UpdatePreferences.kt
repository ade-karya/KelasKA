package ai.kelaska.app.data.update

import android.content.Context

/**
 * Penanda waktu cek otomatis. SharedPreferences biasa karena isinya bukan
 * rahasia (hanya satu timestamp); sesi akun tetap di EncryptedSharedPreferences.
 */
class UpdatePreferences(context: Context) {

    private val prefs = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    fun lastAutoCheckAt(): Long = prefs.getLong(KEY_LAST_CHECK, 0L)

    fun isAutoCheckDue(nowMillis: Long = System.currentTimeMillis()): Boolean =
        isAutoCheckDue(lastAutoCheckAt(), nowMillis)

    fun markAutoCheck(nowMillis: Long = System.currentTimeMillis()) {
        prefs.edit().putLong(KEY_LAST_CHECK, nowMillis).apply()
    }

    companion object {
        const val AUTO_CHECK_INTERVAL_MS = 24L * 60 * 60 * 1000
        private const val FILE_NAME = "kelas_ka_update"
        private const val KEY_LAST_CHECK = "last_auto_check_at"
    }
}

/**
 * Cek otomatis boleh berjalan bila belum pernah, sudah lewat 24 jam, atau jam
 * perangkat mundur (supaya timestamp masa depan tidak mematikan cek selamanya).
 * Murni JVM agar bisa diuji.
 */
fun isAutoCheckDue(
    lastCheckAtMillis: Long,
    nowMillis: Long,
    intervalMillis: Long = UpdatePreferences.AUTO_CHECK_INTERVAL_MS,
): Boolean {
    if (lastCheckAtMillis <= 0L) return true
    if (nowMillis < lastCheckAtMillis) return true
    return nowMillis - lastCheckAtMillis >= intervalMillis
}
