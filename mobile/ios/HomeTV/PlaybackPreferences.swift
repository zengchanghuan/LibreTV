import Foundation

/// Device-local preferences. Legacy explicit choices are preserved independently.
struct PlaybackPreferences {
    let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    var smallWindow: Bool {
        get {
            if defaults.object(forKey: "playback.smallWindow") != nil { return defaults.bool(forKey: "playback.smallWindow") }
            let legacy = defaults.string(forKey: "playback.backgroundMode")
            return legacy == nil || legacy == "pictureInPicture"
        }
        nonmutating set { defaults.set(newValue, forKey: "playback.smallWindow"); notify() }
    }
    var backgroundAudio: Bool {
        get {
            if defaults.object(forKey: "playback.backgroundAudio") != nil { return defaults.bool(forKey: "playback.backgroundAudio") }
            return defaults.string(forKey: "playback.backgroundMode") == "audio"
        }
        nonmutating set { defaults.set(newValue, forKey: "playback.backgroundAudio"); notify() }
    }
    func permitsBackground(pictureInPicture: Bool, startingPictureInPicture: Bool) -> Bool {
        backgroundAudio || (smallWindow && (pictureInPicture || startingPictureInPicture))
    }
    private func notify() { NotificationCenter.default.post(name: .backgroundPlaybackChanged, object: nil) }
}
extension Notification.Name { static let backgroundPlaybackChanged = Notification.Name("HomeTVBackgroundPlaybackChanged") }
