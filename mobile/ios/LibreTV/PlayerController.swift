import UIKit
import AVFoundation

private final class VideoSurface: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

final class PlayerController: UIViewController, UITableViewDataSource, UITableViewDelegate {
    var session: PlaybackSession
    let origin: URL
    let cookies: [HTTPCookie]
    var onProgress: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?
    private let player = AVPlayer()
    private let surface = VideoSurface()
    private let titleLabel = UILabel(), info = UILabel(), timeLabel = UILabel()
    private let playButton = UIButton(type: .system), speedButton = UIButton(type: .system), sleepButton = UIButton(type: .system)
    private let slider = UISlider()
    private var tick: Timer?, itemObservation: NSKeyValueObservation?, endedObserver: NSObjectProtocol?
    private var resolveTask: Task<Void, Never>?
    private var generation = UUID(), sequence = 0, ticks = 0
    private let sleepTimer = SleepTimer()
    private var userPaused = false, sleeping = false, closed = false, finished = false
    private var resolvedURL: URL?, proxied = false
    private var episodePicker: UIViewController?
    private let playbackPosition: PlaybackPosition

    init(session: PlaybackSession, origin: URL, cookies: [HTTPCookie]) {
        self.session = session; self.origin = origin; self.cookies = cookies; self.playbackPosition = PlaybackPosition(positions: session.episodes.map(\.position))
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        surface.playerLayer.player = player; surface.playerLayer.videoGravity = .resizeAspect
        surface.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(surface)
        NSLayoutConstraint.activate([surface.topAnchor.constraint(equalTo: view.topAnchor), surface.bottomAnchor.constraint(equalTo: view.bottomAnchor), surface.leadingAnchor.constraint(equalTo: view.leadingAnchor), surface.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        let top = UIStackView(); top.axis = .horizontal; top.spacing = 12
        let close = button("返回", #selector(closePlayer)); titleLabel.textColor = .white; titleLabel.numberOfLines = 2; titleLabel.font = .systemFont(ofSize: 15)
        top.addArrangedSubview(close); top.addArrangedSubview(titleLabel); top.addArrangedSubview(button("横竖屏", #selector(rotate)))
        let controls = UIStackView(); controls.axis = .vertical; controls.spacing = 10
        let row = UIStackView(); row.axis = .horizontal; row.spacing = 4; row.distribution = .fillEqually
        playButton.setTitle("暂停", for: .normal); playButton.addTarget(self, action: #selector(toggle), for: .touchUpInside)
        speedButton.setTitle("\(session.rate) 倍", for: .normal); speedButton.showsMenuAsPrimaryAction = true
        speedButton.menu = UIMenu(title: "播放速度", children: [Float(0.5), 0.75, 1, 1.25, 1.5, 1.75, 2, 3].map { rate in
            UIAction(title: "\(rate) 倍速") { [weak self] _ in guard let self else { return }; self.session.rate = rate; self.speedButton.setTitle("\(rate) 倍", for: .normal); if self.player.rate != 0 { self.player.rate = rate } }
        })
        sleepButton.setTitle("定时", for: .normal); sleepButton.showsMenuAsPrimaryAction = true
        sleepButton.menu = UIMenu(title: "定时停止", children: [0, 15, 30, 45, 60, 90, 120].map { minutes in
            UIAction(title: minutes == 0 ? "关闭定时" : "\(minutes) 分钟后停止") { [weak self] _ in
                self?.sleepTimer.set(minutes: minutes); self?.sleeping = false; self?.updateTime()
            }
        })
        for control in [button("上一集", #selector(previous)), playButton, button("下一集", #selector(nextEpisode)), button("选集", #selector(episodes)), speedButton, sleepButton] { row.addArrangedSubview(control) }
        timeLabel.textColor = .white; timeLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        slider.addTarget(self, action: #selector(seek), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        info.textColor = .white; info.numberOfLines = 3; info.font = .systemFont(ofSize: 13); info.textAlignment = .center
        controls.addArrangedSubview(info); controls.addArrangedSubview(timeLabel); controls.addArrangedSubview(slider); controls.addArrangedSubview(row)
        for stack in [top, controls] { stack.translatesAutoresizingMaskIntoConstraints = false; stack.backgroundColor = UIColor.black.withAlphaComponent(0.65); stack.isLayoutMarginsRelativeArrangement = true; stack.layoutMargins = UIEdgeInsets(top: 6, left: 6, bottom: 6, right: 6); view.addSubview(stack) }
        NSLayoutConstraint.activate([
            top.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), top.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8), top.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8),
            controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8), controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8), controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8), row.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification, object: nil)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        UIApplication.shared.isIdleTimerDisabled = true
        tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }; self.ticks += 1; self.updateTime(); if !self.checkDeadline() && self.ticks % 5 == 0 { self.emit("progress") }
        }
        load(session.index)
    }
    private func button(_ title: String, _ action: Selector) -> UIButton {
        let b = UIButton(type: .system); b.setTitle(title, for: .normal); b.setTitleColor(.white, for: .normal); b.titleLabel?.font = .systemFont(ofSize: 13); b.addTarget(self, action: action, for: .touchUpInside); return b
    }
    private func load(_ index: Int) {
        guard !closed, session.episodes.indices.contains(index) else { return }
        resolveTask?.cancel(); generation = UUID(); let token = generation
        player.pause(); itemObservation = nil
        if let observer = endedObserver { NotificationCenter.default.removeObserver(observer); endedObserver = nil }
        player.replaceCurrentItem(with: nil)
        session.index = index; userPaused = false; sleeping = false; finished = false; proxied = false
        playbackPosition.selectEpisode(index)
        titleLabel.text = "\(session.title) · 第 \(index + 1)/\(session.episodes.count) 集"
        info.text = "正在加载…"; emit("episode")
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
    private func attach(_ url: URL, token: UUID) {
        let position = playbackPosition.restorePosition
        let asset = AVURLAsset(url: url, options: sameOrigin(url, origin) ? [AVURLAssetHTTPCookiesKey: cookies] : nil)
        let item = AVPlayerItem(asset: asset); player.replaceCurrentItem(with: item)
        itemObservation = item.observe(\.status, options: [.new, .initial]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self, self.generation == token, self.player.currentItem === item, !self.closed else { return }
                if item.status == .readyToPlay {
                    self.info.text = ""
                    let duration = item.duration.seconds
                    let start = position.isFinite && position > 0 && duration.isFinite && position < duration - 2 ? position : 0
                    self.player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] completed in
                        DispatchQueue.main.async {
                            guard let self, completed, self.generation == token, self.player.currentItem === item, !self.closed else { return }
                            self.playbackPosition.didRestore()
                            if !self.checkDeadline() && !self.userPaused && !self.sleeping { self.player.playImmediately(atRate: self.session.rate) }
                        }
                    }
                } else if item.status == .failed {
                    if !self.proxied, let target = self.resolvedURL, !(sameOrigin(target, self.origin) && target.path == "/api/proxy") {
                        self.proxied = true
                        // Capture before replacing the failed item; its clock resets on replacement.
                        self.playbackPosition.prepareRetry(currentPosition: self.player.currentTime().seconds)
                        var proxy = URLComponents(url: self.origin.appendingPathComponent("api/proxy"), resolvingAgainstBaseURL: false)!
                        proxy.queryItems = [URLQueryItem(name: "url", value: target.absoluteString)]
                        self.info.text = "直连失败，正在通过服务重试…"; self.attach(proxy.url!, token: token)
                    } else { self.fail() }
                }
            }
        }
        if let observer = endedObserver { NotificationCenter.default.removeObserver(observer) }
        endedObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            guard let self, self.generation == token, !self.closed else { return }
            if self.checkDeadline() { return }
            self.finished = true; self.playbackPosition.record(0); self.emit("ended")
            if self.session.autoplayNext && self.session.index + 1 < self.session.episodes.count { self.load(self.session.index + 1) }
        }
    }
    private func fail() { player.pause(); info.text = "无法播放此源，请返回换源或使用网页播放器"; emit("error") }
    private var position: Double { guard !playbackPosition.isRestoring, player.currentItem?.status == .readyToPlay else { return playbackPosition.savedPosition }; let n = player.currentTime().seconds; return n.isFinite && n >= 0 ? n : playbackPosition.savedPosition }
    private var duration: Double { let n = player.currentItem?.duration.seconds ?? 0; return n.isFinite && n >= 0 ? n : 0 }
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
        player.pause(); info.text = "已定时停止，自动连播已关闭"; emit("sleep"); return true
    }
    private func updateTime() {
        if !slider.isTracking { slider.value = duration > 0 ? Float(position / duration) : 0 }
        let timer = sleepTimer.minutesRemaining.map { " · \($0) 分钟后停止" } ?? ""
        timeLabel.text = "\(format(position)) / \(format(duration))\(timer)"
        playButton.setTitle(player.rate == 0 ? "播放" : "暂停", for: .normal)
    }
    private func format(_ value: Double) -> String { let seconds = Int(value); return String(format: "%02d:%02d", seconds / 60, seconds % 60) }
    @objc private func toggle() {
        if checkDeadline() { return }
        if player.rate == 0 { userPaused = false; sleeping = false; if finished { finished = false; player.seek(to: .zero) }; player.playImmediately(atRate: session.rate) }
        else { userPaused = true; player.pause(); emit("pause") }
    }
    @objc private func seek() { if duration > 0 { finished = false; player.seek(to: CMTime(seconds: Double(slider.value) * duration, preferredTimescale: 600)) } }
    @objc private func previous() { selectEpisode(session.index - 1) }
    @objc private func nextEpisode() { selectEpisode(session.index + 1) }
    private func selectEpisode(_ index: Int) { guard session.episodes.indices.contains(index), index != session.index else { return }; emit("pause"); load(index) }
    @objc private func background() { userPaused = true; player.pause(); emit("pause") }
    @objc private func foreground() { _ = checkDeadline(); updateTime() }
    @objc private func rotate() {
        guard let scene = view.window?.windowScene else { return }
        let landscape = view.bounds.width > view.bounds.height
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .portrait : .landscapeRight))
    }
    @objc func closePlayer() {
        guard !closed else { return }; emit("close"); closed = true; resolveTask?.cancel(); tick?.invalidate(); player.pause(); player.replaceCurrentItem(with: nil)
        UIApplication.shared.isIdleTimerDisabled = false; try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        dismiss(animated: true) { [weak self] in self?.onClose?() }
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
    deinit { tick?.invalidate(); resolveTask?.cancel(); itemObservation = nil; if let observer = endedObserver { NotificationCenter.default.removeObserver(observer) }; NotificationCenter.default.removeObserver(self) }
}

private final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    let origin: URL
    init(origin: URL) { self.origin = origin }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map { sameOrigin($0, origin) } == true ? request : nil)
    }
}
