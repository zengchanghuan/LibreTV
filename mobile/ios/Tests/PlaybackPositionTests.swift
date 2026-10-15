import Foundation

func runPlaybackPositionTests() {
    let progress = PlaybackPosition(positions: [600, 50])
    progress.selectEpisode(0)
    progress.didRestore()
    progress.record(1195) // Last periodic save before a failure at 20 minutes.
    progress.prepareRetry(currentPosition: 1200)
    assert(progress.restorePosition == 1200 && progress.savedPosition == 1200,
           "Mid-playback proxy retry must use the current clock, not the initial 600-second resume or last periodic save")

    // A retry can fail before its seek finishes: its temporary zero is not progress.
    progress.prepareRetry(currentPosition: 0)
    assert(progress.restorePosition == 1200 && progress.isRestoring,
           "Failure during restoration must preserve the retry target")

    progress.didRestore()
    progress.record(1300)
    progress.prepareRetry(currentPosition: .nan)
    assert(progress.restorePosition == 1300, "An invalid failed-item clock must fall back to the last saved position")
    progress.didRestore()
    progress.prepareRetry(currentPosition: -.infinity)
    assert(progress.restorePosition == 1300)

    progress.selectEpisode(1)
    progress.prepareRetry(currentPosition: 0)
    assert(progress.restorePosition == 50 && progress.savedPosition == 50,
           "A failure before initial playback must preserve this episode's independent resume position")

    progress.didRestore()
    progress.prepareRetry(currentPosition: 0)
    assert(progress.restorePosition == 0, "A genuine seek back to the start must not restore stale progress")

    progress.selectEpisode(0)
    assert(progress.restorePosition == 1300, "Switching episodes must not overwrite another episode's progress")
    progress.didRestore()
    progress.record(0) // Natural completion clears this episode's resume position.
    progress.selectEpisode(1)
    progress.selectEpisode(0)
    assert(progress.restorePosition == 0, "Completed episodes must restart from zero")
    print("iOS playback position: 6 regression scenarios passed")
}
