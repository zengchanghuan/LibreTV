import Foundation

func runPlaybackPreferencesTests() throws {
    let suite = "hometv-preferences-test-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let preferences = PlaybackPreferences(defaults: defaults)
    try testCheck(preferences.smallWindow && !preferences.backgroundAudio, "New install defaults: small window on, background audio off")
    try testCheck(!preferences.permitsBackground(pictureInPicture: false, startingPictureInPicture: false), "Default must not fallback to background audio")
    try testCheck(preferences.permitsBackground(pictureInPicture: true, startingPictureInPicture: false), "Active default PiP may play")
    preferences.backgroundAudio = true
    try testCheck(preferences.smallWindow && preferences.backgroundAudio, "Audio toggle must not disable PiP")
    preferences.smallWindow = false
    try testCheck(!preferences.smallWindow && preferences.permitsBackground(pictureInPicture: false, startingPictureInPicture: false), "Independent audio mode")
    preferences.backgroundAudio = false
    try testCheck(!preferences.permitsBackground(pictureInPicture: true, startingPictureInPicture: true), "Disabled PiP cannot grant background playback")
    let reloaded = PlaybackPreferences(defaults: defaults)
    try testCheck(!reloaded.smallWindow && !reloaded.backgroundAudio, "Device preferences persist")
    defaults.removeObject(forKey: "playback.smallWindow"); defaults.removeObject(forKey: "playback.backgroundAudio")
    for (legacy, pip, audio) in [("pictureInPicture", true, false), ("audio", false, true), ("pause", false, false)] {
        defaults.set(legacy, forKey: "playback.backgroundMode")
        try testCheck(preferences.smallWindow == pip && preferences.backgroundAudio == audio, "Preserve explicit legacy choice: " + legacy)
    }
    print("iOS playback preferences: 10 scenarios passed")
}
