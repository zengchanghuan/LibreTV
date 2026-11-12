import Foundation

func runOfflineLibraryTests() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("offline-tests-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let library = try OfflineLibrary(home: root)
    let source = try testRequire(URL(string: "https://media.example/movie.mp4"), "Source URL")
    let origin = try testRequire(URL(string: "https://home.example"), "Origin URL")
    let video = try library.add(url: source, title: "测试影片", origin: origin)
    let duplicate = try library.add(url: source, title: "测试影片", origin: origin)
    try testCheck(duplicate.id == video.id && library.videos.count == 1, "Repeated download must not duplicate active tasks")
    let file = library.directory.appendingPathComponent(video.id + ".mp4")
    try Data(repeating: 1, count: 64).write(to: file)
    let relative = try testRequire(library.relativePath(for: file), "Owned media path")
    let alias = URL(fileURLWithPath: "/.nofollow" + file.path)
    try testCheck(library.relativePath(for: alias) == relative, "AVFoundation nofollow aliases must resolve within the app container")
    try testCheck(library.relativePath(for: URL(fileURLWithPath: "/.nofollow/tmp/other.movpkg")) == nil, "Normalizing aliases must not admit external files")
    try library.update(video.id) { $0.localPath = relative; $0.state = .downloading }
    try testCheck(library.playableURL(video.id) == nil, "Partial files cannot be opened as completed downloads")
    try library.update(video.id) { $0.state = .completed; $0.bytes = 64 }
    let restored = try OfflineLibrary(home: root)
    try testCheck(restored.playableURL(video.id)?.path == file.path, "Completed file survives manifest reload")
    try restored.record(video.id, position: 12.5, ended: false)
    try restored.record(video.id, position: .nan, ended: false)
    try testCheck(try OfflineLibrary(home: root).video(video.id)?.position == 12.5, "Resume position persists and rejects invalid clocks")
    try restored.record(video.id, position: 0, ended: true)
    try testCheck(restored.video(video.id)?.watched == true && FileManager.default.fileExists(atPath: file.path), "Watching to the end marks watched, never deletes automatically")
    try testCheck(library.relativePath(for: root.appendingPathComponent("Documents/notes.txt")) == nil, "Never register arbitrary user files")
    try testCheck(library.relativePath(for: root.deletingLastPathComponent().appendingPathComponent("outside.movpkg")) == nil, "Reject outside-container packages")
    try restored.update(video.id) { $0.localPath = "../../outside.movpkg" }
    try testCheck(restored.fileURL(for: try testRequire(restored.video(video.id), "Stored video")) == nil, "Reject traversal paths from metadata")
    try restored.update(video.id) { $0.localPath = relative }
    try restored.remove(video.id)
    try testCheck(!FileManager.default.fileExists(atPath: file.path) && restored.videos.isEmpty, "Delete removes both bytes and record")
    try restored.update(video.id) { $0.state = .completed }
    try testCheck(try OfflineLibrary(home: root).videos.isEmpty, "Late callbacks must not resurrect deleted tasks")
    let stale = try restored.add(url: source, title: "缺失文件", origin: origin)
    try restored.update(stale.id) { $0.state = .completed; $0.localPath = relative }
    try testCheck(restored.playableURL(stale.id) == nil, "Missing files cannot be advertised as playable")
    // Stable episode identities survive signed URL rotation and retain failed records.
    let group = OfflineIdentity.group(origin: origin, source: "source-a", video: "season-2")
    let identity = OfflineIdentity.episode(group: group, index: 3)
    let first = try restored.add(url: source, title: "第四集", origin: origin, identity: identity, groupID: group)
    try restored.update(first.id) { $0.state = .failed; $0.attempt = "old" }
    let rotated = try restored.add(url: URL(string: "https://media.example/movie.mp4?token=new")!, title: "第四集", origin: origin, identity: identity, groupID: group)
    try testCheck(rotated.id == first.id && rotated.sourceURL.contains("token=new"), "Retry and URL rotation reuse the same record")
    let other = try restored.add(url: source, title: "第五集", origin: origin, identity: OfflineIdentity.episode(group: group, index: 4), groupID: group)
    try testCheck(other.id != first.id, "Distinct episodes must not collide even if their transient URL matches")
    try testCheck(OfflineIdentity.key(["a|b", "c"]) != OfflineIdentity.key(["a", "b|c"]), "Identity framing is collision safe")
    var queue = (0..<5).map { index -> OfflineVideo in
        var item = OfflineVideo(id: String(index), title: "电影", sourceURL: source.absoluteString, origin: origin.absoluteString, createdAt: Date(timeIntervalSince1970: 100))
        item.order = Double(index); return item
    }
    try testCheck(OfflineQueue.candidates(queue, limit: 2).map(\.id) == ["0", "1"], "Default concurrency starts only two")
    queue[0].state = .preparing; queue[1].state = .downloading
    try testCheck(OfflineQueue.candidates(queue, limit: 2).isEmpty, "Preparation and transfer share the same slots")
    queue[0].state = .paused
    try testCheck(OfflineQueue.candidates(queue, limit: 2).map(\.id) == ["2"], "Pausing frees a slot without resuming the paused item")
    queue[2].retryAfter = Date(timeIntervalSince1970: 500)
    queue[4].order = -1
    try testCheck(OfflineQueue.candidates(queue, limit: 2, now: Date(timeIntervalSince1970: 200)).map(\.id) == ["4"], "Priority wins while retry backoff is respected")
    queue[1].state = .failed; queue[3].state = .waitingForNetwork
    try testCheck(OfflineQueue.candidates(queue, limit: 3, now: Date(timeIntervalSince1970: 600)).map(\.id) == ["4", "2"], "Failed, paused and network-waiting tasks cannot start")
    let package = root.appendingPathComponent("Library/Caches/system-download.asset")
    let assetPath = try testRequire(restored.relativePath(for: package, systemAsset: true), "System asset package path")
    try restored.update(other.id) { $0.localPath = assetPath; $0.systemAsset = true }
    try testCheck(restored.fileURL(for: try testRequire(restored.video(other.id), "Asset record")) == OfflineLibrary.canonicalFile(package), "System asset package survives reconstruction")
    try testCheck(restored.relativePath(for: root.appendingPathComponent("Documents/private.dat"), systemAsset: true) == nil, "System callback cannot register arbitrary Documents files")
    let link = root.appendingPathComponent("Library/escape")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root.deletingLastPathComponent())
    try testCheck(restored.relativePath(for: link.appendingPathComponent("outside.asset"), systemAsset: true) == nil, "Symlink escapes remain rejected")
    try restored.update(other.id) { $0.attempt = "new"; $0.state = .paused }
    let persisted = try OfflineLibrary(home: root)
    try testCheck(persisted.video(other.id)?.state == .paused && persisted.video(other.id)?.token == other.id + "|new", "Pause and attempt generation persist across relaunch")
    let legacyRoot = root.appendingPathComponent("legacy")
    let legacy = try OfflineLibrary(home: legacyRoot)
    var failed1 = OfflineVideo(id: "old-1", title: "第一集", sourceURL: source.absoluteString, origin: origin.absoluteString, createdAt: Date())
    failed1.state = .failed
    var failed2 = failed1; failed2 = OfflineVideo(id: "old-2", title: failed1.title, sourceURL: failed1.sourceURL, origin: failed1.origin, createdAt: Date()); failed2.state = .failed
    let legacyManifest = legacy.directory.appendingPathComponent("library.json")
    try JSONEncoder().encode([failed1, failed2]).write(to: legacyManifest)
    let migrated = try OfflineLibrary(home: legacyRoot)
    try testCheck(migrated.videos.count == 1, "Legacy duplicate failures without files are merged")
    let object = try JSONSerialization.jsonObject(with: Data(contentsOf: legacyManifest)) as? [String: Any]
    try testCheck(object?["version"] as? Int == 2, "Migration writes an explicit manifest version")
    let manifest = library.directory.appendingPathComponent("library.json")
    try Data("broken".utf8).write(to: manifest)
    var rejected = false
    do { _ = try OfflineLibrary(home: root) } catch { rejected = true }
    try testCheck(rejected, "Corrupt manifests must surface an error instead of silently losing downloads")
    print("iOS offline library / queue: 28 checks passed")
}
