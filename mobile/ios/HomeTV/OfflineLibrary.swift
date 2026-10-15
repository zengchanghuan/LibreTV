import Foundation

struct OfflineVideo: Codable, Identifiable {
    enum State: String, Codable { case preparing, downloading, completed, failed }
    let id: String
    let title: String
    let sourceURL: String
    let origin: String
    var state: State = .preparing
    var progress: Double = 0
    var localPath: String?
    var bytes: Int64 = 0
    var position: Double = 0
    var watched = false
    var error: String?
    let createdAt: Date
}

/// Only native download callbacks may register files. Relative paths survive
/// iOS container relocation after an app update; no credentials are persisted.
final class OfflineLibrary {
    let home: URL
    let directory: URL
    private(set) var videos: [OfflineVideo]
    private var manifest: URL { directory.appendingPathComponent("library.json") }
    init(home: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)) throws {
        self.home = home.standardizedFileURL
        directory = self.home.appendingPathComponent("Library/Application Support/HomeTVOffline", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var excluded = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        let file = directory.appendingPathComponent("library.json")
        videos = FileManager.default.fileExists(atPath: file.path) ? try JSONDecoder().decode([OfflineVideo].self, from: Data(contentsOf: file)) : []
    }
    func video(_ id: String) -> OfflineVideo? { videos.first { $0.id == id } }
    func add(url: URL, title: String, origin: URL) throws -> OfflineVideo {
        if let existing = videos.first(where: { $0.sourceURL == url.absoluteString && $0.state != .failed }) { return existing }
        let video = OfflineVideo(id: UUID().uuidString, title: title, sourceURL: url.absoluteString, origin: origin.absoluteString, createdAt: Date())
        try save(videos + [video]); return video
    }
    func update(_ id: String, _ change: (inout OfflineVideo) -> Void) throws {
        guard let index = videos.firstIndex(where: { $0.id == id }) else { return }
        var next = videos; change(&next[index]); try save(next)
    }
    private func save(_ next: [OfflineVideo]) throws {
        try JSONEncoder().encode(next).write(to: manifest, options: .atomic)
        videos = next
    }
    // AVFoundation may return Apple's /.nofollow filesystem alias. Normalize
    // that alias before checking the container boundary and persisting paths.
    static func canonicalFile(_ file: URL) -> URL {
        guard file.isFileURL, file.path.hasPrefix("/.nofollow/") else { return file.resolvingSymlinksInPath() }
        return URL(fileURLWithPath: String(file.path.dropFirst("/.nofollow".count))).resolvingSymlinksInPath()
    }
    func relativePath(for file: URL) -> String? {
        let root = home.resolvingSymlinksInPath().path + "/"
        let path = Self.canonicalFile(file).path
        guard file.isFileURL, path.hasPrefix(root) else { return nil }
        let owned = path.hasPrefix(directory.resolvingSymlinksInPath().path + "/") && file.pathExtension.lowercased() == "mp4"
        guard owned || file.pathExtension.lowercased() == "movpkg" else { return nil }
        return String(path.dropFirst(root.count))
    }
    func fileURL(for video: OfflineVideo) -> URL? {
        guard let path = video.localPath, !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { return nil }
        let file = home.appendingPathComponent(path)
        guard relativePath(for: file) == path else { return nil }
        return file
    }
    func playableURL(_ id: String) -> URL? {
        guard let video = video(id), video.state == .completed, let file = fileURL(for: video), FileManager.default.fileExists(atPath: file.path) else { return nil }
        return file
    }
    func removeFile(_ id: String) throws {
        guard let video = video(id), let file = fileURL(for: video), FileManager.default.fileExists(atPath: file.path) else { return }
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
