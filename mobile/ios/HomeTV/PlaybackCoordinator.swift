import UIKit

/// Owns the live playback session independently of browser/offline-library pages.
/// Presentation transitions are serialized and stale controller actions are ignored.
final class PlaybackCoordinator {
    static let shared = PlaybackCoordinator()
    private(set) var current: PlayerController?
    private var overlay: UIWindow?
    private var mini: MiniPlaybackController?
    private weak var mainWindow: UIWindow?
    private var transitioning = false
    private var pending: [(@escaping () -> Void) -> Void] = []

    func start(_ controller: PlayerController, from presenter: UIViewController) {
        transition { [weak self, weak presenter] done in
            guard let self, let presenter, let window = presenter.view.window else { done(); return }
            self.mainWindow = window
            let launch = {
                self.current = controller
                controller.modalPresentationStyle = .fullScreen
                let host = self.presentationHost() ?? presenter
                host.present(controller, animated: true, completion: done)
            }
            if let old = self.current { self.finish(old, completion: launch) } else { launch() }
        }
    }
    func minimize(_ controller: PlayerController, completion: (() -> Void)? = nil) {
        transition { [weak self, weak controller] done in
            guard let self, let controller, self.current === controller else { completion?(); done(); return }
            guard self.mini == nil else { self.updateMini(); completion?(); done(); return }
            guard let window = self.mainWindow, let scene = window.windowScene else { completion?(); done(); return }
            let attach = {
                guard self.current === controller, !controller.hasStopped else { completion?(); done(); return }
                let mini = MiniPlaybackController(player: controller)
                let overlay = PlaybackOverlayWindow(windowScene: scene)
                overlay.windowLevel = .normal + 1; overlay.backgroundColor = .clear
                overlay.rootViewController = mini
                self.overlay = overlay; self.mini = mini
                overlay.isHidden = controller.isPictureInPictureActive
                controller.setMinimized(true)
                controller.restorePageOrientation(in: scene, presenter: window.rootViewController)
                self.updateMini(); completion?(); done()
            }
            controller.dismissTransientPanels()
            if let host = controller.presentingViewController { host.dismiss(animated: true, completion: attach) }
            else { attach() }
        }
    }
    func expand(_ controller: PlayerController, completion: ((Bool) -> Void)? = nil) {
        transition { [weak self, weak controller] done in
            guard let self, let controller, self.current === controller, !controller.hasStopped else { completion?(false); done(); return }
            guard self.mini != nil else { completion?(controller.presentingViewController != nil); done(); return }
            guard let host = self.presentationHost() else { completion?(false); done(); return }
            self.detachMini()
            controller.setMinimized(false)
            controller.modalPresentationStyle = .fullScreen
            host.present(controller, animated: true) { completion?(true); done() }
        }
    }
    func stop(_ controller: PlayerController) {
        transition { [weak self, weak controller] done in
            guard let self, let controller, self.current === controller else { done(); return }
            self.finish(controller, completion: done)
        }
    }
    private func finish(_ controller: PlayerController, completion: @escaping () -> Void) {
        controller.stopPlayback()
        let scene = mainWindow?.windowScene
        detachMini(); current = nil
        let finish = {
            controller.restorePageOrientation(in: scene, presenter: self.mainWindow?.rootViewController)
            completion()
        }
        if let host = controller.presentingViewController { host.dismiss(animated: false, completion: finish) }
        else { finish() }
    }
    private func detachMini() {
        mini?.detachPlayer(); overlay?.isHidden = true; overlay?.rootViewController = nil
        mini = nil; overlay = nil
    }
    func updateMini() {
        guard let current else { return }
        mini?.update(); overlay?.isHidden = current.isPictureInPictureActive
    }
    private func presentationHost() -> UIViewController? {
        var host = mainWindow?.rootViewController
        while let presented = host?.presentedViewController, presented !== current { host = presented }
        return host
    }
    private func transition(_ action: @escaping (@escaping () -> Void) -> Void) {
        guard !transitioning else { pending.append(action); return }
        transitioning = true
        action { [weak self] in
            guard let self else { return }
            self.transitioning = false
            if !self.pending.isEmpty { let next = self.pending.removeFirst(); self.transition(next) }
        }
    }
}

private final class PlaybackOverlayWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let result = super.hitTest(point, with: event), result !== rootViewController?.view else { return nil }
        return result
    }
}

private final class MiniPlaybackController: UIViewController {
    private let player: PlayerController
    private let card = UIView(), video = UIView()
    private let titleLabel = UILabel()
    private let play = UIButton(type: .system), expand = UIButton(type: .system), close = UIButton(type: .system)
    private var rightEdge = true, verticalFraction: CGFloat = 1
    init(player: PlayerController) { self.player = player; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .clear
        card.backgroundColor = .secondarySystemBackground; card.layer.cornerRadius = 14; card.clipsToBounds = true
        card.accessibilityIdentifier = "player.mini"
        view.addSubview(card); card.addSubview(video)
        addChild(player); video.addSubview(player.view); player.didMove(toParent: self)
        titleLabel.font = .preferredFont(forTextStyle: .caption1); titleLabel.textColor = .label; titleLabel.numberOfLines = 1
        card.addSubview(titleLabel)
        for (button, symbol, label, id) in [(play, "pause.fill", "暂停", "player.mini.play"), (expand, "arrow.up.left.and.arrow.down.right", "展开播放器", "player.mini.expand"), (close, "xmark", "停止播放", "player.mini.close")] {
            button.setImage(UIImage(systemName: symbol), for: .normal); button.accessibilityLabel = label; button.accessibilityIdentifier = id; card.addSubview(button)
        }
        play.addTarget(self, action: #selector(toggle), for: .touchUpInside)
        expand.addTarget(self, action: #selector(open), for: .touchUpInside)
        close.addTarget(self, action: #selector(stop), for: .touchUpInside)
        let pan = UIPanGestureRecognizer(target: self, action: #selector(drag)); video.addGestureRecognizer(pan)
        let tap = UITapGestureRecognizer(target: self, action: #selector(open)); tap.require(toFail: pan); video.addGestureRecognizer(tap)
        update()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let safe = view.bounds.inset(by: view.safeAreaInsets).insetBy(dx: 12, dy: 12)
        let width = min(244, safe.width), height = width * 9 / 16 + 68
        let maxY = max(safe.minY, safe.maxY - 72 - height)
        card.frame = CGRect(x: rightEdge ? safe.maxX - width : safe.minX, y: safe.minY + (maxY - safe.minY) * verticalFraction, width: width, height: height)
        video.frame = CGRect(x: 0, y: 0, width: width, height: width * 9 / 16)
        player.view.frame = video.bounds
        titleLabel.frame = CGRect(x: 10, y: video.frame.maxY + 4, width: width - 20, height: 20)
        play.frame = CGRect(x: 6, y: height - 44, width: 44, height: 44)
        expand.frame = CGRect(x: width / 2 - 22, y: height - 44, width: 44, height: 44)
        close.frame = CGRect(x: width - 50, y: height - 44, width: 44, height: 44)
    }
    func update() {
        guard isViewLoaded else { return }
        let theme = NativeTheme.current
        card.overrideUserInterfaceStyle = theme.style; card.backgroundColor = theme.surface
        titleLabel.textColor = theme.content
        [play, expand, close].forEach { $0.tintColor = theme.accent }
        titleLabel.text = player.session.title
        play.setImage(UIImage(systemName: player.isPlaybackRunning ? "pause.fill" : "play.fill"), for: .normal)
        play.accessibilityLabel = player.isPlaybackRunning ? "暂停" : "播放"
    }
    func detachPlayer() { player.willMove(toParent: nil); player.view.removeFromSuperview(); player.removeFromParent() }
    @objc private func toggle() { player.togglePlayback() }
    @objc private func open() { PlaybackCoordinator.shared.expand(player) }
    @objc private func stop() { player.closePlayer() }
    @objc private func drag(_ gesture: UIPanGestureRecognizer) {
        let delta = gesture.translation(in: view); gesture.setTranslation(.zero, in: view)
        card.center = CGPoint(x: card.center.x + delta.x, y: card.center.y + delta.y)
        if [.ended, .cancelled].contains(gesture.state) {
            rightEdge = card.frame.midX > view.bounds.midX
            let safe = view.bounds.inset(by: view.safeAreaInsets).insetBy(dx: 12, dy: 12)
            verticalFraction = min(1, max(0, (card.frame.minY - safe.minY) / max(1, safe.height - 72 - card.frame.height)))
            UIView.animate(withDuration: 0.2) { self.view.setNeedsLayout(); self.view.layoutIfNeeded() }
        }
    }
}
