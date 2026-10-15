package app.libretv.family

import kotlin.math.ceil

/** Absolute deadline survives pauses and episode changes. Consume before any autoplay. */
class SleepTimer(private val now: () -> Long = System::currentTimeMillis) {
    private var deadline: Long? = null
    fun set(minutes: Int) { deadline = if (minutes > 0) now() + minutes * 60_000L else null }
    val minutesRemaining: Int? get() = deadline?.let { ceil((it - now()).coerceAtLeast(0) / 60_000.0).toInt() }
    fun consumeExpired(): Boolean {
        val due = deadline ?: return false
        if (now() < due) return false
        deadline = null
        return true
    }
}
