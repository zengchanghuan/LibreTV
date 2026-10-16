import UIKit
import AVFoundation

final class PlayerController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    var session: PlaybackSession
    let origin: URL
    let cookies: [HTTPCookie]
    var onProgress: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?
    private let engine = HomeTVPlayerManager()
    private let surface = UIView()
    private let controls = HomeTVPlayerControls()
    private var player: ZFPlayerController!
    private var tick: Timer?
    private var resolveTask: Task<Void, Never>?
    private var generation = UUID(), sequence = 0, ticks = 0
    private let sleepTimer: SleepTimer
    private var userPaused = false, sleeping = false, closed = false, finished = false
    private var stoppedDuration: Double?
    private var resolvedURL: URL?, proxied = false
    private var episodePicker: UIViewController?
    private var returnOrientation: UIInterfaceOrientationMask?
    private let playbackPosition: PlaybackPosition

    init(session: PlaybackSession, origin: URL, cookies: [HTTPCookie], sleepTimer: SleepTimer = SleepTimer()) {
        self.sleepTimer = sleepTimer
        self.session = session; self.origin = origin; self.cookies = cookies; self.playbackPosition = PlaybackPosition(positions: session.episodes.map(\.position))
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Geometry requests affect the whole scene, so remember the page's
        // orientation once, before the player can rotate it (including sheets).
        guard returnOrientation == nil else { return }
        let scene = presentingViewController?.view.window?.windowScene ?? view.window?.windowScene
        switch scene?.interfaceOrientation {
        case .landscapeLeft: returnOrientation = .landscapeLeft
        case .landscapeRight: returnOrientation = .landscapeRight
        case .portraitUpsideDown: returnOrientation = .portraitUpsideDown
        default: returnOrientation = .portrait
        }
    }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        surface.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(surface)
        NSLayoutConstraint.activate([surface.topAnchor.constraint(equalTo: view.topAnchor), surface.bottomAnchor.constraint(equalTo: view.bottomAnchor), surface.leadingAnchor.constraint(equalTo: view.leadingAnchor), surface.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        engine.shouldAutoPlay = false
        engine.canPlay = { [weak self] in
            guard let self, !self.closed, !self.sleeping else { return false }
            return !self.checkDeadline() && !self.userPaused && !self.playbackPosition.isRestoring
        }
        player = ZFPlayerController(playerManager: engine, containerView: surface)
        player.controlView = controls
        player.allowOrentitaionRotation = false
        player.pauseWhenAppResignActive = false
        player.customAudioSession = true
        player.resumePlayRecord = false
        controls.onSeek = { [weak self] in
            guard let self, self.engine.playerItem?.status == .readyToPlay else { return }
            self.finished = false
            // A deliberate seek supersedes the initial resume operation. Its late
            // completion must neither lock the controls nor start playback.
            if self.playbackPosition.isRestoring {
                self.restoreAttempt = UUID()
                self.playbackPosition.didRestore()
                self.engine.playerItem?.cancelPendingSeeks()
            }
        }
        controls.onToggle = { [weak self] in self?.toggle() }
        engine.onSeek = { [weak self] target in
            guard let self else { return nil }
            let id = self.playbackPosition.beginSeek(to: target)
            return { [weak self] in self?.playbackPosition.finishSeek(id) }
        }
        controls.downloadButton.addTarget(self, action: #selector(downloadEpisode), for: .touchUpInside)
        controls.backButton.addTarget(self, action: #selector(closePlayer), for: .touchUpInside)
        controls.rotateButton.addTarget(self, action: #selector(rotate), for: .touchUpInside)
        controls.previousButton.addTarget(self, action: #selector(previous), for: .touchUpInside)
        controls.playButton.addTarget(self, action: #selector(toggle), for: .touchUpInside)
        controls.nextButton.addTarget(self, action: #selector(nextEpisode), for: .touchUpInside)
        controls.episodesButton.addTarget(self, action: #selector(episodes), for: .touchUpInside)
        controls.speedButton.showsMenuAsPrimaryAction = true
        controls.speedButton.menu = UIMenu(title: "播放速度", children: [Float(0.5), 0.75, 1, 1.25, 1.5, 1.75, 2, 3].map { rate in
            UIAction(title: "\(rate) 倍速") { [weak self] _ in
                guard let self else { return }; self.session.rate = rate; self.engine.rate = rate; self.updateTime()
            }
        })
        controls.sleepButton.showsMenuAsPrimaryAction = true
        controls.sleepButton.menu = UIMenu(title: "定时停止", children: [0, 1, 15, 30, 45, 60, 90, 120].map { minutes in
            UIAction(title: minutes == 0 ? "关闭定时" : "\(minutes) 分钟后停止") { [weak self] _ in
                self?.sleepTimer.set(minutes: minutes); self?.updateTime()
            }
        })
        controls.failBtn.removeTarget(nil, action: nil, for: .touchUpInside)
        controls.failBtn.addTarget(self, action: #selector(retry), for: .touchUpInside)
        controls.failBtn.setTitle("重试播放", for: .normal)
        player.playerPlayStateChanged = { [weak self] _, _ in
            guard let self, !self.closed else { return }
            self.controls.updatePlaying(self.engine.isPlaying)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification, object: nil)
        load(session.index)
    }
    private func startPlaybackWork() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        UIApplication.shared.isIdleTimerDisabled = true
        player.pauseWhenAppResignActive = false
        guard tick == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, !self.closed, !self.sleeping, !self.checkDeadline() else { return }
            self.ticks += 1; self.updateTime()
            if self.ticks % 5 == 0 { self.emit("progress") }
        }
        tick = timer
        // Default-mode timers do not fire during UIKit tracking interactions.
        RunLoop.main.add(timer, forMode: .common)
    }
    private func load(_ index: Int) {
        guard !closed, session.episodes.indices.contains(index), !checkDeadline() else { return }
        resolveTask?.cancel(); generation = UUID(); let token = generation
        player.playerReadyToPlay = nil; player.playerPlayFailed = nil; player.playerDidToEnd = nil
        engine.stop()
        session.index = index; userPaused = false; sleeping = false; finished = false; proxied = false
        startPlaybackWork()
        stoppedDuration = nil
        playbackPosition.selectEpisode(index)
        controls.heading.text = "\(session.title) · 第 \(index + 1)/\(session.episodes.count) 集"
        controls.previousButton.isEnabled = index > 0
        controls.nextButton.isEnabled = index + 1 < session.episodes.count
        controls.previousButton.alpha = index > 0 ? 1 : 0.35
        controls.nextButton.alpha = index + 1 < session.episodes.count ? 1 : 0.35
        resolvedURL = nil
        controls.downloadButton.isHidden = URL(string: session.episodes[index].url)?.isFileURL == true
        controls.downloadButton.isEnabled = false
        controls.message.text = "正在加载…"; emit("episode")
        let raw = URL(string: session.episodes[index].url)!
        resolveTask = Task { [weak self] in
            guard let self else { return }
            do {
                var url = raw
                if sameOrigin(raw, self.origin) && raw.path == "/api/site-playback" {
                    var request = URLRequest(url: raw); request.timeoutInterval = 20
                    let matching = self.cookies.filter { cookie in let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")); return raw.host == domain || raw.host?.hasSuffix("." + domain) == true }
                    request.allHTTPHeaderFields = HTTPCookie.requestHeaderFields(with: matching)
                    let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil
                    let resolver = URLSession(configuration: config, delegate: SameOriginRedirects(origin: self.origin), delegateQueue: nil)
                    defer { resolver.invalidateAndCancel() }
                    let (data, response) = try await resolver.data(for: request)
                    guard (response as? HTTPURLResponse)?.statusCode == 200, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let text = object["url"] as? String, let result = URL(string: text), ["http", "https"].contains(result.scheme), result.host != nil, result.user == nil, result.password == nil else { throw URLError(.badServerResponse) }
                    url = result
                }
                guard !Task.isCancelled, self.generation == token, !self.closed else { return }
                self.resolvedURL = url; self.attach(url, token: token)
            } catch { if !Task.isCancelled && self.generation == token { self.fail() } }
        }
    }
    @objc private func downloadEpisode() {
        guard let url = engine.assetURL ?? resolvedURL, !url.isFileURL else { return }
        let title = session.title + (session.episodes.count > 1 ? " 第\(session.index + 1)集" : "")
        let prompt = UIAlertController(title: "下载到这台手机", message: "\(title)\n下载会占用手机空间并可能使用蜂窝流量。完成后可离线观看，在「设置 → 下载管理」中删除。", preferredStyle: .alert)
        prompt.addAction(UIAlertAction(title: "取消", style: .cancel))
        prompt.addAction(UIAlertAction(title: "下载", style: .default) { [weak self, weak prompt] _ in
            guard let self, let prompt else { return }
            do {
                try OfflineDownloads.shared.enqueue(url: url, title: title, origin: self.origin, cookies: self.cookies)
                let notice = UIAlertController(title: "已加入手机下载", message: "可继续观看，下载进度请在「设置 → 下载管理」查看。", preferredStyle: .alert)
                notice.addAction(UIAlertAction(title: "好", style: .default))
                prompt.dismiss(animated: true) { self.present(notice, animated: true) }
            } catch {
                let alert = UIAlertController(title: "无法下载", message: error.localizedDescription, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "好", style: .default))
                prompt.dismiss(animated: true) { self.present(alert, animated: true) }
            }
        })
        present(prompt, animated: true)
    }
    private var restoreAttempt = UUID()
    private func attach(_ url: URL, token: UUID) {
        restoreAttempt = UUID()
        let attempt = restoreAttempt
        let restorePosition = playbackPosition.restorePosition
        engine.requestHeader = sameOrigin(url, origin) ? [AVURLAssetHTTPCookiesKey: cookies] : [:]
        player.playerReadyToPlay = { [weak self] _, assetURL in
            guard let self, self.generation == token, assetURL == url, !self.closed else { return }
            self.controls.message.text = ""
            let item = self.engine.playerItem
            let duration = item?.duration.seconds ?? 0
            let start = restorePosition.isFinite && restorePosition > 0 && duration.isFinite && restorePosition < duration - 2 ? restorePosition : 0
            self.engine.player?.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] completed in
                DispatchQueue.main.async {
                    guard let self, completed, self.restoreAttempt == attempt, self.generation == token, self.engine.playerItem === item, !self.closed else { return }
                    self.playbackPosition.didRestore()
                    if !self.checkDeadline() && !self.userPaused && !self.sleeping { self.engine.rate = self.session.rate; self.engine.play() }
                }
            }
        }
        player.playerPlayFailed = { [weak self] _, _ in
            // Leave ZFPlayer's failure callback before replacing its current item.
            DispatchQueue.main.async {
                guard let self, self.generation == token, self.engine.assetURL == url, !self.closed else { return }
                if !self.proxied, let target = self.resolvedURL, !target.isFileURL, !(sameOrigin(target, self.origin) && target.path == "/api/proxy") {
                    self.proxied = true
                    self.playbackPosition.prepareRetry(currentPosition: self.engine.player?.currentTime().seconds ?? self.playbackPosition.savedPosition)
                    var proxy = URLComponents(url: self.origin.appendingPathComponent("api/proxy"), resolvingAgainstBaseURL: false)!
                    proxy.queryItems = [URLQueryItem(name: "url", value: target.absoluteString)]
                    self.controls.message.text = "直连失败，正在通过服务重试…"; self.attach(proxy.url!, token: token)
                } else { self.fail() }
            }
        }
        player.playerDidToEnd = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.generation == token, self.engine.assetURL == url, !self.closed else { return }
                if self.checkDeadline() { return }
                self.finished = true; self.engine.pause(); self.playbackPosition.record(0); self.emit("ended")
                self.controls.updatePlaying(false)
                if self.session.autoplayNext && self.session.index + 1 < self.session.episodes.count { self.load(self.session.index + 1) }
            }
        }
        engine.rate = session.rate
        player.assetURL = url
        controls.downloadButton.isEnabled = !url.isFileURL
        controls.showTitle(controls.heading.text ?? session.title, cover: nil, fullScreenMode: .landscape)
    }
    private func fail() { engine.pause(); controls.message.text = "无法播放此源，请重试或返回换源"; controls.failBtn.isHidden = false; emit("error") }
    private var position: Double {
        playbackPosition.position(currentTime: engine.playerItem?.status == .readyToPlay ? engine.player?.currentTime().seconds ?? .nan : .nan)
    }
    private var duration: Double { let n = engine.playerItem?.duration.seconds ?? stoppedDuration ?? 0; return n.isFinite && n >= 0 ? n : 0 }
    private func emit(_ reason: String) {
        sequence += 1
        if !finished { playbackPosition.record(position) }
        var event: [String: Any] = ["eventId": UUID().uuidString, "sessionId": session.id, "profileId": session.profileId as Any? ?? NSNull(),
          "sourceKey": session.sourceKey, "vodId": session.vodId, "title": session.title, "index": session.index,
          "total": session.episodes.count, "position": position, "duration": duration, "sequence": sequence, "rate": session.rate,
          "baseRevision": session.baseRevision, "openedAt": session.openedAt, "ended": finished, "reason": reason]
        if let sourceUrl = session.sourceUrl { event["sourceUrl"] = sourceUrl }
        onProgress?(event)
    }
    private func checkDeadline() -> Bool {
        guard sleepTimer.consumeExpired() else { return false }
        sleeping = true; userPaused = true; session.autoplayNext = false
        // Save while the current item still has its clock and duration. Freeze
        // that position before tearing down so close/reopen cannot save zero.
        stoppedDuration = duration
        engine.pause(); emit("sleep")
        playbackPosition.prepareRetry(currentPosition: position)
        generation = UUID(); restoreAttempt = UUID()
        resolveTask?.cancel(); resolveTask = nil
        tick?.invalidate(); tick = nil
        player.playerReadyToPlay = nil; player.playerPlayFailed = nil; player.playerDidToEnd = nil
        // Prevent ZFPlayer from reactivating audio when auto-lock resigns active.
        player.pauseWhenAppResignActive = true
        engine.stop()
        controls.downloadButton.isEnabled = false
        controls.failBtn.isHidden = true
        controls.message.text = "已定时停止，将按系统设置自动锁屏"
        updateTime()
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return true
    }
    private func updateTime() {
        controls.updatePlaying(engine.isPlaying && !finished)
        controls.speedButton.setTitle("\(session.rate)×", for: .normal)
        controls.sleepButton.tintColor = sleepTimer.minutesRemaining == nil ? .white : .systemYellow
        controls.sleepButton.accessibilityLabel = sleepTimer.minutesRemaining.map { "定时停止，剩余 \($0) 分钟" } ?? "定时停止"
    }
    @objc private func toggle() {
        guard !closed, !checkDeadline() else { return }
        if sleeping { load(session.index); return }
        if !engine.isPlaying || finished {
            userPaused = false; sleeping = false; controls.message.text = ""
            if finished { finished = false; engine.replay() }
            else if !playbackPosition.isRestoring { engine.rate = session.rate; engine.play() }
        } else { userPaused = true; engine.pause(); emit("pause") }
    }
    @objc private func retry() {
        guard !closed else { return }
        playbackPosition.prepareRetry(currentPosition: position)
        load(session.index)
    }
    @objc private func previous() { selectEpisode(session.index - 1) }
    @objc private func nextEpisode() { selectEpisode(session.index + 1) }
    private func selectEpisode(_ index: Int) { guard session.episodes.indices.contains(index), index != session.index else { return }; emit("pause"); load(index) }
    @objc private func background() {
        guard !closed, !sleeping else { return }
        userPaused = true
        engine.pause()
        emit("pause")
    }
    @objc private func foreground() { _ = checkDeadline(); updateTime() }
    @objc private func rotate() {
        guard let scene = view.window?.windowScene else { return }
        let landscape = view.bounds.width > view.bounds.height
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .portrait : .landscapeRight))
    }
    @objc func closePlayer() {
        guard !closed else { return }; emit("close"); closed = true; resolveTask?.cancel(); tick?.invalidate(); player.stop()
        UIApplication.shared.isIdleTimerDisabled = false; try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let scene = view.window?.windowScene
        let presenter = presentingViewController
        let orientation = returnOrientation ?? .portrait
        let onClose = onClose
        // Dismiss from the presenter so an open episode sheet is removed along
        // with the player. Restore only once the underlying page is visible.
        let finish = {
            presenter?.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene?.requestGeometryUpdate(.iOS(interfaceOrientations: orientation))
            onClose?()
        }
        if let presenter { presenter.dismiss(animated: true, completion: finish) }
        else { dismiss(animated: true, completion: finish) }
    }
    @objc private func episodes() {
        let controller = UITableViewController(style: .plain); controller.title = "选集"; controller.tableView.dataSource = self; controller.tableView.delegate = self
        let nav = UINavigationController(rootViewController: controller); nav.modalPresentationStyle = .pageSheet
        controller.navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(dismissEpisodes))
        nav.sheetPresentationController?.detents = [.medium(), .large()]; episodePicker = nav; present(nav, animated: true)
    }
    @objc private func dismissEpisodes() { episodePicker?.dismiss(animated: true); episodePicker = nil }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { session.episodes.count }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil); cell.textLabel?.text = session.episodes[indexPath.row].title
        cell.accessoryType = indexPath.row == session.index ? .checkmark : .none; return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) { dismissEpisodes(); selectEpisode(indexPath.row) }
    deinit { tick?.invalidate(); resolveTask?.cancel(); NotificationCenter.default.removeObserver(self) }
}

private final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    let origin: URL
    init(origin: URL) { self.origin = origin }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map { sameOrigin($0, origin) } == true ? request : nil)
    }
}
