package app.libretv.family

import org.junit.Assert.*
import org.junit.Test

class SleepTimerTest {
    @Test fun exactDeadlineAndDuplicateCallbacks() {
        var now = 1000L
        val timer = SleepTimer { now }
        assertFalse(timer.consumeExpired())
        timer.set(15)
        now += 899_999
        assertEquals(1, timer.minutesRemaining)
        assertFalse(timer.consumeExpired())
        now++
        assertTrue(timer.consumeExpired())
        assertFalse(timer.consumeExpired())
    }
    @Test fun suspendedTimerStopsOnNextCheck() {
        var now = 0L
        val timer = SleepTimer { now }
        timer.set(15)
        now = 3_600_000
        assertTrue(timer.consumeExpired())
        assertNull(timer.minutesRemaining)
    }
    @Test fun cancellationAndReplacement() {
        var now = 0L
        val timer = SleepTimer { now }
        timer.set(15); timer.set(0); now += 3_600_000
        assertFalse(timer.consumeExpired())
        timer.set(15); now += 600_000; timer.set(30); now += 900_000
        assertFalse(timer.consumeExpired())
        assertEquals(15, timer.minutesRemaining)
    }
}
