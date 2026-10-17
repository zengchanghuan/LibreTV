import Foundation
import AVFoundation

/// Both ZFPlayer sliders and horizontal gestures commit their seek through here.
/// Initial resume uses AVPlayer directly and is tracked separately.
final class HomeTVPlayerManager: ZFAVPlayerManager {
    // All library-triggered play/replay paths must respect the controller's
    // deadline and explicit user intent, including delayed seek completions.
    private let diagnosticID = UUID().uuidString
    var diagnosticContext: (() -> [String: String])?
    var canPlay: (() -> Bool)?
    override func play() {
        guard canPlay?() != false else { trace("play-blocked"); return }
        super.play()
        trace("play")
    }

    var onSeek: ((Double) -> (() -> Void)?)?
    private(set) var seekRevision = UUID()

    override func seek(toTime time: TimeInterval, completionHandler: ((Bool) -> Void)? = nil) {
        seekRevision = UUID()
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
    /// File logging works in Release without a connected Mac. Never include URLs,
    /// cookies, titles, server addresses or free-form AVFoundation error messages.
    func trace(_ event: String) {
        let ranges = playerItem?.loadedTimeRanges.prefix(8).map { range -> String in
            let value = range.timeRangeValue
            return "\(value.start.seconds)+\(value.duration.seconds)"
        }.joined(separator: ",") ?? "none"
        let access = playerItem?.accessLog()?.events.last
        var fields = diagnosticContext?() ?? [:]
        fields.merge([
            "player": diagnosticID, "position": "\(currentTime)", "duration": "\(totalTime)",
            "intent": "\(isPlaying)", "rate": "\(player?.rate ?? 0)",
            "clock": "\(player?.timeControlStatus.rawValue ?? -1)",
            "waiting": player?.reasonForWaitingToPlay?.rawValue ?? "none",
            "item": "\(playerItem?.status.rawValue ?? -1)",
            "empty": "\(playerItem?.isPlaybackBufferEmpty ?? false)",
            "likely": "\(playerItem?.isPlaybackLikelyToKeepUp ?? false)",
            "load": "\(loadState.rawValue)", "buffered": ranges,
            "observedBitrate": "\(access?.observedBitrate ?? -1)",
            "indicatedBitrate": "\(access?.indicatedBitrate ?? -1)",
            "bytes": "\(access?.numberOfBytesTransferred ?? -1)",
            "transferSeconds": "\(access?.transferDuration ?? -1)",
            "stalls": "\(access?.numberOfStalls ?? -1)",
            "transportError": "\(playerItem?.errorLog()?.events.last?.errorStatusCode ?? 0)",
            "itemError": "\((playerItem?.error as NSError?)?.code ?? 0)"
        ]) { _, new in new }
        PlaybackLogStore.shared.record(event, fields: fields)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--playback-diagnostics") {
            print("HOMETV_PLAYBACK \(Date().timeIntervalSince1970) \(event) \(fields)")
            fflush(stdout)
        }
        #endif
    }
    override func pause() { super.pause(); trace("pause") }
    override func stop() { seekRevision = UUID(); trace("stop"); super.stop() }

}
