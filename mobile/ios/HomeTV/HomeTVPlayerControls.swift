import UIKit

/// ZFPlayer still owns seeking, buffering, and playback gestures. HomeTV places
/// those same controls into its portrait and landscape layouts.
final class HomeTVPlayerControls: ZFPlayerControlView {
    var onToggle: (() -> Void)?
    var onSeek: (() -> Void)?
    /// A portrait 16:9 video is also wider than tall, so the owning screen must
    /// supply the orientation instead of deriving it from this view's bounds.
    var landscapeLayout = false {
        didSet {
            guard oldValue != landscapeLayout else { return }
            if !landscapeLayout { unlockControls() }
            setNeedsLayout()
        }
    }
    private(set) var controlsLocked = false
    let heading = UILabel()
    let message = UILabel()
    let backButton = UIButton(type: .system)
    let playButton = UIButton(type: .system)
    let nextButton = UIButton(type: .system)
    let pipButton = UIButton(type: .system)
    let lockButton = UIButton(type: .system)
    let episodesButton = UIButton(type: .system)
    let speedButton = UIButton(type: .system)
    let sleepButton = UIButton(type: .system)
    let downloadButton = UIButton(type: .system)
    let moreButton = UIButton(type: .system)
    let rotateButton = UIButton(type: .system)
    private let header = UIView()
    private let footer = UIView()
    private let timeline = UIView()
    private let timeSeparator = UILabel()
    private let shade = CAGradientLayer()
    private let topShade = CAGradientLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        effectViewShow = false
        seekToPlay = false
        prepareShowControlView = true
        prepareShowLoading = true
        activity.loadingView.removeFromSuperview()
        activity.loadingView = HomeTVLoadingView()
        activity.addSubview(activity.loadingView)
        autoHiddenTimeInterval = 4
        // ZF's hide completion may unhide this view; keep it transparent too.
        bottomPgrogress.isHidden = true; bottomPgrogress.alpha = 0
        portraitControlView.topToolView.isHidden = true
        portraitControlView.bottomToolView.isHidden = true
        portraitControlView.playOrPauseBtn.isHidden = true
        portraitControlView.fullScreenBtn.isHidden = true
        let slider = portraitControlView.slider
        slider.sliderHeight = 3; slider.sliderRadius = 1.5
        slider.minimumTrackTintColor = NativeTheme(dark: true).accent
        slider.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.25)
        slider.bufferTrackTintColor = UIColor.white.withAlphaComponent(0.45)
        if let thumb = UIImage(systemName: "circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 10)) {
            slider.setThumbImage(thumb.withTintColor(NativeTheme(dark: true).accent, renderingMode: .alwaysOriginal), for: .normal)
            slider.thumbSize = CGSize(width: 10, height: 10)
        }
        let originalSliderChange = portraitControlView.sliderValueChanging
        portraitControlView.sliderValueChanging = { [weak self] value, forward in
            guard self?.controlsLocked != true else { return }
            self?.onSeek?(); originalSliderChange?(value, forward)
        }
        slider.accessibilityIdentifier = "player.timeline"
        slider.accessibilityLabel = "播放进度"
        // Reparent, rather than duplicate, ZF's slider and time labels so the
        // manager's time/buffer updates and seek callbacks remain unchanged.
        [slider, portraitControlView.currentTimeLabel, portraitControlView.totalTimeLabel].forEach(timeline.addSubview)
        [portraitControlView.currentTimeLabel, portraitControlView.totalTimeLabel, timeSeparator].forEach {
            $0.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
            $0.textAlignment = .left; $0.textColor = .white
            $0.adjustsFontSizeToFitWidth = true; $0.minimumScaleFactor = 0.85
        }
        portraitControlView.totalTimeLabel.textColor = UIColor.white.withAlphaComponent(0.75)
        timeSeparator.text = "/"; timeSeparator.textAlignment = .center
        timeSeparator.textColor = UIColor.white.withAlphaComponent(0.75)
        timeline.addSubview(timeSeparator)
        footer.addSubview(timeline)
        shade.colors = [UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.85).cgColor]
        layer.insertSublayer(shade, at: 0)
        topShade.colors = [UIColor.black.withAlphaComponent(0.65).cgColor, UIColor.clear.cgColor]
        layer.insertSublayer(topShade, at: 0)
        heading.textColor = .white; heading.numberOfLines = 2
        heading.font = .systemFont(ofSize: 15, weight: .medium)
        heading.lineBreakMode = .byTruncatingTail
        configure(backButton, symbol: "chevron.left", label: "收起播放器", id: "player.back")
        configure(pipButton, symbol: "pip.enter", label: "小窗播放", id: "player.pip")
        configure(moreButton, symbol: nil, label: "播放器设置", id: "player.more")
        // A square template keeps the vertical dots circular. Rotating SF's
        // very wide ellipsis image view can stretch its intrinsic-size layout.
        let dots = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { _ in
            UIColor.white.setFill()
            for y: CGFloat in [5, 12, 19] { UIBezierPath(ovalIn: CGRect(x: 10.5, y: y - 1.5, width: 3, height: 3)).fill() }
        }
        moreButton.setImage(dots.withRenderingMode(.alwaysTemplate), for: .normal)
        [backButton, heading, pipButton, moreButton].forEach(header.addSubview)
        configure(playButton, symbol: "pause.fill", label: "暂停", id: "player.play", symbolSize: 23)
        configure(nextButton, symbol: "forward.end.fill", label: "下一集", id: "player.next", symbolSize: 22)
        configure(episodesButton, symbol: nil, label: "选集", id: "player.episodes")
        episodesButton.setTitle("选集", for: .normal)
        configure(speedButton, symbol: nil, label: "倍速", id: "player.speed")
        speedButton.titleLabel?.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        configure(rotateButton, symbol: "arrow.up.left.and.arrow.down.right", label: "切换横屏", id: "player.rotate", symbolSize: 20)
        configure(lockButton, symbol: "lock.open", label: "锁定控件", id: "player.lock", symbolSize: 20)
        lockButton.backgroundColor = UIColor.black.withAlphaComponent(0.18)
        lockButton.layer.cornerRadius = 22
        lockButton.addTarget(self, action: #selector(toggleControlLock), for: .touchUpInside)
        [playButton, nextButton, episodesButton, speedButton, rotateButton].forEach(footer.addSubview)
        // The owning settings drawer reuses these actions; they are never
        // permanent player buttons.
        for (button, title, symbol, id) in [(sleepButton, "定时停止", "timer", "player.sleep"), (downloadButton, "缓存影片", "arrow.down.to.line", "player.download")] {
            var config = UIButton.Configuration.plain()
            config.title = title; config.image = UIImage(systemName: symbol)
            config.imagePadding = 12; config.baseForegroundColor = .white
            config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
            button.configuration = config; button.contentHorizontalAlignment = .leading
            button.accessibilityIdentifier = id
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        message.textColor = .white; message.numberOfLines = 0; message.textAlignment = .center
        message.font = .systemFont(ofSize: 14); message.isUserInteractionEnabled = false
        addSubview(header); addSubview(footer); addSubview(lockButton); addSubview(message)
        controlViewAppearedCallback = { [weak self] appeared in self?.applyVisibility(appeared) }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func configure(_ button: UIButton, symbol: String?, label: String, id: String, symbolSize: CGFloat = 19) {
        button.tintColor = .white; button.setTitleColor(.white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        if let symbol { button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: symbolSize, weight: .medium)), for: .normal) }
        button.accessibilityLabel = label; button.accessibilityIdentifier = id
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 100, bounds.height > 100 else { return }
        // ZF's layout only calculates the original bottom-tool frames. Our
        // controls still receive its events, then receive their final frames here.
        portraitControlView.frame = bounds
        portraitControlView.setNeedsLayout(); portraitControlView.layoutIfNeeded()
        portraitControlView.topToolView.isHidden = true
        portraitControlView.bottomToolView.isHidden = true
        portraitControlView.playOrPauseBtn.isHidden = true
        portraitControlView.fullScreenBtn.isHidden = true
        landScapeControlView.isHidden = true
        let horizontal: CGFloat = landscapeLayout ? 12 : 4
        let safe = bounds.inset(by: safeAreaInsets).insetBy(dx: horizontal, dy: 4)
        header.frame = CGRect(x: safe.minX, y: safe.minY, width: safe.width, height: 44)
        backButton.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
        moreButton.frame = CGRect(x: safe.width - 44, y: 0, width: 44, height: 44)
        let pipWidth: CGFloat = pipButton.isHidden ? 0 : 44
        pipButton.frame = CGRect(x: safe.width - 44 - pipWidth, y: 0, width: 44, height: 44)
        heading.frame = CGRect(x: 52, y: 0, width: max(0, safe.width - 104 - pipWidth), height: 44)
        heading.isHidden = !landscapeLayout
        backButton.accessibilityLabel = landscapeLayout ? "返回竖屏" : "收起播放器"
        let footerHeight: CGFloat = landscapeLayout ? 96 : 44
        footer.frame = CGRect(x: safe.minX, y: safe.maxY - footerHeight, width: safe.width, height: footerHeight)
        let current = portraitControlView.currentTimeLabel
        let total = portraitControlView.totalTimeLabel
        let currentWidth = max(34, min(58, ceil(current.sizeThatFits(CGSize(width: 100, height: 44)).width)))
        let totalWidth = max(34, min(58, ceil(total.sizeThatFits(CGSize(width: 100, height: 44)).width)))
        let timeWidth = currentWidth + totalWidth + 12
        if landscapeLayout {
            timeline.frame = CGRect(x: 0, y: 0, width: safe.width, height: 52)
            current.frame = CGRect(x: 0, y: 0, width: currentWidth, height: 18)
            timeSeparator.frame = CGRect(x: currentWidth, y: 0, width: 12, height: 18)
            total.frame = CGRect(x: currentWidth + 12, y: 0, width: totalWidth, height: 18)
            portraitControlView.slider.frame = CGRect(x: 0, y: 10, width: safe.width, height: 44)
            playButton.frame = CGRect(x: 0, y: 52, width: 44, height: 44)
            nextButton.frame = CGRect(x: 56, y: 52, width: 44, height: 44)
            speedButton.frame = CGRect(x: safe.width - 64, y: 52, width: 64, height: 44)
            episodesButton.frame = CGRect(x: safe.width - 136, y: 52, width: 64, height: 44)
        } else {
            playButton.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
            rotateButton.frame = CGRect(x: safe.width - 44, y: 0, width: 44, height: 44)
            timeline.frame = CGRect(x: 48, y: 0, width: max(0, safe.width - 96), height: 44)
            let sliderWidth = max(20, timeline.bounds.width - timeWidth - 8)
            portraitControlView.slider.frame = CGRect(x: 0, y: 0, width: sliderWidth, height: 44)
            current.frame = CGRect(x: sliderWidth + 8, y: 0, width: currentWidth, height: 44)
            timeSeparator.frame = CGRect(x: current.frame.maxX, y: 0, width: 12, height: 44)
            total.frame = CGRect(x: timeSeparator.frame.maxX, y: 0, width: totalWidth, height: 44)
        }
        // Alpha gates presentation while preserving the controller's per-film
        // `isHidden` state for a single-episode title.
        nextButton.alpha = landscapeLayout ? 1 : 0
        nextButton.isUserInteractionEnabled = landscapeLayout
        episodesButton.alpha = landscapeLayout ? 1 : 0
        episodesButton.isUserInteractionEnabled = landscapeLayout
        speedButton.alpha = landscapeLayout ? 1 : 0
        speedButton.isUserInteractionEnabled = landscapeLayout
        rotateButton.isHidden = landscapeLayout
        lockButton.frame = CGRect(x: safe.maxX - 44, y: safe.midY - 22, width: 44, height: 44)
        lockButton.isHidden = !landscapeLayout
        if landscapeLayout {
            message.font = .systemFont(ofSize: 14)
            message.frame = CGRect(x: safe.minX + 12, y: safe.midY - 45, width: max(0, safe.width - 24), height: 55)
            failBtn.frame = CGRect(x: safe.midX - 75, y: safe.midY + 18, width: 150, height: 44)
            activity.center = CGPoint(x: bounds.midX, y: bounds.midY)
        } else {
            // A 16:9 portrait surface has little vertical space. Keep errors,
            // loading feedback and the retry target between the two toolbars.
            let contentTop = header.frame.maxY + 4
            let contentBottom = footer.frame.minY - 4
            let contentHeight = max(0, contentBottom - contentTop)
            message.font = .systemFont(ofSize: contentHeight < 90 ? 12 : 14)
            message.adjustsFontSizeToFitWidth = true; message.minimumScaleFactor = 0.9
            failBtn.frame = CGRect(x: safe.midX - 60, y: contentBottom - 44, width: 120, height: 44)
            activity.bounds.size = CGSize(width: 32, height: 32)
            activity.center = CGPoint(x: safe.midX, y: contentTop + contentHeight / 2 - 10)
            let messageY = failBtn.isHidden ? activity.frame.maxY + 4 : contentTop
            let messageBottom = failBtn.isHidden ? contentBottom : failBtn.frame.minY - 4
            message.frame = CGRect(x: safe.minX + 12, y: messageY, width: max(0, safe.width - 24), height: min(44, max(0, messageBottom - messageY)))
        }
        fastView.center = CGPoint(x: bounds.midX, y: bounds.midY)
        topShade.frame = CGRect(x: 0, y: 0, width: bounds.width, height: min(bounds.height / 2, safe.minY + 84))
        shade.frame = CGRect(x: 0, y: max(0, footer.frame.minY - 36), width: bounds.width, height: bounds.height - max(0, footer.frame.minY - 36))
        applyVisibility(controlViewAppeared)
    }
    private func applyVisibility(_ appeared: Bool) {
        let visible = appeared && !controlsLocked
        header.alpha = visible ? 1 : 0
        footer.alpha = visible ? 1 : 0
        header.accessibilityElementsHidden = !visible
        footer.accessibilityElementsHidden = !visible
        lockButton.alpha = appeared || controlsLocked ? 1 : 0
        lockButton.accessibilityElementsHidden = !landscapeLayout || !(appeared || controlsLocked)
        shade.opacity = visible ? 1 : 0
        topShade.opacity = visible ? 1 : 0
        failBtn.isUserInteractionEnabled = !controlsLocked
    }
    @objc private func toggleControlLock() {
        controlsLocked.toggle()
        updateLockSymbol()
        if controlsLocked { applyVisibility(controlViewAppeared) }
        else { revealControls() }
    }
    private func updateLockSymbol() {
        lockButton.setImage(UIImage(systemName: controlsLocked ? "lock.fill" : "lock.open", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)), for: .normal)
        lockButton.accessibilityLabel = controlsLocked ? "解锁控件" : "锁定控件"
        lockButton.accessibilityValue = controlsLocked ? "已锁定" : "未锁定"
        lockButton.isSelected = controlsLocked
    }
    func unlockControls() {
        guard controlsLocked else { return }
        controlsLocked = false; updateLockSymbol(); revealControls()
    }
    func revealControls() {
        if !controlViewAppeared, let gesture = player?.gestureControl { super.gestureSingleTapped(gesture) }
        applyVisibility(controlViewAppeared)
    }
    override func gestureTriggerCondition(_ gestureControl: ZFPlayerGestureControl, gestureType: ZFPlayerGestureType, gestureRecognizer: UIGestureRecognizer, touch: UITouch) -> Bool {
        guard !isHidden, !controlsLocked else { return false }
        let point = touch.location(in: self)
        if header.alpha > 0 && (header.frame.contains(point) || footer.frame.contains(point)) { return false }
        if !lockButton.isHidden && lockButton.alpha > 0 && lockButton.frame.contains(point) { return false }
        // The original ZF hit test assumes its old bottom bar still parents the
        // slider. We use the actual custom footer above, avoiding a stale rect.
        if !customDisablePanMovingDirection { player?.disablePanMovingDirection = [] }
        return true
    }
    override func gestureSingleTapped(_ gestureControl: ZFPlayerGestureControl) {
        guard !controlsLocked else { return }
        super.gestureSingleTapped(gestureControl)
    }
    override func gestureBeganPan(_ gestureControl: ZFPlayerGestureControl, panDirection direction: ZFPanDirection, panLocation location: ZFPanLocation) {
        guard !controlsLocked else { return }
        if direction == .H { onSeek?() }
        super.gestureBeganPan(gestureControl, panDirection: direction, panLocation: location)
    }
    override func gestureDoubleTapped(_ gestureControl: ZFPlayerGestureControl) {
        guard !controlsLocked else { return }
        onToggle?()
    }
    func updatePlaying(_ playing: Bool) {
        playButton.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 23, weight: .medium)), for: .normal)
        playButton.accessibilityLabel = playing ? "暂停" : "播放"
        setNeedsLayout()
    }
}

/// Reuse ZFPlayer's buffering lifecycle with the app's current brand artwork.
private final class HomeTVLoadingView: ZFLoadingView {
    private let logo = UIImageView(image: UIImage(named: "BrandLogo"))

    override init(frame: CGRect) {
        super.init(frame: frame)
        lineColor = .clear
        hidesWhenStopped = true
        logo.contentMode = .scaleAspectFit
        logo.layer.cornerRadius = 8
        logo.clipsToBounds = true
        addSubview(logo)
        accessibilityLabel = "正在加载视频"
        isAccessibilityElement = true
        NotificationCenter.default.addObserver(self, selector: #selector(updateMotion), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { NotificationCenter.default.removeObserver(self) }

    override func layoutSubviews() {
        super.layoutSubviews()
        logo.frame = bounds
    }
    override func startAnimating() {
        super.startAnimating()
        updateMotion()
    }
    override func stopAnimating() {
        super.stopAnimating()
        logo.layer.removeAllAnimations()
    }
    @objc private func updateMotion() {
        logo.layer.removeAllAnimations()
        guard isAnimating, !UIAccessibility.isReduceMotionEnabled else { return }
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 0.55; pulse.toValue = 1
        pulse.duration = 0.7; pulse.autoreverses = true
        pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        logo.layer.add(pulse, forKey: "hometv.loading")
    }
}
