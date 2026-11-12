import Foundation

struct OfflineVideo: Codable, Identifiable {
    enum State: String, Codable { case queued, preparing, downloading, paused, waitingForNetwork, verifying, completed, failed }
    let id: String
    let title: String
    var sourceURL: String
    let origin: String
    var state: State = .queued
    var progress: Double = 0
    var localPath: String?
    var bytes: Int64 = 0
    var position: Double = 0
    var watched = false
    var error: String?
    let createdAt: Date
    // Optional fields keep legacy records readable without inventing identities.
    var identity: String?
    var groupID: String?
    var groupTitle: String?
    var episodeTitle: String?
    var order: Double?
    var attempt: String?
    var cellular: Bool?
    var systemAsset: Bool?
    var detail: String?
    var retries: Int?
    var retryAfter: Date?
    var note: String?
    var token: String { attempt.map { id + "|" + $0 } ?? id }
    var isScheduled: Bool { [.queued, .preparing, .downloading, .waitingForNetwork].contains(state) }
}

struct OfflineIdentity {
    static func key(_ parts: [String]) -> String {
        // JSON framing avoids collisions from source identifiers containing separators.
        String(data: try! JSONEncoder().encode(parts), encoding: .utf8)!
    }
    static func group(origin: URL, source: String, video: String) -> String { key([origin.absoluteString, source, video]) }
    static func episode(group: String, index: Int) -> String { key([group, String(index)]) }
}

/// Pure scheduling policy; preparation occupies the same slot as a transfer.
struct OfflineQueue {
    static func candidates(_ videos: [OfflineVideo], limit: Int, now: Date = Date()) -> [OfflineVideo] {
        let occupied = videos.filter { [.preparing, .downloading].contains($0.state) }.count
        return Array(videos.filter { $0.state == .queued && ($0.retryAfter ?? .distantPast) <= now }
            .sorted { ($0.order ?? $0.createdAt.timeIntervalSince1970) < ($1.order ?? $1.createdAt.timeIntervalSince1970) }
            .prefix(max(0, min(3, max(1, limit)) - occupied)))
    }
}

/// Only native callbacks register HLS paths. Relative paths survive container relocation.
final class OfflineLibrary {
    private struct Manifest: Codable { var version: Int; var videos: [OfflineVideo] }
    let home: URL
    let directory: URL
    private(set) var videos: [OfflineVideo]
    private var manifest: URL { directory.appendingPathComponent("library.json") }
    init(home: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)) throws {
        self.home = Self.canonicalFile(home)
        directory = self.home.appendingPathComponent("Library/Application Support/HomeTVOffline", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var excluded = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        let file = directory.appendingPathComponent("library.json")
        if FileManager.default.fileExists(atPath: file.path) {
            let data = try Data(contentsOf: file)
            if let legacy = try? JSONDecoder().decode([OfflineVideo].self, from: data) { videos = legacy }
            else {
                let saved = try JSONDecoder().decode(Manifest.self, from: data)
                guard saved.version == 2 else { throw CocoaError(.fileReadUnknown) }
                videos = saved.videos
            }
        } else { videos = [] }
        // Only prune failed records without files, and only with an exact identity/URL match.
        let original = videos
        var seen = Set(original.filter { $0.state != .failed }.map(Self.dedupKey))
        videos = original.filter { video in
            guard video.state == .failed, video.localPath == nil else { return true }
            return seen.insert(Self.dedupKey(video)).inserted
        }
        try save(videos)
    }
    private static func dedupKey(_ video: OfflineVideo) -> String { video.identity ?? OfflineIdentity.key([video.origin, video.sourceURL]) }
    func video(_ id: String) -> OfflineVideo? { videos.first { $0.id == id } }
    func matching(url: URL, origin: URL, identity: String?) -> OfflineVideo? {
        videos.first { video in
            if let identity, let stored = video.identity { return stored == identity }
            return video.origin == origin.absoluteString && video.sourceURL == url.absoluteString
        }
    }
    func add(url: URL, title: String, origin: URL, identity: String? = nil, groupID: String? = nil, groupTitle: String? = nil, episodeTitle: String? = nil) throws -> OfflineVideo {
        if let existing = matching(url: url, origin: origin, identity: identity) {
            try update(existing.id) { $0.sourceURL = url.absoluteString; if $0.identity == nil { $0.identity = identity; $0.groupID = groupID; $0.groupTitle = groupTitle; $0.episodeTitle = episodeTitle } }
            return video(existing.id)!
        }
        var video = OfflineVideo(id: UUID().uuidString, title: title, sourceURL: url.absoluteString, origin: origin.absoluteString, createdAt: Date())
        video.identity = identity; video.groupID = groupID; video.groupTitle = groupTitle; video.episodeTitle = episodeTitle
        video.order = max(Date().timeIntervalSince1970, (videos.compactMap(\.order).max() ?? 0) + 1)
        try save(videos + [video]); return video
    }
    func update(_ id: String, _ change: (inout OfflineVideo) -> Void) throws {
        guard let index = videos.firstIndex(where: { $0.id == id }) else { return }
        var next = videos; change(&next[index]); try save(next)
    }
    private func save(_ next: [OfflineVideo]) throws {
        try JSONEncoder().encode(Manifest(version: 2, videos: next)).write(to: manifest, options: .atomic)
        videos = next
    }
    static func canonicalFile(_ file: URL) -> URL {
        guard file.isFileURL else { return file }
        let path = file.path.hasPrefix("/.nofollow/") ? String(file.path.dropFirst("/.nofollow".count)) : file.path
        var ancestor = URL(fileURLWithPath: path).standardizedFileURL
        var suffix: [String] = []
        // Foundation may leave symlinks unresolved when the final file does not exist yet.
        // willDownloadTo runs before creation, so resolve the nearest existing ancestor.
        while ancestor.path != "/", !FileManager.default.fileExists(atPath: ancestor.path) {
            suffix.insert(ancestor.lastPathComponent, at: 0); ancestor.deleteLastPathComponent()
        }
        return suffix.reduce(ancestor.resolvingSymlinksInPath()) { $0.appendingPathComponent($1) }
    }
    func relativePath(for file: URL, systemAsset: Bool = false) -> String? {
        guard file.isFileURL else { return nil }
        let root = Self.canonicalFile(home).path + "/"
        let normalized = Self.canonicalFile(file), path = normalized.path
        guard path.hasPrefix(root) else { return nil }
        let owned = path.hasPrefix(Self.canonicalFile(directory).path + "/") && normalized.pathExtension.lowercased() == "mp4"
        // AVFoundation also returns .asset packages; do not assume .movpkg only.
        // Broader Library paths are accepted only for a system-issued callback.
        let hls = normalized.pathExtension.lowercased() == "movpkg" || normalized.pathExtension.lowercased() == "asset"
        let registered = systemAsset && path.hasPrefix(root + "Library/") && !path.hasPrefix(Self.canonicalFile(directory).path + "/")
        guard owned || hls || registered else { return nil }
        return String(path.dropFirst(root.count))
    }
    func fileURL(for video: OfflineVideo) -> URL? {
        guard let path = video.localPath, !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { return nil }
        let file = home.appendingPathComponent(path)
        guard relativePath(for: file, systemAsset: video.systemAsset == true) == path else { return nil }
        return file
    }
    func playableURL(_ id: String) -> URL? {
        guard let video = video(id), video.state == .completed, let file = fileURL(for: video), FileManager.default.fileExists(atPath: file.path) else { return nil }
        return file
    }
    func removeFile(_ id: String) throws {
        guard let video = video(id), let file = fileURL(for: video), FileManager.default.fileExists(atPath: file.path) else { return }
        // Legacy duplicates may refer to a shared package. Never remove another record's file.
        guard !videos.contains(where: { $0.id != id && fileURL(for: $0) == file }) else { return }
        try FileManager.default.removeItem(at: file)
    }
    func remove(_ id: String) throws {
        try removeFile(id)
        try save(videos.filter { $0.id != id })
    }
    func record(_ id: String, position: Double, ended: Bool) throws {
        guard position.isFinite, position >= 0 else { return }
        try update(id) { $0.position = ended ? 0 : position; if ended { $0.watched = true } }
    }
}
