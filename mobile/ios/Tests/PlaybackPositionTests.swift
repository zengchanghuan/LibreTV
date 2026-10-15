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
    let seeking = PlaybackPosition(positions: [4, 2])
    seeking.selectEpisode(0); seeking.didRestore()
    let firstSeek = seeking.beginSeek(to: 12)
    seeking.record(4)
    assert(seeking.savedPosition == 12 && seeking.position(currentTime: 4) == 12,
           "Pending seek must override stale periodic progress and exit/switch events")
    seeking.selectEpisode(1); seeking.didRestore()
    let secondSeek = seeking.beginSeek(to: 8)
    seeking.finishSeek(firstSeek)
    assert(seeking.position(currentTime: 2) == 8, "Old episode completion must not clear a new episode's pending seek")
    seeking.finishSeek(secondSeek)
    assert(seeking.position(currentTime: 9) == 9, "Completed seek must release progress to the advancing player clock")
    seeking.selectEpisode(0)
    assert(seeking.restorePosition == 12, "Switching back must resume at the committed seek target")
    seeking.didRestore()
    let olderSeek = seeking.beginSeek(to: 6)
    let latestSeek = seeking.beginSeek(to: 0)
    seeking.finishSeek(olderSeek)
    assert(seeking.position(currentTime: 12) == 0, "A newer seek to zero must survive cancellation of an older seek")
    seeking.prepareRetry(currentPosition: 12)
    assert(seeking.restorePosition == 0, "Retry must preserve an unfinished user seek")
    seeking.finishSeek(latestSeek); seeking.didRestore()
    assert(seeking.position(currentTime: 1) == 1, "A cancelled or completed seek must not freeze future progress")
    print("iOS playback position: 13 regression scenarios passed")
}
