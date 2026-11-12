import Foundation
import AVFoundation
import Network
import WebKit

/// Commands, metadata writes and delegates are serialized on the main queue.
/// Network transfers belong to system background sessions, not to the player.
final class OfflineDownloads: NSObject, AVAssetDownloadDelegate, URLSessionDownloadDelegate {
    static let shared = OfflineDownloads()
    static let changed = Notification.Name("HomeTVOfflineChanged")
    private(set) var library: OfflineLibrary?
    private(set) var storageError: String?
    private var tasks: [String: URLSessionTask] = [:]
    private var preparations: [String: Task<Void, Never>] = [:]
    private var retiredLocations: [String: URL] = [:]
    private var backgroundCompletions: [String: () -> Void] = [:]
    private var restoring = false, restored = false, scheduling = false
    private var networkReady = false, connected = false, wifi = false
    private var retryTimer: Timer?
    private let monitor = NWPathMonitor()
    private let defaults: UserDefaults
    private let prefix = (Bundle.main.bundleIdentifier ?? "app.libretv.family") + ".offline."
    private lazy var hlsWiFi = assetSession("wifi.hls", cellular: false)
    private lazy var hlsCellular = assetSession("cellular.hls", cellular: true)
    private lazy var filesWiFi = URLSession(configuration: configuration("wifi.files", cellular: false), delegate: self, delegateQueue: .main)
    private lazy var filesCellular = URLSession(configuration: configuration("cellular.files", cellular: true), delegate: self, delegateQueue: .main)
    // Keep old identifiers long enough to reconcile downloads from previous versions.
    private lazy var legacyHLS = assetSession("hls", cellular: true)
    private lazy var legacyFiles = URLSession(configuration: configuration("files", cellular: true), delegate: self, delegateQueue: .main)
    private var sessions: [URLSession] { [hlsWiFi, hlsCellular, filesWiFi, filesCellular, legacyHLS, legacyFiles] }
    var concurrency: Int { min(3, max(1, defaults.object(forKey: "offline.concurrency") as? Int ?? 2)) }
    var allowsCellular: Bool { defaults.bool(forKey: "offline.cellular") }
    var videos: [OfflineVideo] { (library?.videos ?? []).sorted { ($0.order ?? $0.createdAt.timeIntervalSince1970) < ($1.order ?? $1.createdAt.timeIntervalSince1970) } }
    var availableBytes: Int64? {
        guard let home = library?.home else { return nil }
        if let value = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage { return value }
        return (try? FileManager.default.attributesOfFileSystem(forPath: home.path)[.systemFreeSize] as? NSNumber)?.int64Value
    }
    private var mayDownload: Bool { networkReady && connected && (allowsCellular || wifi) }
    override convenience init() { self.init(defaults: .standard) }
    init(defaults: UserDefaults) {
        self.defaults = defaults
        super.init()
        do { library = try OfflineLibrary() } catch { storageError = "无法读取缓存记录：\(error.localizedDescription)" }
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self else { return }
                self.networkReady = true; self.connected = path.status == .satisfied
                self.wifi = path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet)
                self.schedule()
            }
        }
        monitor.start(queue: DispatchQueue(label: "app.hometv.offline-network"))
    }
    private func configuration(_ suffix: String, cellular: Bool) -> URLSessionConfiguration {
        let config = URLSessionConfiguration.background(withIdentifier: prefix + suffix)
        config.isDiscretionary = false; config.sessionSendsLaunchEvents = true
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.allowsCellularAccess = cellular
        config.httpMaximumConnectionsPerHost = 2
        return config
    }
    private func assetSession(_ suffix: String, cellular: Bool) -> AVAssetDownloadURLSession {
        AVAssetDownloadURLSession(configuration: configuration(suffix, cellular: cellular), assetDownloadDelegate: self, delegateQueue: .main)
    }
    private func notify() { NotificationCenter.default.post(name: Self.changed, object: self) }
    @discardableResult private func update(_ id: String, _ change: (inout OfflineVideo) -> Void) -> Bool {
        do { guard let library else { return false }; try library.update(id, change); notify(); return true }
        catch { storageError = "无法保存缓存记录：\(error.localizedDescription)"; notify(); return false }
    }
    func restore() {
        guard !restoring, !restored else { return }; restoring = true
        let group = DispatchGroup(); var active: [URLSessionTask] = []
        for session in sessions {
            group.enter(); session.getAllTasks { items in DispatchQueue.main.async { active += items; group.leave() } }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            for task in active {
                guard let video = self.current(task), (video.isScheduled || video.state == .paused), self.tasks[video.id] == nil else { task.cancel(); continue }
                self.tasks[video.id] = task
                // Restore suspended tasks without undoing an explicit user pause.
                if task.state == .running { task.suspend() }
                if video.state != .paused { self.update(video.id) { $0.state = .queued } }
            }
            for video in self.videos {
                if video.state == .verifying { self.verify(video, hls: video.systemAsset == true); continue }
                if [.preparing, .downloading].contains(video.state), self.tasks[video.id] == nil {
                    self.update(video.id) { $0.state = .queued; $0.progress = 0; $0.note = "任务已中断，将重新缓存" }
                }
            }
            self.restoring = false; self.restored = true; self.schedule()
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
    func setConcurrency(_ value: Int) {
        defaults.set(min(3, max(1, value)), forKey: "offline.concurrency")
        let active = videos.filter { [.preparing, .downloading].contains($0.state) }
        for video in active.dropFirst(concurrency) { suspend(video.id, state: .queued) }
        schedule()
    }
    func setAllowsCellular(_ allowed: Bool) {
        defaults.set(allowed, forKey: "offline.cellular")
        // Session policy is immutable. Recreate incompatible tasks with the new policy.
        for video in videos where video.state != .completed && video.state != .failed && (tasks[video.id] != nil || preparations[video.id] != nil) {
            restart(video.id, state: video.state == .paused ? .paused : .queued)
        }
        schedule()
    }
    @discardableResult func enqueue(url: URL, title: String, origin: URL, cookies: [HTTPCookie], identity: String? = nil, groupID: String? = nil, groupTitle: String? = nil, episodeTitle: String? = nil) throws -> String {
        guard let library else { throw DownloadError.message(storageError ?? "缓存存储不可用") }
        guard ["https", "http"].contains(url.scheme), url.host != nil, url.user == nil, url.password == nil, url.absoluteString.count <= 8192, !title.isEmpty, title.count <= 600 else { throw DownloadError.message("缓存地址无效") }
        let video = try library.add(url: url, title: title, origin: origin, identity: identity, groupID: groupID, groupTitle: groupTitle, episodeTitle: episodeTitle)
        if video.state == .failed { restart(video.id, state: .queued) }
        restore(); schedule(); notify(); return video.id
    }
    func pause(_ id: String) { suspend(id, state: .paused); schedule() }
    func resume(_ id: String) {
        guard let video = library?.video(id), [.paused, .failed].contains(video.state) else { return }
        if video.state == .failed { restart(id, state: .queued) }
        else { update(id) { $0.state = .queued; $0.retryAfter = nil } }
        schedule()
    }
    func redownload(_ id: String) { restart(id, state: .queued); schedule() }
    func prioritize(_ id: String) {
        guard let video = library?.video(id), [.queued, .waitingForNetwork].contains(video.state) else { return }
        let first = videos.map { $0.order ?? $0.createdAt.timeIntervalSince1970 }.min() ?? 0
        update(id) { $0.order = first - 1 }; schedule()
    }
    func pauseAll() {
        for video in videos where video.isScheduled { suspend(video.id, state: .paused) }
        schedule()
    }
    func resumeAll() {
        for video in videos where video.state == .paused { update(video.id) { $0.state = .queued; $0.retryAfter = nil } }
        schedule()
    }
    private func suspend(_ id: String, state: OfflineVideo.State) {
        guard let video = library?.video(id), video.isScheduled else { return }
        guard update(id, { $0.state = state }) else { return }
        preparations.removeValue(forKey: id)?.cancel()
        if let task = tasks[id], task.state == .running { task.suspend() }
    }
    private func restart(_ id: String, state: OfflineVideo.State) {
        guard let video = library?.video(id) else { return }
        if let file = library?.fileURL(for: video), tasks[id] != nil { retiredLocations[video.token] = file }
        guard update(id, { $0.attempt = UUID().uuidString; $0.state = state; $0.localPath = nil; $0.progress = 0; $0.bytes = 0; $0.error = nil; $0.detail = nil; $0.retries = 0; $0.retryAfter = nil; $0.note = video.progress > 0 ? "正在重新缓存" : nil }) else { return }
        preparations.removeValue(forKey: id)?.cancel()
        tasks.removeValue(forKey: id)?.cancel()
        if let file = library?.fileURL(for: video) { clean(file) }
    }
    private func schedule() {
        guard restored, !scheduling, library != nil, storageError == nil else { return }
        scheduling = true; defer { scheduling = false; armRetry() }
        if !mayDownload {
            for video in videos where video.isScheduled { suspend(video.id, state: .waitingForNetwork) }
            notify(); return
        }
        for video in videos where video.state == .waitingForNetwork { update(video.id) { $0.state = .queued } }
        while storageError == nil, let video = OfflineQueue.candidates(videos, limit: concurrency).first {
            if let space = availableBytes, space < 200 * 1024 * 1024 {
                fail(video.id, DownloadError.message("手机空间不足，请先清理缓存")); continue
            }
            if let task = tasks[video.id] {
                if video.cellular != allowsCellular { restart(video.id, state: .queued); start(video.id) }
                else if update(video.id, { $0.state = .downloading }) { task.resume() }
            } else { start(video.id) }
        }
    }
    private func armRetry() {
        retryTimer?.invalidate(); retryTimer = nil
        guard mayDownload, let next = videos.filter({ $0.state == .queued }).compactMap(\.retryAfter).filter({ $0 > Date() }).min() else { return }
        retryTimer = Timer.scheduledTimer(withTimeInterval: max(0.1, next.timeIntervalSinceNow), repeats: false) { [weak self] _ in self?.schedule() }
    }
    private func start(_ id: String) {
        guard let video = library?.video(id) else { return }
        guard let url = URL(string: video.sourceURL), let origin = URL(string: video.origin) else { fail(id, DownloadError.message("缓存地址无效，请重新选择来源")); return }
        let attempt = UUID().uuidString
        guard update(id, { $0.state = .preparing; $0.attempt = attempt; $0.cellular = allowsCellular; $0.error = nil; $0.detail = nil }) else { return }
        preparations[id] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if self.library?.video(id)?.attempt == attempt { self.preparations[id] = nil }; self.schedule() }
            do {
                // Fetch current authentication at execution time, not when a long queue was added.
                let cookies: [HTTPCookie] = await withCheckedContinuation { continuation in
                    WKWebsiteDataStore.default().httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
                }
                guard !Task.isCancelled else { return }
                let (media, kind) = try await self.prepare(url: url, origin: origin, cookies: cookies)
                guard !Task.isCancelled, let current = self.library?.video(id), current.attempt == attempt, current.state == .preparing else { return }
                // Remove an interrupted partial only after the replacement source resolves.
                try self.library?.removeFile(id)
                guard self.update(id, { $0.localPath = nil; $0.systemAsset = kind == "hls"; $0.progress = 0 }) else { return }
                let task: URLSessionTask
                if kind == "hls" {
                    let options: [String: Any] = sameOrigin(media, origin) ? [AVURLAssetHTTPCookiesKey: cookies] : [:]
                    let asset = AVURLAsset(url: media, options: options)
                    task = (self.allowsCellular ? self.hlsCellular : self.hlsWiFi).makeAssetDownloadTask(downloadConfiguration: AVAssetDownloadConfiguration(asset: asset, title: video.title))
                } else {
                    task = (self.allowsCellular ? self.filesCellular : self.filesWiFi).downloadTask(with: self.request(media, origin: origin, cookies: cookies))
                }
                task.taskDescription = current.token
                guard self.update(id, { $0.state = .downloading }) else { task.cancel(); return }
                self.tasks[id] = task; task.resume()
            } catch {
                if !Task.isCancelled, self.library?.video(id)?.attempt == attempt { self.fail(id, error) }
            }
        }
    }
    private func request(_ url: URL, origin: URL, cookies: [HTTPCookie]) -> URLRequest {
        var request = URLRequest(url: url); request.timeoutInterval = 30; request.allowsCellularAccess = allowsCellular
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
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.allowsCellularAccess = allowsCellular
        let session = URLSession(configuration: config, delegate: DownloadRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var media = url
        if sameOrigin(media, origin), media.path == "/api/site-playback" {
            let (data, response) = try await session.data(for: request(media, origin: origin, cookies: cookies))
            guard (response as? HTTPURLResponse)?.statusCode == 200, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], let raw = object["url"] as? String, let resolved = URL(string: raw), ["http", "https"].contains(resolved.scheme), resolved.host != nil, resolved.user == nil, resolved.password == nil else { throw DownloadError.message("无法取得缓存地址，请返回影片重新选择来源") }
            media = resolved
        }
        let (stream, response) = try await session.bytes(for: request(media, origin: origin, cookies: cookies))
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else { throw DownloadError.message("片源拒绝缓存，请更换来源") }
        var prefix = Data()
        for try await byte in stream { prefix.append(byte); if prefix.count >= 256 { break } }
        let text = String(data: prefix, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.hasPrefix("#EXTM3U") { return (media, "hls") }
        if prefix.count >= 8 && String(data: prefix[4..<8], encoding: .ascii) == "ftyp" { return (media, "mp4") }
        throw DownloadError.message("此来源不是可缓存的 HLS／MP4 视频，请更换来源")
    }
    func delete(_ id: String) throws {
        if let video = library?.video(id), let file = library?.fileURL(for: video), tasks[id] != nil { retiredLocations[video.token] = file }
        try library?.remove(id)
        preparations.removeValue(forKey: id)?.cancel(); tasks.removeValue(forKey: id)?.cancel()
        notify(); schedule()
    }
    private func current(_ task: URLSessionTask) -> OfflineVideo? {
        guard let token = task.taskDescription, let id = token.split(separator: "|").first.map(String.init), let video = library?.video(id), video.token == token else { return nil }
        return video
    }
    private func fail(_ id: String, _ error: Error) {
        guard let video = library?.video(id) else { return }
        let e = error as NSError
        let transient = e.domain == NSURLErrorDomain && [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed].contains(e.code)
        let retry = transient && (video.retries ?? 0) < 3
        let message: String
        if error is DownloadError { message = error.localizedDescription }
        else if e.domain == NSCocoaErrorDomain && e.code == NSFileWriteOutOfSpaceError { message = "手机空间不足，请先清理缓存" }
        else if transient { message = "网络连接中断，可重试" }
        else { message = "缓存失败，请重试或更换来源" }
        // Invalidate first so cancellation/verification callbacks cannot change the new attempt.
        if let file = library?.fileURL(for: video), tasks[id] != nil { retiredLocations[video.token] = file }
        let retries = (video.retries ?? 0) + 1
        guard update(id, { $0.attempt = UUID().uuidString; $0.state = retry ? .queued : .failed; $0.error = message; $0.detail = "\(e.domain) (\(e.code)): \(e.localizedDescription)"; $0.retries = retries; $0.retryAfter = retry ? Date().addingTimeInterval(pow(2, Double(retries))) : nil; $0.note = retry ? "网络中断，稍后自动重试" : nil; $0.localPath = nil; $0.progress = 0 }) else { return }
        preparations.removeValue(forKey: id)?.cancel()
        tasks.removeValue(forKey: id)?.cancel()
        if let file = library?.fileURL(for: video) { clean(file) }
        schedule()
    }
    func record(_ id: String, event: [String: Any]) {
        do { try library?.record(id, position: event["position"] as? Double ?? 0, ended: event["ended"] as? Bool ?? false) } catch { storageError = error.localizedDescription }
        notify()
    }
    private func clean(_ file: URL) {
        guard let library, library.relativePath(for: file, systemAsset: true) != nil,
              !library.videos.contains(where: { library.fileURL(for: $0) == file }), FileManager.default.fileExists(atPath: file.path) else { return }
        do { try FileManager.default.removeItem(at: file) } catch { storageError = "清理缓存文件失败：\(error.localizedDescription)"; notify() }
    }
    private func register(_ location: URL, task: URLSessionTask, hls: Bool) throws {
        let location = OfflineLibrary.canonicalFile(location)
        guard let library, let path = library.relativePath(for: location, systemAsset: hls) else {
            PlaybackLogStore.shared.record("offline-location-rejected", fields: ["extension": location.pathExtension, "isFile": String(location.isFileURL), "inContainer": String(location.path.hasPrefix(OfflineLibrary.canonicalFile(URL(fileURLWithPath: NSHomeDirectory())).path + "/"))])
            throw DownloadError.message("文件保存失败：系统缓存位置无法识别")
        }
        guard let video = current(task), video.state != .failed, video.state != .completed else { clean(location); return }
        try library.update(video.id) { $0.localPath = path; $0.systemAsset = hls }
        PlaybackLogStore.shared.record("offline-location", fields: ["extension": location.pathExtension, "callback": hls ? "hls" : "file"])
    }
    @available(iOS 18.0, *)
    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask, willDownloadTo location: URL) {
        do { try register(location, task: assetDownloadTask, hls: true) } catch { if let video = current(assetDownloadTask) { fail(video.id, error) } }
    }
    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask, didFinishDownloadingTo location: URL) {
        do { try register(location, task: assetDownloadTask, hls: true) } catch { if let video = current(assetDownloadTask) { fail(video.id, error) } }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let video = current(downloadTask), video.state != .failed, let library else { return }
        do {
            guard let response = downloadTask.response as? HTTPURLResponse, (200...299).contains(response.statusCode) else { throw DownloadError.message("片源返回错误，请重试或更换来源") }
            let file = library.directory.appendingPathComponent(video.id + "-" + (video.attempt ?? "legacy") + ".mp4")
            try FileManager.default.moveItem(at: location, to: file)
            do { try register(file, task: downloadTask, hls: false) } catch { clean(file); throw error }
        } catch { fail(video.id, error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let token = task.taskDescription, let file = retiredLocations.removeValue(forKey: token) { clean(file) }
        guard let video = current(task), video.state != .completed, video.state != .failed else { return }
        tasks[video.id] = nil
        if let error { fail(video.id, error); return }
        guard update(video.id, { $0.state = .verifying }) else { return }
        verify(library!.video(video.id)!, hls: task is AVAssetDownloadTask)
        schedule()
    }
    private func verify(_ video: OfflineVideo, hls: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                guard let file = self.library?.fileURL(for: video), FileManager.default.fileExists(atPath: file.path) else { throw DownloadError.message("文件保存失败，请重新缓存") }
                let asset = AVURLAsset(url: file)
                guard !hls || asset.assetCache?.isPlayableOffline == true else { throw DownloadError.message("片源未完整保存，请重试或更换来源") }
                guard try await asset.load(.isPlayable) else { throw DownloadError.message("缓存文件无法播放，请更换来源") }
                guard self.library?.video(video.id)?.token == video.token, self.library?.video(video.id)?.state == .verifying else { return }
                var excluded = file; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
                let bytes = Self.size(of: file)
                self.update(video.id) { $0.state = .completed; $0.progress = 1; $0.bytes = bytes; $0.error = nil; $0.detail = nil; $0.note = nil }
            } catch {
                if self.library?.video(video.id)?.token == video.token, self.library?.video(video.id)?.state == .verifying { self.fail(video.id, error) }
            }
        }
    }
    static func size(of url: URL) -> Int64 {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .fileSizeKey]
        if let values = try? url.resourceValues(forKeys: keys), values.isRegularFile == true { return Int64(values.fileSize ?? 0) }
        guard let files = FileManager.default.enumerator(at: url, includingPropertiesForKeys: Array(keys)) else { return 0 }
        return files.compactMap { $0 as? URL }.reduce(0) { sum, file in
            guard let values = try? file.resourceValues(forKeys: keys), values.isRegularFile == true else { return sum }
            return sum + Int64(values.fileSize ?? 0)
        }
    }
    private func progress(_ task: URLSessionTask, _ value: Double) {
        guard let video = current(task), video.state == .downloading, value.isFinite, value - video.progress >= 0.01 else { return }
        update(video.id) { $0.progress = min(0.99, max(0, value)) }
        if let space = availableBytes, space < 50 * 1024 * 1024 { fail(video.id, DownloadError.message("手机空间不足，请先清理缓存")) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesExpectedToWrite > 0 { progress(downloadTask, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) }
    }
    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask, didLoad timeRange: CMTimeRange, totalTimeRangesLoaded ranges: [NSValue], timeRangeExpectedToLoad expected: CMTimeRange) {
        let duration = expected.duration.seconds
        // Merge overlapping HLS ranges; summing them can report misleading progress.
        let sorted = ranges.map(\.timeRangeValue).map { ($0.start.seconds, $0.end.seconds) }.filter { $0.0.isFinite && $0.1.isFinite }.sorted { $0.0 < $1.0 }
        var end = -Double.infinity, loaded = 0.0
        for range in sorted { loaded += max(0, range.1 - max(range.0, end)); end = max(end, range.1) }
        if duration > 0 { progress(assetDownloadTask, loaded / duration) }
    }
    deinit { monitor.cancel(); retryTimer?.invalidate() }
}

enum DownloadError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(text) = self { return text }; return nil }
}
private final class DownloadRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let target = request.url, ["http", "https"].contains(target.scheme), target.user == nil, target.password == nil else { completionHandler(nil); return }
        var next = request
        if response.url.map({ !sameOrigin($0, target) }) != false { next.setValue(nil, forHTTPHeaderField: "Cookie"); next.setValue(nil, forHTTPHeaderField: "Authorization") }
        completionHandler(next)
    }
}
