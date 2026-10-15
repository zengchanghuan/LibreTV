import Foundation
import AVFoundation

/// Delegate callbacks and UI commands run on the main queue. System background
/// sessions own network transfers; only metadata and progress live in memory.
final class OfflineDownloads: NSObject, AVAssetDownloadDelegate, URLSessionDownloadDelegate {
    static let shared = OfflineDownloads()
    static let changed = Notification.Name("HomeTVOfflineChanged")
    private(set) var library: OfflineLibrary?
    private(set) var storageError: String?
    private var tasks: [String: URLSessionTask] = [:]
    private var locations: [String: URL] = [:]
    private var preparations: [String: Task<Void, Never>] = [:]
    private var backgroundCompletions: [String: () -> Void] = [:]
    private var restored = false
    private let prefix = (Bundle.main.bundleIdentifier ?? "app.libretv.family") + ".offline."
    private lazy var hls = AVAssetDownloadURLSession(configuration: configuration("hls"), assetDownloadDelegate: self, delegateQueue: .main)
    private lazy var files = URLSession(configuration: configuration("files"), delegate: self, delegateQueue: .main)
    private func configuration(_ suffix: String) -> URLSessionConfiguration {
        let config = URLSessionConfiguration.background(withIdentifier: prefix + suffix)
        config.isDiscretionary = false; config.sessionSendsLaunchEvents = true
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.httpMaximumConnectionsPerHost = 2
        return config
    }
    override init() {
        super.init()
        do { library = try OfflineLibrary() } catch { storageError = "无法读取手机下载记录：\(error.localizedDescription)" }
    }
    var videos: [OfflineVideo] { (library?.videos ?? []).sorted { $0.createdAt > $1.createdAt } }
    private func notify() { NotificationCenter.default.post(name: Self.changed, object: self) }
    private func update(_ id: String, _ change: (inout OfflineVideo) -> Void) {
        do { try library?.update(id, change) } catch { storageError = "无法保存下载记录：\(error.localizedDescription)" }
        notify()
    }
    func restore() {
        guard !restored else { return }; restored = true
        let group = DispatchGroup(); var active: [URLSessionTask] = []
        for session: URLSession in [hls, files] {
            group.enter(); session.getAllTasks { items in DispatchQueue.main.async { active += items; group.leave() } }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            for task in active {
                guard let id = task.taskDescription, let video = self.library?.video(id), video.state == .downloading else { task.cancel(); continue }
                self.tasks[id] = task
                if let file = self.library?.fileURL(for: video) { self.locations[id] = file }
                task.resume()
            }
            for video in self.videos where [.preparing, .downloading].contains(video.state) && self.tasks[video.id] == nil && self.preparations[video.id] == nil {
                self.fail(video.id, "下载已中断，请重新下载")
            }
            self.notify()
        }
    }
    func handleBackground(_ identifier: String, completion: @escaping () -> Void) {
        guard identifier.hasPrefix(prefix) else { completion(); return }
        backgroundCompletions[identifier] = completion; restore()
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        guard let id = session.configuration.identifier else { return }
        backgroundCompletions.removeValue(forKey: id)?()
    }
    @discardableResult func enqueue(url: URL, title: String, origin: URL, cookies: [HTTPCookie]) throws -> String {
        guard let library else { throw DownloadError.message(storageError ?? "下载存储不可用") }
        guard ["https", "http"].contains(url.scheme), url.host != nil, url.user == nil, url.password == nil, url.absoluteString.count <= 8192, !title.isEmpty, title.count <= 600 else { throw DownloadError.message("下载地址无效") }
        restore()
        let video = try library.add(url: url, title: title, origin: origin)
        guard video.state == .preparing, preparations[video.id] == nil, tasks[video.id] == nil else { return video.id }
        preparations[video.id] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.preparations[video.id] = nil }
            do {
                let (media, kind) = try await self.prepare(url: url, origin: origin, cookies: cookies)
                guard !Task.isCancelled, self.library?.video(video.id) != nil else { return }
                let task: URLSessionTask
                if kind == "hls" {
                    let options: [String: Any] = sameOrigin(media, origin) ? [AVURLAssetHTTPCookiesKey: cookies] : [:]
                    let asset = AVURLAsset(url: media, options: options)
                    task = self.hls.makeAssetDownloadTask(downloadConfiguration: AVAssetDownloadConfiguration(asset: asset, title: title))
                } else {
                    task = self.files.downloadTask(with: self.request(media, origin: origin, cookies: cookies))
                }
                task.taskDescription = video.id; self.tasks[video.id] = task
                self.update(video.id) { $0.state = .downloading }
                task.resume()
            } catch { if !Task.isCancelled { self.fail(video.id, Self.failureText(error)) } }
        }
        notify(); return video.id
    }
    private func request(_ url: URL, origin: URL, cookies: [HTTPCookie]) -> URLRequest {
        var request = URLRequest(url: url); request.timeoutInterval = 30
        if sameOrigin(url, origin) {
            let matching = cookies.filter { cookie in
                let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
                return (url.host == domain || url.host?.hasSuffix("." + domain) == true) && url.path.hasPrefix(cookie.path) && (!cookie.isSecure || url.scheme == "https")
            }
            request.allHTTPHeaderFields = HTTPCookie.requestHeaderFields(with: matching)
        }
        return request
    }
    private func prepare(url: URL, origin: URL, cookies: [HTTPCookie]) async throws -> (URL, String) {
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        let session = URLSession(configuration: config, delegate: DownloadRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var media = url
        if sameOrigin(media, origin), media.path == "/api/site-playback" {
            let (data, response) = try await session.data(for: request(media, origin: origin, cookies: cookies))
            guard (response as? HTTPURLResponse)?.statusCode == 200, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], let raw = object["url"] as? String, let resolved = URL(string: raw), ["http", "https"].contains(resolved.scheme), resolved.host != nil, resolved.user == nil, resolved.password == nil else { throw DownloadError.message("无法取得下载地址，请返回影片重新选择来源") }
            media = resolved
        }
        // Inspect a bounded prefix rather than buffering a movie in memory.
        let (stream, response) = try await session.bytes(for: request(media, origin: origin, cookies: cookies))
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else { throw DownloadError.message("片源拒绝下载，请更换来源") }
        var prefix = Data()
        for try await byte in stream { prefix.append(byte); if prefix.count >= 256 { break } }
        let text = String(data: prefix, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.hasPrefix("#EXTM3U") { return (media, "hls") }
        if prefix.count >= 8 && String(data: prefix[4..<8], encoding: .ascii) == "ftyp" { return (media, "mp4") }
        throw DownloadError.message("此来源不是可下载的 HLS／MP4 视频，请更换来源")
    }
    func delete(_ id: String) throws {
        // Keep the native path until cancellation finishes in case the system
        // writes one final chunk after the first removal.
        if tasks[id] != nil, let video = library?.video(id), let file = library?.fileURL(for: video) { locations[id] = file }
        // Remove record first: late completion callbacks must never resurrect it.
        try library?.remove(id)
        preparations.removeValue(forKey: id)?.cancel()
        tasks.removeValue(forKey: id)?.cancel()
        notify()
    }
    private static func failureText(_ error: Error) -> String {
        let e = error as NSError
        return "\(e.localizedDescription) (\(e.domain): \(e.code))"
    }
    private func fail(_ id: String, _ message: String) {
        do { try library?.removeFile(id) } catch { storageError = "清理失败的下载时出错：\(error.localizedDescription)" }
        update(id) { $0.state = .failed; $0.error = message; $0.progress = 0 }
    }
    func record(_ id: String, event: [String: Any]) {
        do { try library?.record(id, position: event["position"] as? Double ?? 0, ended: event["ended"] as? Bool ?? false) } catch { storageError = error.localizedDescription }
        notify()
    }
    private func register(_ location: URL, id: String) throws {
        let location = OfflineLibrary.canonicalFile(location)
        guard let library, let path = library.relativePath(for: location) else { throw DownloadError.message("下载文件位置无效") }
        locations[id] = location
        guard library.video(id) != nil else {
            if FileManager.default.fileExists(atPath: location.path) { try FileManager.default.removeItem(at: location) }; return
        }
        try library.update(id) { $0.localPath = path }
        if FileManager.default.fileExists(atPath: location.path) {
            var excluded = location; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
        }
    }
    @available(iOS 18.0, *)
    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask, willDownloadTo location: URL) {
        guard let id = assetDownloadTask.taskDescription else { return }
        do { try register(location, id: id) } catch { fail(id, Self.failureText(error)) }
    }
    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = assetDownloadTask.taskDescription else { return }
        do { try register(location, id: id) } catch { fail(id, Self.failureText(error)) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription, let library, library.video(id) != nil else { return }
        do {
            guard let response = downloadTask.response as? HTTPURLResponse, (200...299).contains(response.statusCode) else { throw DownloadError.message("下载失败：服务器返回错误") }
            let file = library.directory.appendingPathComponent(id + ".mp4")
            try FileManager.default.moveItem(at: location, to: file)
            try register(file, id: id)
        } catch { fail(id, Self.failureText(error)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription else { return }
        tasks[id] = nil
        guard let video = library?.video(id) else {
            if let file = locations.removeValue(forKey: id), library?.relativePath(for: file) != nil, FileManager.default.fileExists(atPath: file.path) {
                do { try FileManager.default.removeItem(at: file) } catch { storageError = "清理已取消下载时出错：\(error.localizedDescription)"; notify() }
            }
            return
        }
        locations[id] = nil
        if let error { fail(id, video.error ?? Self.failureText(error)); return }
        guard video.state != .failed, let file = library?.fileURL(for: video), FileManager.default.fileExists(atPath: file.path) else { fail(id, video.error ?? "下载未完成，请重新下载（没有本地文件位置）"); return }
        if task is AVAssetDownloadTask, AVURLAsset(url: file).assetCache?.isPlayableOffline != true { fail(id, "片源未完整保存，不能离线观看，请更换来源"); return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                guard try await AVURLAsset(url: file).load(.isPlayable) else { throw DownloadError.message("下载文件无法播放，请更换来源") }
                guard self.library?.video(id)?.state == .downloading else { return }
                var excluded = file; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
                let size = Self.size(of: file)
                self.update(id) { $0.state = .completed; $0.progress = 1; $0.bytes = size; $0.error = nil }
            } catch { self.fail(id, Self.failureText(error)) }
        }
    }
    static func size(of url: URL) -> Int64 {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .fileSizeKey]
        if let values = try? url.resourceValues(forKeys: keys), values.isRegularFile == true { return Int64(values.fileSize ?? 0) }
        guard let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: Array(keys)) else { return 0 }
        var bytes: Int64 = 0
        for case let file as URL in files { if let values = try? file.resourceValues(forKeys: keys), values.isRegularFile == true { bytes += Int64(values.fileSize ?? 0) } }
        return bytes
    }
    private func progress(_ id: String?, _ value: Double) {
        guard let id, let video = library?.video(id), video.state == .downloading, value.isFinite, value - video.progress >= 0.01 else { return }
        update(id) { $0.progress = min(0.99, max(0, value)) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesExpectedToWrite > 0 { progress(downloadTask.taskDescription, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) }
    }
    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask, didLoad timeRange: CMTimeRange, totalTimeRangesLoaded ranges: [NSValue], timeRangeExpectedToLoad expected: CMTimeRange) {
        let duration = expected.duration.seconds
        if duration > 0 { progress(assetDownloadTask.taskDescription, ranges.reduce(0) { $0 + $1.timeRangeValue.duration.seconds } / duration) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(DownloadRedirects.sanitized(response: response, request: request))
    }
}

enum DownloadError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(text) = self { return text }; return nil }
}
private final class DownloadRedirects: NSObject, URLSessionTaskDelegate {
    static func sanitized(response: HTTPURLResponse, request: URLRequest) -> URLRequest? {
        guard let target = request.url, ["http", "https"].contains(target.scheme), target.user == nil, target.password == nil else { return nil }
        var next = request
        if response.url.map({ !sameOrigin($0, target) }) != false { next.setValue(nil, forHTTPHeaderField: "Cookie"); next.setValue(nil, forHTTPHeaderField: "Authorization") }
        return next
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(Self.sanitized(response: response, request: request)) }
}
