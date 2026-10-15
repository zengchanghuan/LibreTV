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
    let manifest = library.directory.appendingPathComponent("library.json")
    try Data("broken".utf8).write(to: manifest)
    var rejected = false
    do { _ = try OfflineLibrary(home: root) } catch { rejected = true }
    try testCheck(rejected, "Corrupt manifests must surface an error instead of silently losing downloads")
    print("iOS offline library: 14 scenarios passed")
}
