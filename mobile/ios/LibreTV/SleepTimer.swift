import Foundation

/// Absolute deadline survives pauses and episode changes. Consume before any autoplay.
final class SleepTimer {
    private let now: () -> Date
    private var deadline: Date?
    init(now: @escaping () -> Date = Date.init) { self.now = now }
    func set(minutes: Int) { deadline = minutes > 0 ? now().addingTimeInterval(Double(minutes * 60)) : nil }
    var minutesRemaining: Int? { deadline.map { max(0, Int(ceil($0.timeIntervalSince(now()) / 60))) } }
    func consumeExpired() -> Bool {
        guard let deadline, now() >= deadline else { return false }
        self.deadline = nil
        return true
    }
}
