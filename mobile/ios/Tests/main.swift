import Foundation

do {
    if CommandLine.arguments.contains("--inject-check-failure") {
        try testCheck(false, "Injected expectation failure")
    }
    if CommandLine.arguments.contains("--inject-missing-value") {
        let absent: Int? = nil
        _ = try testRequire(absent, "Injected missing value")
    }
    if CommandLine.arguments.contains("--inject-wrong-type") {
        let wrong: Any = "not an integer"
        _ = try testRequire(wrong as? Int, "Injected wrong type")
    }

    var now = Date(timeIntervalSince1970: 1000)
    let timer = SleepTimer(now: { now })
    try testCheck(!timer.consumeExpired())
    timer.set(minutes: 15)
    now += 899
    try testCheck(timer.minutesRemaining == 1 && !timer.consumeExpired())
    now += 1
    try testCheck(timer.consumeExpired(), "Deadline wins at the exact end boundary")
    try testCheck(!timer.consumeExpired(), "A delayed tick or duplicate completion must not stop twice")
    timer.set(minutes: 30)
    now += 3600
    try testCheck(timer.consumeExpired(), "Foreground resume must catch an expired suspended timer")
    timer.set(minutes: 15)
    timer.set(minutes: 0)
    now += 3600
    try testCheck(timer.minutesRemaining == nil && !timer.consumeExpired())
    timer.set(minutes: 15)
    now += 600
    timer.set(minutes: 30)
    now += 900
    try testCheck(!timer.consumeExpired() && timer.minutesRemaining == 15, "Replacing a timer starts a new deadline")
    print("iOS sleep timer: 5 scenarios passed")
    try runPlaybackPositionTests()
    try runNativeNavigationTests()
    try runOfflineLibraryTests()
    try runPlaybackLogStoreTests()
} catch {
    FileHandle.standardError.write(Data("REGRESSION_FAILED: \(error)\n".utf8))
    exit(1)
}
