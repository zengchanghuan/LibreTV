import Foundation

func runNativeNavigationTests() {
    let origin = URL(string: "https://tv.example.com")!
    func tab(_ path: String) -> Int? { NativeNavigation.tabIndex(for: URL(string: path, relativeTo: origin)!.absoluteURL, origin: origin) }
    assert(tab("/settings") == 2 && tab("/settings/") == 2 && tab("/settings/advanced") == 2)
    assert(tab("/about") == 2 && tab("/about/?section=privacy") == 2)
    assert(tab("/live") == 1 && tab("/live/") == 1 && tab("/live/channel?index=2") == 1)
    assert(tab("/watch?id=42") == 0 && tab("/?s=test") == 0,
           "Leaving live or settings for playback or home must highlight home")
    assert(tab("/settings-other") == 0 && tab("/about-other") == 0 && tab("/live-other") == 0)
    assert(tab("https://other.example.com/settings") == nil && tab("http://tv.example.com/settings") == nil && tab("https://tv.example.com:444/settings") == nil,
           "Foreign origins must not control the selected tab")
    for index in 0...2 {
        let destination = NativeNavigation.url(forTab: index, origin: origin)!
        assert(NativeNavigation.tabIndex(for: destination, origin: origin) == index,
               "Each tab destination must select its own item")
    }
    assert(NativeNavigation.url(forTab: 1, origin: origin)?.path == "/live")
    assert(NativeNavigation.url(forTab: 2, origin: origin)?.path == "/settings")
    assert(NativeNavigation.url(forTab: -1, origin: origin) == nil && NativeNavigation.url(forTab: 3, origin: origin) == nil)
    let playing = URL(string: "https://tv.example.com/live?url=https%3A%2F%2Fstream.example%2Flive.m3u8&name=BBC")!
    for path in ["/live", "/live/", "/live/channel?index=2"] {
        let current = URL(string: path, relativeTo: origin)!.absoluteURL
        assert(NativeNavigation.url(forTab: 1, origin: origin, currentURL: current) == nil,
               "Selecting the live tab again must preserve the current document")
    }
    for _ in 0..<3 {
        assert(NativeNavigation.url(forTab: 1, origin: origin, currentURL: playing) == nil,
               "Repeated taps must keep the playing channel and page state")
    }
    for current in [origin, origin.appendingPathComponent("settings"), URL(string: "https://other.example.com/live")!] {
        assert(NativeNavigation.url(forTab: 1, origin: origin, currentURL: current)?.path == "/live",
               "Entering live from another route or origin still navigates")
    }
    assert(NativeNavigation.url(forTab: 1, origin: origin, currentURL: playing, retrying: true)?.path == "/live",
           "A failed live page must remain retryable")
    assert(NativeNavigation.url(forTab: 0, origin: origin, currentURL: playing) == origin)
    assert(NativeNavigation.url(forTab: 2, origin: origin, currentURL: playing)?.path == "/settings",
           "The other tabs must remain reachable during live playback")
    print("iOS native navigation: 13 regression scenarios passed")
}
