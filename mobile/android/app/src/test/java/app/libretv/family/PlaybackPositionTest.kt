package app.libretv.family

import org.junit.Assert.*
import org.junit.Test

class PlaybackPositionTest {
    @Test fun proxyRetryUsesCurrentClockAfterResumingAndPlaying() {
        val progress = PlaybackPosition(listOf(600.0))
        progress.selectEpisode(0)
        progress.didRestore()
        progress.record(1195.0)
        progress.prepareRetry(1200.0)
        assertEquals(1200.0, progress.restorePosition, 0.0)
        assertEquals(1200.0, progress.savedPosition, 0.0)
        assertTrue(progress.isRestoring)
    }

    @Test fun failedRetryDoesNotReplaceTargetWithTemporaryZero() {
        val progress = PlaybackPosition(listOf(600.0))
        progress.selectEpisode(0)
        progress.didRestore()
        progress.prepareRetry(1200.0)
        progress.prepareRetry(0.0)
        assertEquals(1200.0, progress.restorePosition, 0.0)
    }

    @Test fun invalidFailedClockFallsBackToSavedProgress() {
        val progress = PlaybackPosition(listOf(600.0))
        progress.selectEpisode(0)
        progress.didRestore()
        progress.record(1195.0)
        for (clock in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0)) {
            progress.prepareRetry(clock)
            assertEquals(1195.0, progress.restorePosition, 0.0)
            progress.didRestore()
        }
    }

    @Test fun initialLoadFailureKeepsTheSelectedEpisodesResumePosition() {
        val progress = PlaybackPosition(listOf(600.0, 50.0))
        progress.selectEpisode(1)
        progress.prepareRetry(0.0)
        assertEquals(50.0, progress.restorePosition, 0.0)
    }

    @Test fun genuineSeekToStartIsPreserved() {
        val progress = PlaybackPosition(listOf(600.0))
        progress.selectEpisode(0)
        progress.didRestore()
        progress.prepareRetry(0.0)
        assertEquals(0.0, progress.restorePosition, 0.0)
    }

    @Test fun episodeSwitchAndCompletionKeepResumePositionsIndependent() {
        val progress = PlaybackPosition(listOf(600.0, 50.0))
        progress.selectEpisode(0)
        progress.didRestore()
        progress.prepareRetry(1200.0)
        progress.selectEpisode(1)
        assertEquals(50.0, progress.restorePosition, 0.0)
        progress.selectEpisode(0)
        assertEquals(1200.0, progress.restorePosition, 0.0)
        progress.didRestore()
        progress.record(0.0)
        progress.selectEpisode(1)
        progress.selectEpisode(0)
        assertEquals(0.0, progress.restorePosition, 0.0)
    }
}
