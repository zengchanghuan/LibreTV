import Foundation

/// Both ZFPlayer sliders and horizontal gestures commit their seek through here.
/// Initial resume uses AVPlayer directly and is tracked separately.
final class HomeTVPlayerManager: ZFAVPlayerManager {
    var onSeek: ((Double) -> (() -> Void)?)?

    override func seek(toTime time: TimeInterval, completionHandler: ((Bool) -> Void)? = nil) {
        let finished = onSeek?(time)
        super.seek(toTime: time) { completed in
            DispatchQueue.main.async {
                // The position tracker binds this callback to its seek/episode,
                // so a cancelled older seek cannot clear a newer target.
                finished?()
                completionHandler?(completed)
            }
        }
    }
}
