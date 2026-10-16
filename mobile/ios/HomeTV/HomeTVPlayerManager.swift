import Foundation
import AVFoundation

/// Both ZFPlayer sliders and horizontal gestures commit their seek through here.
/// Initial resume uses AVPlayer directly and is tracked separately.
final class HomeTVPlayerManager: ZFAVPlayerManager {
    // All library-triggered play/replay paths must respect the controller's
    // deadline and explicit user intent, including delayed seek completions.
    var canPlay: (() -> Bool)?
    override func play() {
        guard canPlay?() != false else { trace("play-blocked"); return }
        super.play()
        trace("play")
    }

    var onSeek: ((Double) -> (() -> Void)?)?

    override func seek(toTime time: TimeInterval, completionHandler: ((Bool) -> Void)? = nil) {
        let finished = onSeek?(time)
        let traceID = UUID().uuidString.prefix(8)
        let started = Date()
        trace("seek-start id=\(traceID) target=\(time)")
        super.seek(toTime: time) { [weak self] completed in
            DispatchQueue.main.async {
                // The position tracker binds this callback to its seek/episode,
                // so a cancelled older seek cannot clear a newer target.
                self?.trace("seek-end id=\(traceID) completed=\(completed) elapsed=\(Date().timeIntervalSince(started))")
                finished?()
                completionHandler?(completed)
            }
        }
    }
    /// Opt-in stdout diagnostics for a connected device; never include URLs,
    /// cookies, titles or server credentials. Release builds emit nothing.
    func trace(_ event: String) {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("--playback-diagnostics") else { return }
        let ranges = playerItem?.loadedTimeRanges.map { range -> String in
            let value = range.timeRangeValue
            return "\(value.start.seconds)+\(value.duration.seconds)"
        }.joined(separator: ",") ?? "none"
        print("HOMETV_PLAYBACK \(Date().timeIntervalSince1970) \(event) time=\(currentTime) duration=\(totalTime) intent=\(isPlaying) rate=\(player?.rate ?? 0) clock=\(player?.timeControlStatus.rawValue ?? -1) wait=\(player?.reasonForWaitingToPlay?.rawValue ?? "none") item=\(playerItem?.status.rawValue ?? -1) empty=\(playerItem?.isPlaybackBufferEmpty ?? false) likely=\(playerItem?.isPlaybackLikelyToKeepUp ?? false) load=\(loadState.rawValue) buffered=\(ranges)")
        fflush(stdout)
        #endif
    }
    override func pause() { super.pause(); trace("pause") }
    override func stop() { trace("stop"); super.stop() }

}
