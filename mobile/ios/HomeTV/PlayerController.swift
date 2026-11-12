import UIKit
import AVFoundation
import AVKit
import MediaPlayer

final class PlayerController: UIViewController, AVPictureInPictureControllerDelegate {
    var session: PlaybackSession
    let origin: URL
    let cookies: [HTTPCookie]
    var onProgress: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?
    private let engine = HomeTVPlayerManager()
    private let surface = UIView()
    private let controls = HomeTVPlayerControls()
    private let portraitInfo = PlayerPortraitInfoView()
    private let statusBackdrop = UIView()
    private var landscapeLayout = false
    private var player: ZFPlayerController!
    private var tick: Timer?
    private var resolveTask: Task<Void, Never>?
    private var generation = UUID(), sequence = 0, ticks = 0
    private let sleepTimer: SleepTimer
    private var userPaused = false, sleeping = false, closed = false, finished = false
    private var earlyEndRetried = false, playbackInterrupted = false
    private var stoppedDuration: Double?
    private var resolvedURL: URL?, proxied = false
    private let preferences = PlaybackPreferences()
    private var optionsPanel: PlayerOptionsController?
    private var dismissingOptions = false, dismissingEpisodes = false
    private var backgroundPiPGrace = false
    private var episodePicker: EpisodePickerController?
    private var returnOrientation: UIInterfaceOrientationMask?
    private let playbackPosition: PlaybackPosition
    private var pip: AVPictureInPictureController?
    private var playbackRateObservation: NSKeyValueObservation?
    private var restoringPiP = false, startingPiP = false
    private var minimized = false, appInBackground = false
    private var deviceLocked = !UIApplication.shared.isProtectedDataAvailable
    private var audioInterrupted = false, resumeAfterInterruption = false
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    var hasStopped: Bool { closed }
    var isPlaybackRunning: Bool { !closed && !sleeping && !userPaused && !audioInterrupted && engine.isPlaying }
    var isPictureInPictureActive: Bool { pip?.isPictureInPictureActive == true }


    init(session: PlaybackSession, origin: URL, cookies: [HTTPCookie], sleepTimer: SleepTimer = SleepTimer()) {
        self.sleepTimer = sleepTimer
        self.session = session; self.origin = origin; self.cookies = cookies; self.playbackPosition = PlaybackPosition(positions: session.episodes.map(\.position))
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var prefersStatusBarHidden: Bool { !minimized && landscapeLayout }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersHomeIndicatorAutoHidden: Bool { !minimized && landscapeLayout }
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
        super.viewDidLoad(); view.backgroundColor = .black; overrideUserInterfaceStyle = .dark
        surface.accessibilityIdentifier = "player.video-surface"
        surface.clipsToBounds = true; surface.frame = view.bounds; view.addSubview(surface)
        statusBackdrop.backgroundColor = .black; view.addSubview(statusBackdrop)
        view.addSubview(portraitInfo)
        portraitInfo.onSelect = { [weak self] index in self?.selectEpisode(index) }
        portraitInfo.update(title: session.title, episodes: session.episodes, current: session.index)
        engine.shouldAutoPlay = false
        engine.diagnosticContext = { [weak self] in
            guard let self else { return [:] }
            return ["episode": "\(self.session.index)", "userPaused": "\(self.userPaused)",
                    "restoring": "\(self.playbackPosition.isRestoring)", "sleeping": "\(self.sleeping)",
                    "closed": "\(self.closed)", "proxy": "\(self.proxied)",
                    "finished": "\(self.finished)", "earlyEndRetried": "\(self.earlyEndRetried)",
                    "appState": "\(UIApplication.shared.applicationState.rawValue)"]
        }
        engine.canPlay = { [weak self] in
            guard let self, !self.closed, !self.sleeping, !self.deviceLocked else { return false }
            return !self.checkDeadline() && !self.userPaused && !self.audioInterrupted && !self.playbackPosition.isRestoring && (!self.appInBackground || self.permitsBackgroundPlayback)
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
        controls.onToggle = { [weak self] in self?.engine.trace("gesture-double-tap"); self?.toggle() }
        engine.onSeek = { [weak self] target in
            guard let self else { return nil }
            let id = self.playbackPosition.beginSeek(to: target)
            return { [weak self] in self?.playbackPosition.finishSeek(id) }
        }
        controls.downloadButton.addTarget(self, action: #selector(downloadEpisode), for: .touchUpInside)
        controls.backButton.addTarget(self, action: #selector(goBack), for: .touchUpInside)
        controls.nextButton.addTarget(self, action: #selector(nextEpisode), for: .touchUpInside)
        controls.pipButton.addTarget(self, action: #selector(startSmallWindow), for: .touchUpInside)
        controls.moreButton.addTarget(self, action: #selector(showMore), for: .touchUpInside)
        controls.rotateButton.addTarget(self, action: #selector(rotate), for: .touchUpInside)
        controls.playButton.addTarget(self, action: #selector(toggle), for: .touchUpInside)
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
                self?.sleepTimer.set(minutes: minutes); self?.updateTime(); self?.dismissMore()
            }
        })
        controls.failBtn.removeTarget(nil, action: nil, for: .touchUpInside)
        controls.failBtn.addTarget(self, action: #selector(retry), for: .touchUpInside)
        controls.failBtn.setTitle("重试播放", for: .normal)
        player.playerPlayStateChanged = { [weak self] _, _ in
            guard let self, !self.closed else { return }
            self.updateTime()
        }
        player.playerLoadStateChanged = { [weak self] _, _ in self?.engine.trace("buffer-state") }
        NotificationCenter.default.addObserver(self, selector: #selector(deviceWillLock), name: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(deviceDidUnlock), name: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(audioInterruption), name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(audioRouteChanged), name: AVAudioSession.routeChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(applyBackgroundMode), name: .backgroundPlaybackChanged, object: nil)
        installRemoteControls()
        load(session.index)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutPlaybackRegions()
    }
    private func layoutPlaybackRegions() {
        let landscape = view.bounds.width > view.bounds.height
        if landscapeLayout != landscape {
            landscapeLayout = landscape
            setNeedsStatusBarAppearanceUpdate(); setNeedsUpdateOfHomeIndicatorAutoHidden()
        }
        controls.landscapeLayout = landscape && !minimized
        portraitInfo.isHidden = landscape || minimized
        statusBackdrop.isHidden = landscape || minimized
        if landscape || minimized {
            view.backgroundColor = .black; surface.frame = view.bounds
        } else {
            view.backgroundColor = NativeTheme.current.surface
            let top = view.safeAreaInsets.top
            let videoHeight = min(view.bounds.width * 9 / 16, max(0, view.bounds.height - top))
            statusBackdrop.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: top)
            surface.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: videoHeight)
            portraitInfo.frame = CGRect(x: 0, y: surface.frame.maxY, width: view.bounds.width, height: max(0, view.bounds.height - surface.frame.maxY))
            portraitInfo.setNeedsLayout()
        }
        // The drawers cover this stable surface; opening or dismissing them does
        // not resize it, replace the AVPlayerItem, or send a playback gesture.
        episodePicker?.view.frame = view.bounds
        optionsPanel?.view.frame = view.bounds
    }
    private func startPlaybackWork() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        UIApplication.shared.isIdleTimerDisabled = !minimized && !appInBackground
        player.pauseWhenAppResignActive = false
        guard tick == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, !self.closed, !self.sleeping, !self.checkDeadline() else { return }
            self.ticks += 1; self.updateTime()
            if self.ticks % 5 == 0 { self.emit("progress"); self.engine.trace("tick") }
        }
        tick = timer
        // Default-mode timers do not fire during UIKit tracking interactions.
        RunLoop.main.add(timer, forMode: .common)
    }
    private func load(_ index: Int) {
        guard !closed, !deviceLocked, session.episodes.indices.contains(index), !checkDeadline() else { return }
        resolveTask?.cancel(); generation = UUID(); let token = generation
        player.playerReadyToPlay = nil; player.playerPlayFailed = nil; player.playerDidToEnd = nil
        pip?.delegate = nil; pip?.stopPictureInPicture(); pip = nil
        playbackRateObservation = nil
        engine.stop()
        session.index = index; userPaused = false; sleeping = false; finished = false; proxied = false
        earlyEndRetried = false; playbackInterrupted = false
        engine.trace("episode-load")
        episodePicker?.update(episodes: session.episodes, current: index)
        startPlaybackWork()
        stoppedDuration = nil
        playbackPosition.selectEpisode(index)
        controls.heading.text = "\(session.title) · 第 \(index + 1)/\(session.episodes.count) 集"
        controls.episodesButton.isHidden = session.episodes.count <= 1
        controls.nextButton.isEnabled = index + 1 < session.episodes.count
        portraitInfo.update(title: session.title, episodes: session.episodes, current: index)
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
        guard !closed, !session.episodes.isEmpty, URL(string: session.episodes[session.index].url)?.isFileURL != true else { return }
        dismissMore(animated: false)
        let picker = OfflineEpisodePickerController(session: session, origin: origin, cookies: cookies)
        picker.onAdded = { [weak self] count in self?.showCacheNotice(count) }
        let navigation = UINavigationController(rootViewController: picker)
        navigation.overrideUserInterfaceStyle = .dark
        navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.large()]
        present(navigation, animated: true)
    }
    private func showCacheNotice(_ count: Int) {
        guard !closed else { return }
        controls.message.text = "已加入 \(count) 项缓存，可继续添加其他影片"
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            if self?.controls.message.text?.hasPrefix("已加入") == true { self?.controls.message.text = "" }
        }
    }
    private var restoreAttempt = UUID()
    private var attachmentID = UUID()
    private func attach(_ url: URL, token: UUID) {
        // Retries can replace the underlying player without going through load().
        pip?.delegate = nil; pip?.stopPictureInPicture(); pip = nil
        playbackRateObservation = nil; startingPiP = false; restoringPiP = false
        restoreAttempt = UUID()
        let attempt = restoreAttempt
        attachmentID = UUID()
        let attachment = attachmentID
        let restorePosition = playbackPosition.restorePosition
        engine.trace("attach restore=\(restorePosition)")
        engine.requestHeader = sameOrigin(url, origin) ? [AVURLAssetHTTPCookiesKey: cookies] : [:]
        player.playerReadyToPlay = { [weak self] _, assetURL in
            guard let self, self.generation == token, self.attachmentID == attachment, assetURL == url, !self.closed else { return }
            self.controls.message.text = ""
            // A user seek can cancel the initial resume completion; PiP setup
            // must not depend on that completion succeeding.
            self.configurePictureInPicture()
            let item = self.engine.playerItem
            let duration = item?.duration.seconds ?? 0
            let start = restorePosition.isFinite && restorePosition > 0 && duration.isFinite && restorePosition < duration - 2 ? restorePosition : 0
            self.engine.player?.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] completed in
                DispatchQueue.main.async {
                    guard let self, completed, self.restoreAttempt == attempt, self.generation == token, self.engine.playerItem === item, !self.closed else { return }
                    self.engine.trace("restore-completed")
                    self.playbackPosition.didRestore()
                    if !self.checkDeadline() && !self.userPaused && !self.sleeping && !self.audioInterrupted { self.engine.rate = self.session.rate; self.engine.play() }
                    self.updateTime()
                }
            }
        }
        player.playerPlayFailed = { [weak self] _, _ in
            guard let self else { return }
            let failedItem = self.engine.playerItem
            // Leave ZFPlayer's failure callback before replacing its current item.
            DispatchQueue.main.async {
                guard self.generation == token, self.attachmentID == attachment,
                      self.engine.playerItem === failedItem, self.engine.assetURL == url, !self.closed else { return }
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
            guard let self else { return }
            let item = self.engine.playerItem
            let seekRevision = self.engine.seekRevision
            let wasSeeking = self.playbackPosition.hasPendingSeek || self.playbackPosition.isRestoring
            self.engine.trace("end-notification")
            DispatchQueue.main.async {
                guard self.generation == token, self.engine.assetURL == url, !self.closed,
                      self.engine.playerItem === item, self.attachmentID == attachment,
                      self.engine.seekRevision == seekRevision else { return }
                if self.checkDeadline() { return }
                guard !wasSeeking, !self.playbackPosition.hasPendingSeek, !self.playbackPosition.isRestoring else {
                    self.engine.trace("end-ignored-during-seek"); return
                }
                let clock = item?.currentTime().seconds ?? .nan
                let duration = item?.duration.seconds ?? .nan
                // Some remote streams signal EOF at a truncated segment or
                // transport interruption. Only a clock at the actual tail may
                // clear progress, enable replay, or advance to another episode.
                guard clock.isFinite, duration.isFinite, duration > 0,
                      clock >= max(0, duration - 1) else {
                    self.handlePrematureEnd(url: url, token: token); return
                }
                self.engine.trace("end-confirmed")
                self.finished = true; self.engine.pause(); self.playbackPosition.record(0); self.emit("ended")
                self.controls.updatePlaying(false)
                if self.session.autoplayNext && self.session.index + 1 < self.session.episodes.count { self.load(self.session.index + 1) }
            }
        }
        engine.rate = session.rate
        player.assetURL = url
        engine.player?.audiovisualBackgroundPlaybackPolicy = (preferences.smallWindow || preferences.backgroundAudio) ? .continuesIfPossible : .pauses
        // HomeTV owns lifecycle and interruptions. ZFPlayer's default callbacks
        // would reactivate audio on resign-active and resume after route changes.
        player.notification?.willResignActive = { _ in }
        player.notification?.didBecomeActive = { _ in }
        player.notification?.oldDeviceUnavailable = { _ in }
        playbackRateObservation = engine.player?.observe(\.rate, options: [.new]) { [weak self] observed, _ in
            DispatchQueue.main.async {
                guard let self, !self.closed, self.engine.player === observed, self.isPictureInPictureActive, !self.restoringPiP else { return }
                if self.sleeping || self.audioInterrupted || self.deviceLocked { if observed.rate != 0 { self.engine.pause() }; return }
                guard !self.playbackPosition.hasPendingSeek, !self.playbackPosition.isRestoring else { return }
                if observed.rate == 0 && self.engine.isPlaying { self.pausePlayback() }
                else if observed.rate > 0 && !self.engine.isPlaying { self.userPaused = false; self.engine.rate = self.session.rate; self.engine.play(); self.updateTime() }
            }
        }
        controls.downloadButton.isEnabled = !url.isFileURL
        controls.showTitle(controls.heading.text ?? session.title, cover: nil, fullScreenMode: .landscape)
    }
    private func handlePrematureEnd(url: URL, token: UUID) {
        engine.trace("end-premature")
        // A late notification must never override a user's pause or background.
        guard !userPaused, !sleeping, !closed, !audioInterrupted else { return }
        playbackPosition.prepareRetry(currentPosition: position)
        engine.pause(); emit("interrupted")
        if !earlyEndRetried, !url.isFileURL {
            earlyEndRetried = true
            controls.message.text = "播放意外中断，正在从当前位置恢复…"
            attach(url, token: token)
        } else {
            playbackInterrupted = true
            controls.message.text = "播放源提前中断，进度已保留，请重试或返回换源"
            controls.failBtn.isHidden = false
        }
    }
    private func fail() { engine.trace("playback-failed"); engine.pause(); controls.message.text = "无法播放此源，请重试或返回换源"; controls.failBtn.isHidden = false; emit("error") }
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
        engine.trace("sleep-deadline")
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
        restoringPiP = false; pip?.stopPictureInPicture()
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
        controls.pipButton.isHidden = !preferences.smallWindow
        controls.nextButton.isEnabled = session.index + 1 < session.episodes.count && !closed
        controls.sleepButton.accessibilityLabel = sleepTimer.minutesRemaining.map { "定时停止，剩余 \($0) 分钟" } ?? "定时停止"
        optionsPanel?.update(autoplayNext: session.autoplayNext, hasMultipleEpisodes: session.episodes.count > 1, smallWindow: preferences.smallWindow, backgroundAudio: preferences.backgroundAudio, sleepMinutesRemaining: sleepTimer.minutesRemaining)
        if !closed {
            updateNowPlaying()
            PlaybackCoordinator.shared.updateMini()
            UIApplication.shared.isIdleTimerDisabled = !minimized && !appInBackground && !sleeping && !userPaused && !audioInterrupted
        }
    }
    @objc private func toggle() {
        engine.trace("toggle-request")
        guard !closed, !checkDeadline() else { return }
        if !engine.isPlaying || finished || sleeping || playbackInterrupted { playFromControl() }
        else { pausePlayback() }
    }
    @objc private func retry() {
        engine.trace("retry-request")
        guard !closed else { return }
        playbackPosition.prepareRetry(currentPosition: position)
        load(session.index)
    }
    func selectEpisode(_ index: Int) { guard session.episodes.indices.contains(index), index != session.index else { return }; emit("pause"); load(index) }
    @objc private func deviceWillLock() {
        guard !closed else { return }
        deviceLocked = true
        engine.trace("device-lock")
        pausePlayback()
    }
    @objc private func deviceDidUnlock() {
        deviceLocked = false
        // Keep userPaused set; unlocking must never resume the video by itself.
    }
    @objc private func background() {
        engine.trace("app-enter-background"); appInBackground = true
        UIApplication.shared.isIdleTimerDisabled = false
        guard !closed, !sleeping, !checkDeadline() else { return }
        if deviceLocked || !UIApplication.shared.isProtectedDataAvailable { deviceWillLock() }
        else if !preferences.smallWindow && !preferences.backgroundAudio { pausePlayback() }
        else {
            backgroundPiPGrace = preferences.smallWindow && !userPaused
            emit("progress")
            // Audio-only playback must detach the screen layer at the background
            // boundary. Waiting for a PiP transition that cannot start lets the
            // system suspend the video clock before the layer is detached.
            if !preferences.smallWindow { updateBackgroundLayer() }
            else {
                // AVKit gets a short opportunity to start automatic PiP before
                // applying the configured audio fallback or pause behavior.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
                    self?.backgroundPiPGrace = false; self?.updateBackgroundLayer()
                }
            }
        }
    }
    @objc private func foreground() {
        engine.trace("app-become-active"); appInBackground = false; backgroundPiPGrace = false
        guard !closed else { return }
        engine.avPlayerLayer?.player = engine.player
        _ = checkDeadline(); updateTime()
    }
    private func updateBackgroundLayer() {
        guard !closed, appInBackground, !isPictureInPictureActive, !startingPiP, !backgroundPiPGrace else { return }
        if preferences.backgroundAudio && !deviceLocked { engine.avPlayerLayer?.player = nil }
        else { pausePlayback() }
    }
    @objc private func audioInterruption(_ notification: Notification) {
        guard let raw = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue,
              let type = AVAudioSession.InterruptionType(rawValue: raw), !closed else { return }
        if type == .began {
            resumeAfterInterruption = !userPaused && !sleeping && !finished
            audioInterrupted = true; engine.pause(); emit("pause"); updateTime()
        } else {
            let options = AVAudioSession.InterruptionOptions(rawValue: (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0)
            let resume = resumeAfterInterruption && options.contains(.shouldResume)
            audioInterrupted = false; resumeAfterInterruption = false
            if resume && !userPaused && !sleeping && !checkDeadline() { playFromControl() }
            else { userPaused = true; updateTime() }
        }
    }
    @objc private func audioRouteChanged(_ notification: Notification) {
        let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
        if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { pausePlayback() }
    }
    @objc private func applyBackgroundMode() {
        guard !closed else { return }
        engine.player?.audiovisualBackgroundPlaybackPolicy = (preferences.smallWindow || preferences.backgroundAudio) ? .continuesIfPossible : .pauses
        pip?.canStartPictureInPictureAutomaticallyFromInline = preferences.smallWindow
        if !preferences.smallWindow && minimized { closePlayer(); return }
        if !preferences.smallWindow { pip?.stopPictureInPicture() }
        if appInBackground && !permitsBackgroundPlayback { pausePlayback() }
        updateTime()
    }
    private var permitsBackgroundPlayback: Bool {
        preferences.permitsBackground(pictureInPicture: isPictureInPictureActive, startingPictureInPicture: startingPiP || backgroundPiPGrace)
    }
    func persistPlaybackProgress() { if !closed { emit("progress") } }
    func rebindWebSession(_ incoming: PlaybackSession) {
        persistPlaybackProgress()
        // Keep the active episode catalog paired with its per-episode position tracker.
        var next = incoming; next.episodes = session.episodes
        next.rate = session.rate; next.autoplayNext = session.autoplayNext
        session = next; emit("progress")
    }
    func togglePlayback() { toggle(); updateTime() }
    func pausePlayback() {
        guard !closed else { return }
        userPaused = true; resumeAfterInterruption = false; engine.pause(); emit("pause"); updateTime()
    }
    private func playFromControl() {
        guard !closed, !deviceLocked, !audioInterrupted, !checkDeadline() else { return }
        if appInBackground && !permitsBackgroundPlayback { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        if sleeping || playbackInterrupted { retry(); return }
        userPaused = false
        if finished { finished = false; engine.replay() }
        else if !playbackPosition.isRestoring { engine.rate = session.rate; engine.play() }
        updateTime()
    }
    func setMinimized(_ value: Bool) {
        if value && !minimized { emit("close") } // Existing web UI treats this as full-screen dismissal.
        minimized = value; controls.isHidden = value; view.isUserInteractionEnabled = !value
        dismissMore(animated: false); dismissEpisodes(animated: false)
        controls.unlockControls(); refreshControlsVisibility()
        view.setNeedsLayout(); view.layoutIfNeeded()
        setNeedsStatusBarAppearanceUpdate(); setNeedsUpdateOfHomeIndicatorAutoHidden(); updateTime()
    }
    @objc private func goBack() {
        if landscapeLayout && !minimized { rotate() }
        else { minimizePlayer() }
    }
    @objc private func nextEpisode() {
        guard !closed else { return }
        selectEpisode(session.index + 1)
    }
    @objc private func startSmallWindow() {
        guard !closed, !deviceLocked, preferences.smallWindow else { return }
        dismissTransientPanels()
        if let pip, pip.isPictureInPicturePossible { pip.startPictureInPicture() }
        else if PlaybackCoordinator.shared.current === self { PlaybackCoordinator.shared.minimize(self) }
        else { controls.message.text = "当前设备暂无法使用小窗播放" }
    }
    @objc func minimizePlayer() {
        guard !closed else { return }
        if preferences.smallWindow && PlaybackCoordinator.shared.current === self { PlaybackCoordinator.shared.minimize(self) }
        else { closePlayer() }
    }
    func dismissTransientPanels() {
        dismissMore(animated: false); dismissEpisodes(animated: false)
        if presentedViewController != nil { dismiss(animated: false) }
    }
    func restorePageOrientation(in scene: UIWindowScene?, presenter: UIViewController?) {
        presenter?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene?.requestGeometryUpdate(.iOS(interfaceOrientations: returnOrientation ?? .portrait))
    }
    @objc private func showMore() {
        guard !closed, presentedViewController == nil else { return }
        dismissEpisodes(animated: false)
        if optionsPanel != nil { dismissMore(); return }
        let panel = PlayerOptionsController(buttons: [controls.sleepButton, controls.downloadButton])
        panel.onDismiss = { [weak self] in self?.dismissMore() }
        panel.onSleepTimerChanged = { [weak self] minutes in
            self?.sleepTimer.set(minutes: minutes); self?.updateTime()
        }
        panel.onAutoplayNextChanged = { [weak self] enabled in
            guard let self else { return }
            self.session.autoplayNext = enabled; self.updateTime()
        }
        panel.onSmallWindowChanged = { [weak self] enabled in self?.preferences.smallWindow = enabled }
        panel.onBackgroundAudioChanged = { [weak self] enabled in self?.preferences.backgroundAudio = enabled }
        optionsPanel = panel; controls.isHidden = true
        addChild(panel); view.addSubview(panel.view); panel.didMove(toParent: self)
        layoutPlaybackRegions(); updateTime(); panel.animateIn()
    }
    private func dismissMore(animated: Bool = true) {
        guard let panel = optionsPanel else { return }
        if animated && dismissingOptions { return }
        dismissingOptions = true
        let finish = { [weak self, weak panel] in
            guard let self, let panel, self.optionsPanel === panel else { return }
            panel.willMove(toParent: nil); panel.view.removeFromSuperview(); panel.removeFromParent()
            self.optionsPanel = nil; self.dismissingOptions = false; self.refreshControlsVisibility()
        }
        if animated { panel.animateOut(completion: finish) } else { finish() }
    }
    private func refreshControlsVisibility() {
        controls.isHidden = minimized || optionsPanel != nil || episodePicker != nil
        if !controls.isHidden { controls.revealControls() }
    }
    private func configurePictureInPicture() {
        guard !closed, AVPictureInPictureController.isPictureInPictureSupported(), let layer = engine.avPlayerLayer else { return }
        pip?.delegate = nil
        pip = AVPictureInPictureController(playerLayer: layer)
        pip?.delegate = self
        pip?.canStartPictureInPictureAutomaticallyFromInline = preferences.smallWindow
        updateBackgroundLayer()
    }
    func pictureInPictureControllerWillStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        guard pictureInPictureController === pip, !closed else { return }
        guard preferences.smallWindow, !deviceLocked else { pip?.stopPictureInPicture(); return }
        startingPiP = true
    }
    func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        guard pictureInPictureController === pip, !closed else { return }
        startingPiP = false
        if PlaybackCoordinator.shared.current === self { PlaybackCoordinator.shared.minimize(self) }
    }
    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        guard pictureInPictureController === pip, !closed else { return }
        startingPiP = false; updateBackgroundLayer()
        if !appInBackground, preferences.smallWindow, PlaybackCoordinator.shared.current === self {
            PlaybackCoordinator.shared.minimize(self)
        } else if !appInBackground { controls.message.text = "系统小窗暂不可用，可返回页面使用小窗" }
    }
    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        guard pictureInPictureController === pip, !closed else { completionHandler(false); return }
        restoringPiP = true
        if PlaybackCoordinator.shared.current === self {
            PlaybackCoordinator.shared.expand(self) { [weak self] restored in
                if let self, restored, !self.userPaused, !self.sleeping, !self.audioInterrupted { self.playFromControl() }
                completionHandler(restored)
            }
        } else { completionHandler(presentingViewController != nil) }
    }
    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        guard pictureInPictureController === pip, !closed else { return }
        startingPiP = false
        let restore = restoringPiP; restoringPiP = false
        if restore || sleeping { updateBackgroundLayer(); PlaybackCoordinator.shared.updateMini() }
        else { closePlayer() }
    }
    private func installRemoteControls() {
        let center = MPRemoteCommandCenter.shared()
        func bind(_ command: MPRemoteCommand, _ action: @escaping (PlayerController, MPRemoteCommandEvent) -> Void) {
            command.isEnabled = true
            let target = command.addTarget { [weak self] event in
                DispatchQueue.main.async { if let self, !self.closed { action(self, event) } }
                return .success
            }
            remoteTargets.append((command, target))
        }
        bind(center.playCommand) { player, _ in player.playFromControl() }
        bind(center.pauseCommand) { player, _ in player.pausePlayback() }
        bind(center.togglePlayPauseCommand) { player, _ in player.togglePlayback() }
        bind(center.skipForwardCommand) { player, _ in player.remoteSeek(player.position + 15) }
        bind(center.skipBackwardCommand) { player, _ in player.remoteSeek(player.position - 15) }
        bind(center.changePlaybackPositionCommand) { player, event in
            if let event = event as? MPChangePlaybackPositionCommandEvent { player.remoteSeek(event.positionTime) }
        }
        bind(center.stopCommand) { player, _ in player.closePlayer() }
        center.skipForwardCommand.preferredIntervals = [15]; center.skipBackwardCommand.preferredIntervals = [15]
        center.nextTrackCommand.isEnabled = false; center.previousTrackCommand.isEnabled = false
    }
    private func remoteSeek(_ time: Double) {
        guard !closed, !sleeping, !checkDeadline(), duration > 0, time.isFinite else { return }
        finished = false
        if playbackPosition.isRestoring { restoreAttempt = UUID(); playbackPosition.didRestore(); engine.playerItem?.cancelPendingSeeks() }
        engine.seek(toTime: min(max(0, time), max(0, duration - 0.1))) { [weak self] _ in self?.emit("progress"); self?.updateTime() }
    }
    private func updateNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: session.title,
            MPMediaItemPropertyAlbumTitle: session.episodes[session.index].title,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaybackRunning ? session.rate : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: session.rate
        ]
        MPRemoteCommandCenter.shared().changePlaybackPositionCommand.isEnabled = duration > 0 && !sleeping
    }
    @objc private func rotate() {
        guard let scene = view.window?.windowScene else { return }
        let landscape = view.bounds.width > view.bounds.height
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .portrait : .landscapeRight))
    }
    /// Explicit stop remains separate from returning to the browser/minimizing.
    @objc func closePlayer() {
        if PlaybackCoordinator.shared.current === self { PlaybackCoordinator.shared.stop(self); return }
        guard !closed else { return }
        let presenter = presentingViewController, scene = view.window?.windowScene
        stopPlayback()
        dismiss(animated: true) { [weak self, weak presenter] in self?.restorePageOrientation(in: scene, presenter: presenter) }
    }
    func stopPlayback() {
        guard !closed else { return }
        emit("close"); closed = true; generation = UUID(); resolveTask?.cancel(); tick?.invalidate(); tick = nil
        playbackRateObservation = nil; pip?.delegate = nil; pip?.stopPictureInPicture(); pip = nil
        dismissMore(animated: false); dismissEpisodes(animated: false); player?.stop()
        for (command, target) in remoteTargets { command.removeTarget(target); command.isEnabled = false }
        remoteTargets.removeAll(); MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        onClose?()
    }
    @objc private func episodes() {
        guard !closed, presentedViewController == nil else { return }
        if episodePicker != nil { dismissEpisodes(); return }
        dismissMore(animated: false)
        let picker = EpisodePickerController(episodes: session.episodes, current: session.index)
        picker.onDismiss = { [weak self] in self?.dismissEpisodes() }
        picker.onSelect = { [weak self] index in
            self?.dismissEpisodes(); self?.selectEpisode(index)
        }
        episodePicker = picker
        controls.isHidden = true
        addChild(picker); view.addSubview(picker.view)
        layoutPlaybackRegions()
        picker.didMove(toParent: self)
        view.layoutIfNeeded(); picker.view.layoutIfNeeded()
        picker.animateIn()
    }
    private func dismissEpisodes(animated: Bool = true) {
        guard let picker = episodePicker else { return }
        if animated && dismissingEpisodes { return }
        dismissingEpisodes = true
        let finish = { [weak self, weak picker] in
            guard let self, let picker, self.episodePicker === picker else { return }
            picker.willMove(toParent: nil); picker.view.removeFromSuperview(); picker.removeFromParent()
            self.episodePicker = nil; self.dismissingEpisodes = false
            self.refreshControlsVisibility(); self.layoutPlaybackRegions()
        }
        if animated { picker.animateOut(completion: finish) } else { finish() }
    }
    deinit {
        tick?.invalidate(); resolveTask?.cancel()
        for (command, target) in remoteTargets { command.removeTarget(target) }
        NotificationCenter.default.removeObserver(self)
    }
}

private final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    let origin: URL
    init(origin: URL) { self.origin = origin }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map { sameOrigin($0, origin) } == true ? request : nil)
    }
}
