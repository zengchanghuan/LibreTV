import Foundation

func runNativeNavigationTests() throws {
    let origin = (try testRequire(URL(string: "https://tv.example.com"), "Invalid navigation fixture URL"))
    func tab(_ path: String) throws -> Int? { NativeNavigation.tabIndex(for: (try testRequire(URL(string: path, relativeTo: origin), "Invalid navigation fixture URL")).absoluteURL, origin: origin) }
    try testCheck(try tab("/settings") == 3 && tab("/settings/") == 3 && tab("/settings/advanced") == 3)
    try testCheck(try tab("/about") == 3 && tab("/about/?section=privacy") == 3)
    try testCheck(try tab("/live") == 1 && tab("/live/") == 1 && tab("/live/channel?index=2") == 1)
    try testCheck(try tab("/watch?id=42") == 0 && tab("/?s=test") == 0,
           "Leaving live or settings for playback or home must highlight home")
    try testCheck(try tab("/settings-other") == 0 && tab("/about-other") == 0 && tab("/live-other") == 0)
    try testCheck(try tab("https://other.example.com/settings") == nil && tab("http://tv.example.com/settings") == nil && tab("https://tv.example.com:444/settings") == nil,
           "Foreign origins must not control the selected tab")
    for index in 0...3 {
        let destination = try testRequire(NativeNavigation.url(forTab: index, origin: origin), "Missing tab destination: \(index)")
        try testCheck(NativeNavigation.tabIndex(for: destination, origin: origin) == index,
               "Each tab destination must select its own item")
    }
    try testCheck(NativeNavigation.url(forTab: 1, origin: origin)?.path == "/live")
    try testCheck(NativeNavigation.url(forTab: 3, origin: origin)?.path == "/settings")
    try testCheck(NativeNavigation.url(forTab: -1, origin: origin) == nil && NativeNavigation.url(forTab: 4, origin: origin) == nil)
    let playing = (try testRequire(URL(string: "https://tv.example.com/live?url=https%3A%2F%2Fstream.example%2Flive.m3u8&name=BBC"), "Invalid navigation fixture URL"))
    for path in ["/live", "/live/", "/live/channel?index=2"] {
        let current = (try testRequire(URL(string: path, relativeTo: origin), "Invalid navigation fixture URL")).absoluteURL
        try testCheck(NativeNavigation.url(forTab: 1, origin: origin, currentURL: current) == nil,
               "Selecting the live tab again must preserve the current document")
    }
    for _ in 0..<3 {
        try testCheck(NativeNavigation.url(forTab: 1, origin: origin, currentURL: playing) == nil,
               "Repeated taps must keep the playing channel and page state")
    }
    for current in [origin, origin.appendingPathComponent("settings"), (try testRequire(URL(string: "https://other.example.com/live"), "Invalid navigation fixture URL"))] {
        try testCheck(NativeNavigation.url(forTab: 1, origin: origin, currentURL: current)?.path == "/live",
               "Entering live from another route or origin still navigates")
    }
    try testCheck(NativeNavigation.url(forTab: 1, origin: origin, currentURL: playing, retrying: true)?.path == "/live",
           "A failed live page must remain retryable")
    try testCheck(NativeNavigation.url(forTab: 0, origin: origin, currentURL: playing) == origin)
    try testCheck(NativeNavigation.url(forTab: 3, origin: origin, currentURL: playing)?.path == "/settings",
           "The other tabs must remain reachable during live playback")
    try testCheck(try tab("/hd") == 2 && tab("/hd/?s=test") == 2 && tab("/hd/collection") == 2)
    try testCheck(try tab("/hd-other") == 0, "Lookalike routes must not select HD")
    try testCheck(try tab("/watch?id=42&section=hd") == 2, "HD playback keeps its tab highlighted")
    try testCheck(try tab("/watch?id=42&section=other") == 0, "Unknown section keeps default navigation")
    let hd = origin.appendingPathComponent("hd")
    try testCheck(NativeNavigation.url(forTab: 2, origin: origin) == hd)
    try testCheck(NativeNavigation.url(forTab: 2, origin: origin, currentURL: hd) == nil, "Repeated HD taps keep search results")
    try testCheck(NativeNavigation.url(forTab: 2, origin: origin, currentURL: hd, retrying: true) == hd)
    let hdWatch = try testRequire(URL(string: "/watch?id=42&section=hd", relativeTo: origin)?.absoluteURL, "Invalid HD watch fixture")
    try testCheck(NativeNavigation.url(forTab: 2, origin: origin, currentURL: hdWatch) == hd, "HD tab must still leave a playback page")
    print("iOS native navigation: 21 regression scenarios passed")
}
