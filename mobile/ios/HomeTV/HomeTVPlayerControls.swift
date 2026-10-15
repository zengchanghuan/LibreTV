import UIKit

/// ZFPlayer owns the slider, buffering indicator and playback gestures. HomeTV
/// adds its episode/sleep actions; rotation stays with our presented controller.
final class HomeTVPlayerControls: ZFPlayerControlView {
    var onToggle: (() -> Void)?
    var onSeek: (() -> Void)?
    let heading = UILabel()
    let message = UILabel()
    let backButton = UIButton(type: .system)
    let previousButton = UIButton(type: .system)
    let playButton = UIButton(type: .system)
    let nextButton = UIButton(type: .system)
    let episodesButton = UIButton(type: .system)
    let speedButton = UIButton(type: .system)
    let sleepButton = UIButton(type: .system)
    let rotateButton = UIButton(type: .system)
    private let header = UIStackView()
    private let actions = UIStackView()
    private let shade = CAGradientLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        effectViewShow = false
        seekToPlay = false
        prepareShowControlView = true
        prepareShowLoading = true
        autoHiddenTimeInterval = 4
        bottomPgrogress.isHidden = true
        portraitControlView.topToolView.isHidden = true
        portraitControlView.playOrPauseBtn.isHidden = true
        portraitControlView.fullScreenBtn.isHidden = true
        portraitControlView.slider.sliderHeight = 3
        portraitControlView.slider.minimumTrackTintColor = .white
        portraitControlView.slider.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.25)
        portraitControlView.slider.bufferTrackTintColor = UIColor.white.withAlphaComponent(0.45)
        let originalSliderChange = portraitControlView.sliderValueChanging
        portraitControlView.sliderValueChanging = { [weak self] value, forward in
            self?.onSeek?(); originalSliderChange?(value, forward)
        }
        portraitControlView.slider.accessibilityIdentifier = "player.timeline"
        shade.colors = [UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.85).cgColor]
        layer.insertSublayer(shade, at: 0)
        header.axis = .horizontal; header.spacing = 8; header.alignment = .center
        heading.textColor = .white; heading.numberOfLines = 2
        heading.font = .systemFont(ofSize: 15, weight: .semibold)
        heading.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        configure(backButton, symbol: "chevron.left", label: "返回", id: "player.back")
        configure(rotateButton, symbol: "rotate.right", label: "横竖屏", id: "player.rotate")
        header.addArrangedSubview(backButton); header.addArrangedSubview(heading); header.addArrangedSubview(rotateButton)
        configure(previousButton, symbol: "backward.end.fill", label: "上一集", id: "player.previous")
        configure(playButton, symbol: "pause.fill", label: "暂停", id: "player.play")
        configure(nextButton, symbol: "forward.end.fill", label: "下一集", id: "player.next")
        configure(episodesButton, symbol: "list.bullet", label: "选集", id: "player.episodes")
        configure(sleepButton, symbol: "moon.zzz", label: "定时停止", id: "player.sleep")
        configure(speedButton, symbol: nil, label: "倍速", id: "player.speed")
        speedButton.titleLabel?.font = .monospacedDigitSystemFont(ofSize: 14, weight: .medium)
        actions.axis = .horizontal; actions.spacing = 4; actions.alignment = .center
        [previousButton, playButton, nextButton].forEach(actions.addArrangedSubview)
        let spacer = UIView(); spacer.setContentHuggingPriority(UILayoutPriority(1), for: .horizontal)
        actions.addArrangedSubview(spacer)
        [episodesButton, speedButton, sleepButton].forEach(actions.addArrangedSubview)
        message.textColor = .white; message.numberOfLines = 0; message.textAlignment = .center
        message.font = .systemFont(ofSize: 14); message.isUserInteractionEnabled = false
        addSubview(header); addSubview(actions); addSubview(message)
        controlViewAppearedCallback = { [weak self] appeared in
            guard let self else { return }
            self.header.alpha = appeared ? 1 : 0
            self.actions.alpha = appeared ? 1 : 0
            self.shade.opacity = appeared ? 1 : 0
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func configure(_ button: UIButton, symbol: String?, label: String, id: String) {
        button.tintColor = .white; button.setTitleColor(.white, for: .normal)
        if let symbol { button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .medium)), for: .normal) }
        button.accessibilityLabel = label; button.accessibilityIdentifier = id
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        // Inset the actual ZFPlayer controls so both slider and hit targets avoid
        // the landscape notch and portrait home indicator.
        guard bounds.width > 100, bounds.height > 140 else { return }
        let safe = bounds.inset(by: safeAreaInsets).insetBy(dx: 12, dy: 8)
        portraitControlView.frame = safe
        portraitControlView.setNeedsLayout(); portraitControlView.layoutIfNeeded()
        let bottom = portraitControlView.bottomToolView
        let current = portraitControlView.currentTimeLabel
        let total = portraitControlView.totalTimeLabel
        total.frame = CGRect(x: bottom.bounds.width - 65, y: 6, width: 62, height: 28)
        portraitControlView.slider.frame = CGRect(x: current.frame.maxX + 8, y: 5, width: max(0, total.frame.minX - current.frame.maxX - 16), height: 30)
        header.frame = CGRect(x: safe.minX, y: safe.minY, width: safe.width, height: 52)
        actions.frame = CGRect(x: safe.minX, y: safe.maxY - 90, width: safe.width, height: 44)
        message.frame = CGRect(x: safe.minX + 12, y: safe.midY - 75, width: safe.width - 24, height: 55)
        failBtn.frame = CGRect(x: safe.midX - 75, y: safe.midY, width: 150, height: 44)
        shade.frame = CGRect(x: 0, y: bounds.height - 160 - safeAreaInsets.bottom, width: bounds.width, height: 160 + safeAreaInsets.bottom)
    }
    override func gestureTriggerCondition(_ gestureControl: ZFPlayerGestureControl, gestureType: ZFPlayerGestureType, gestureRecognizer: UIGestureRecognizer, touch: UITouch) -> Bool {
        let point = touch.location(in: self)
        if header.alpha > 0 && (header.frame.contains(point) || actions.frame.contains(point)) { return false }
        let sliderRect = portraitControlView.slider.convert(portraitControlView.slider.bounds, to: self)
        if sliderRect.contains(point) { return false }
        return super.gestureTriggerCondition(gestureControl, gestureType: gestureType, gestureRecognizer: gestureRecognizer, touch: touch)
    }
    override func gestureBeganPan(_ gestureControl: ZFPlayerGestureControl, panDirection direction: ZFPanDirection, panLocation location: ZFPanLocation) {
        if direction == .H { onSeek?() }
        super.gestureBeganPan(gestureControl, panDirection: direction, panLocation: location)
    }
    override func gestureDoubleTapped(_ gestureControl: ZFPlayerGestureControl) { onToggle?() }
    func updatePlaying(_ playing: Bool) {
        playButton.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill"), for: .normal)
        playButton.accessibilityLabel = playing ? "暂停" : "播放"
    }
}
