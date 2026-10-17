import Foundation

func runPlaybackLogStoreTests() throws {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("playback-log-tests-" + UUID().uuidString)
    defer { try? fm.removeItem(at: root) }
    func records(_ directory: URL) throws -> [[String: Any]] {
        try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "jsonl" }.flatMap { url in
                try String(contentsOf: url, encoding: .utf8).split(separator: "\n").map {
                    try testRequire(JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any], "Valid log record")
                }
            }
    }
    let persistent = root.appendingPathComponent("persistent")
    let first = PlaybackLogStore(directory: persistent)
    first.record("seek-start", fields: ["target": "120", "test": "换行\n引号\""])
    first.flush()
    let initial = try records(persistent)
    try testCheck(initial.count == 1 && (initial[0]["fields"] as? [String: String])?["test"] == "换行\n引号\"", "JSON lines preserve Unicode and escape embedded newlines")
    let reopened = PlaybackLogStore(directory: persistent)
    reopened.record("pause"); reopened.flush()
    let persisted = try records(persistent)
    try testCheck(persisted.count == 2 && persisted[0]["launch"] as? String != persisted[1]["launch"] as? String, "Reopening appends and distinguishes process sessions")
    let permissions = try fm.attributesOfItem(atPath: persistent.appendingPathComponent("playback-0.jsonl").path)[.posixPermissions] as? NSNumber
    try testCheck(permissions?.intValue == 0o600, "Log files are owner-only")

    let rotated = root.appendingPathComponent("rotated")
    let small = PlaybackLogStore(directory: rotated, maxBytes: 512, fileCount: 3)
    for index in 0..<100 { small.record("tick", fields: ["sequence": "\(index)"]) }
    small.flush()
    let files = try fm.contentsOfDirectory(at: rotated, includingPropertiesForKeys: [.fileSizeKey])
    try testCheck(files.count == 3 && (try files.allSatisfy { try $0.resourceValues(forKeys: [.fileSizeKey]).fileSize! <= 512 }), "Rotation enforces per-file and total storage bounds")
    let retained = try records(rotated)
    let numbers = retained.compactMap { ($0["fields"] as? [String: String])?["sequence"].flatMap(Int.init) }
    try testCheck(numbers.max() == 99 && numbers.min()! > 0 && Set(numbers).count == numbers.count, "Rotation retains newest complete records without duplication")
    small.record(String(repeating: "x", count: 1000)); small.flush()
    try testCheck(try records(rotated).count == retained.count, "Oversized single event cannot defeat storage cap")

    let concurrentDirectory = root.appendingPathComponent("concurrent")
    let concurrent = PlaybackLogStore(directory: concurrentDirectory)
    DispatchQueue.concurrentPerform(iterations: 100) { index in concurrent.record("tick", fields: ["sequence": "\(index)"]) }
    concurrent.flush()
    let concurrentRecords = try records(concurrentDirectory)
    try testCheck(concurrentRecords.count == 100 && Set(concurrentRecords.compactMap { ($0["fields"] as? [String: String])?["sequence"] }).count == 100, "Concurrent callbacks produce complete independent records")

    let blocked = root.appendingPathComponent("blocked")
    try Data("not a directory".utf8).write(to: blocked)
    let recoverable = PlaybackLogStore(directory: blocked)
    recoverable.record("cannot-write"); recoverable.flush()
    try fm.removeItem(at: blocked)
    recoverable.record("storage-recovered"); recoverable.flush()
    try testCheck(try records(blocked).first?["event"] as? String == "storage-recovered", "Write errors do not crash or disable later logging")
    print("iOS playback file logs: 8 scenarios passed")
}
