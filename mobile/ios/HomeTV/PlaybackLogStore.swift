import Foundation

/// Bounded, local-only JSON-lines diagnostics. All filesystem work is serial and
/// off the playback/UI thread. Callers supply only controlled events and metrics.
final class PlaybackLogStore {
    static let shared = PlaybackLogStore(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PlaybackLogs"))
    private let directory: URL
    private let maxBytes: Int
    private let fileCount: Int
    private let queue = DispatchQueue(label: "app.hometv.playback-log", qos: .utility)
    private let launchID = UUID().uuidString
    private var reportedFailure = false

    init(directory: URL, maxBytes: Int = 1_048_576, fileCount: Int = 4) {
        precondition(maxBytes > 0 && fileCount > 0)
        self.directory = directory; self.maxBytes = maxBytes; self.fileCount = fileCount
    }

    func record(_ event: String, fields: [String: String] = [:]) {
        let timestamp = Date().timeIntervalSince1970
        queue.async { [self] in
            do {
                let record: [String: Any] = ["time": timestamp, "launch": launchID, "event": event, "fields": fields]
                var data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
                data.append(0x0a)
                // A single pathological event must not defeat the storage cap.
                guard data.count <= min(maxBytes, 16_384) else { return }
                let fm = FileManager.default
                try fm.createDirectory(at: directory, withIntermediateDirectories: true)
                var dir = directory
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try dir.setResourceValues(values)
                let current = file(0)
                let size = (try? fm.attributesOfItem(atPath: current.path)[.size] as? NSNumber)?.intValue ?? 0
                if size + data.count > maxBytes {
                    if fm.fileExists(atPath: file(fileCount - 1).path) { try fm.removeItem(at: file(fileCount - 1)) }
                    if fileCount > 1 {
                        for index in stride(from: fileCount - 2, through: 0, by: -1) {
                            if fm.fileExists(atPath: file(index).path) { try fm.moveItem(at: file(index), to: file(index + 1)) }
                        }
                    }
                }
                if !fm.fileExists(atPath: current.path) {
                    var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o600]
                    #if os(iOS)
                    attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
                    #endif
                    guard fm.createFile(atPath: current.path, contents: nil, attributes: attributes) else { throw CocoaError(.fileWriteUnknown) }
                }
                let handle = try FileHandle(forWritingTo: current)
                defer { try? handle.close() }
                try handle.seekToEnd(); try handle.write(contentsOf: data)
                reportedFailure = false
            } catch {
                // Disk failures must never interrupt playback; retry on next event.
                if !reportedFailure { NSLog("HomeTV playback log write failed (code %ld)", (error as NSError).code) }
                reportedFailure = true
            }
        }
    }

    /// Drain pending records for deterministic tests; production uses async flush.
    func flush() { queue.sync {} }
    func flush(completion: @escaping () -> Void) {
        queue.async { DispatchQueue.main.async(execute: completion) }
    }
    private func file(_ index: Int) -> URL { directory.appendingPathComponent("playback-\(index).jsonl") }
}
