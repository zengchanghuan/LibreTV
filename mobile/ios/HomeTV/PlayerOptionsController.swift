import UIKit

/// Settings only emit user intent. The player owns playback, timer and preferences.
final class PlayerOptionsController: PlayerDrawerController {
    var onSleepTimerChanged: ((Int) -> Void)?
    var onAutoplayNextChanged: ((Bool) -> Void)?
    var onSmallWindowChanged: ((Bool) -> Void)?
    var onBackgroundAudioChanged: ((Bool) -> Void)?

    private let scrollView = UIScrollView()
    private let content = UIView()
    private let timerHeading = UILabel(), timerStatus = UILabel()
    private let timerMinutes = [0, 15, 30, 60]
    private var timerButtons: [UIButton] = []
    private let timerMenuButton: UIButton?
    private let actionButtons: [UIButton]
    private let switchGroup = UIView()
    private let autoplayRow = PlayerOptionSwitchRow(title: "自动连播", identifier: "player.options.autoplay-next")
    private let smallWindowRow = PlayerOptionSwitchRow(title: "允许小窗播放", identifier: "player.options.small-window")
    private let backgroundRow = PlayerOptionSwitchRow(title: "后台播放声音", identifier: "player.options.background-audio")
    private let accent = NativeTheme(dark: true).accent
    private var autoplayNext = false, hasMultipleEpisodes = true, smallWindow = true, backgroundAudio = false
    private var sleepMinutesRemaining: Int?
    private var selectedTimerMinutes: Int? = 0

    init(buttons: [UIButton]) {
        let timer = buttons.first { $0.accessibilityIdentifier == "player.sleep" }
        timerMenuButton = timer
        actionButtons = buttons.filter { $0 !== timer }
        super.init(title: "播放器设置", overlayIdentifier: "player.options-overlay", panelIdentifier: "player.options-panel",
                   dismissIdentifier: "player.options-dismiss", closeIdentifier: "player.options-close")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        scrollView.backgroundColor = .clear
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.alwaysBounceVertical = true
        scrollView.indicatorStyle = .white
        panel.addSubview(scrollView)
        scrollView.addSubview(content)
        timerHeading.text = "定时停止"
        timerHeading.textColor = .white
        timerHeading.font = .preferredFont(forTextStyle: .subheadline)
        timerStatus.textColor = accent
        timerStatus.font = .preferredFont(forTextStyle: .footnote)
        for label in [timerHeading, timerStatus] {
            label.adjustsFontForContentSizeCategory = true
            label.numberOfLines = 0
            content.addSubview(label)
        }
        for minutes in timerMinutes {
            let button = UIButton(type: .system)
            button.tag = minutes
            button.accessibilityIdentifier = "player.options.timer.\(minutes)"
            button.accessibilityLabel = minutes == 0 ? "关闭定时停止" : "\(minutes) 分钟后停止"
            button.addTarget(self, action: #selector(selectTimer(_:)), for: .touchUpInside)
            button.layer.cornerRadius = 10
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            content.addSubview(button)
            timerButtons.append(button)
        }
        if let timerMenuButton {
            // The full menu stays available without taking another settings row.
            var configuration = UIButton.Configuration.plain()
            configuration.title = "更多"
            configuration.baseForegroundColor = accent
            configuration.contentInsets = .zero
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var result = attributes
                result.font = UIFont.preferredFont(forTextStyle: .subheadline)
                return result
            }
            timerMenuButton.configuration = configuration
            timerMenuButton.contentHorizontalAlignment = .center
            timerMenuButton.titleLabel?.adjustsFontForContentSizeCategory = true
            content.addSubview(timerMenuButton)
        }
        switchGroup.backgroundColor = UIColor.white.withAlphaComponent(0.055)
        switchGroup.layer.cornerRadius = 12
        content.addSubview(switchGroup)
        [autoplayRow, smallWindowRow, backgroundRow].forEach(switchGroup.addSubview)
        backgroundRow.showsDivider = false
        autoplayRow.onChange = { [weak self] enabled in self?.onAutoplayNextChanged?(enabled) }
        smallWindowRow.onChange = { [weak self] enabled in self?.onSmallWindowChanged?(enabled) }
        backgroundRow.onChange = { [weak self] enabled in self?.onBackgroundAudioChanged?(enabled) }
        actionButtons.forEach { styleAction($0); content.addSubview($0) }
        refreshState()
    }

    /// Called by the player's progress tick; unchanged state does not rebuild or animate.
    func update(autoplayNext: Bool, hasMultipleEpisodes: Bool, smallWindow: Bool, backgroundAudio: Bool, sleepMinutesRemaining: Int?) {
        let timerChanged = self.sleepMinutesRemaining != sleepMinutesRemaining
        let changed = self.autoplayNext != autoplayNext || self.hasMultipleEpisodes != hasMultipleEpisodes ||
            self.smallWindow != smallWindow || self.backgroundAudio != backgroundAudio || timerChanged
        if timerChanged {
            if let remaining = sleepMinutesRemaining {
                if self.sleepMinutesRemaining == nil || remaining > (self.sleepMinutesRemaining ?? 0) ||
                    abs(remaining - (self.sleepMinutesRemaining ?? remaining)) > 1 {
                    selectedTimerMinutes = timerMinutes.contains(remaining) ? remaining : nil
                }
            } else { selectedTimerMinutes = 0 }
        }
        self.autoplayNext = autoplayNext
        self.hasMultipleEpisodes = hasMultipleEpisodes
        self.smallWindow = smallWindow
        self.backgroundAudio = backgroundAudio
        self.sleepMinutesRemaining = sleepMinutesRemaining
        guard isViewLoaded, changed else { return }
        refreshState()
        if timerChanged { view.setNeedsLayout() }
    }

    private func refreshState() {
        timerStatus.text = sleepMinutesRemaining.map { "剩余 \($0) 分钟" } ?? "未开启"
        autoplayRow.toggle.setOn(autoplayNext, animated: false)
        autoplayRow.toggle.isEnabled = hasMultipleEpisodes
        autoplayRow.titleLabel.alpha = hasMultipleEpisodes ? 1 : 0.5
        smallWindowRow.toggle.setOn(smallWindow, animated: false)
        backgroundRow.toggle.setOn(backgroundAudio, animated: false)
        refreshTimerButtons()
    }

    private func refreshTimerButtons() {
        for button in timerButtons {
            let selected = selectedTimerMinutes == button.tag
            button.isSelected = selected
            button.accessibilityTraits = selected ? [.button, .selected] : [.button]
            var configuration = UIButton.Configuration.plain()
            configuration.title = button.tag == 0 ? "关闭" : "\(button.tag) 分"
            configuration.baseForegroundColor = selected ? accent : .white
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4)
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var result = attributes
                result.font = UIFont.preferredFont(forTextStyle: .subheadline)
                return result
            }
            button.configuration = configuration
            button.backgroundColor = selected ? accent.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.09)
        }
    }

    private func styleAction(_ button: UIButton) {
        button.backgroundColor = UIColor.white.withAlphaComponent(0.055)
        button.layer.cornerRadius = 12
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.adjustsFontForContentSizeCategory = true
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        scrollView.frame = contentFrame
        let width = contentFrame.width
        guard width > 0 else { return }
        let menuSize = timerMenuButton?.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)) ?? .zero
        let menuWidth = timerMenuButton == nil ? 0 : min(width / 2, max(44, menuSize.width))
        let labelsWidth = max(1, width - menuWidth - (menuWidth > 0 ? 8 : 0))
        let headingSize = timerHeading.sizeThatFits(CGSize(width: labelsWidth, height: .greatestFiniteMagnitude))
        let statusSize = timerStatus.sizeThatFits(CGSize(width: labelsWidth, height: .greatestFiniteMagnitude))
        let stackHeader = headingSize.width + statusSize.width + 12 > labelsWidth
        let labelsHeight = stackHeader ? headingSize.height + statusSize.height + 4 : max(headingSize.height, statusSize.height)
        let headerHeight = max(44, labelsHeight, menuSize.height)
        let labelsTop = (headerHeight - labelsHeight) / 2
        timerHeading.frame = CGRect(x: 0, y: labelsTop, width: stackHeader ? labelsWidth : headingSize.width, height: headingSize.height)
        timerStatus.frame = CGRect(x: stackHeader ? 0 : headingSize.width + 12, y: stackHeader ? labelsTop + headingSize.height + 4 : labelsTop,
                                   width: stackHeader ? labelsWidth : statusSize.width, height: statusSize.height)
        timerMenuButton?.frame = CGRect(x: width - menuWidth, y: 0, width: menuWidth, height: headerHeight)
        var y = headerHeight + 6
        let font = UIFont.preferredFont(forTextStyle: .subheadline)
        let columns = max(1, min(4, Int((width + 6) / (max(58, font.pointSize * 3.4) + 6))))
        let buttonWidth = floor((width - CGFloat(columns - 1) * 6) / CGFloat(columns))
        let buttonHeight = max(44, ceil(font.lineHeight) + 16)
        for (index, button) in timerButtons.enumerated() {
            button.frame = CGRect(x: CGFloat(index % columns) * (buttonWidth + 6), y: y + CGFloat(index / columns) * (buttonHeight + 6),
                                  width: buttonWidth, height: buttonHeight)
        }
        y += CGFloat((timerButtons.count + columns - 1) / columns) * (buttonHeight + 6) + 4
        var rowsHeight: CGFloat = 0
        for row in [autoplayRow, smallWindowRow, backgroundRow] {
            let height = row.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
            row.frame = CGRect(x: 0, y: rowsHeight, width: width, height: height)
            rowsHeight += height
        }
        switchGroup.frame = CGRect(x: 0, y: y, width: width, height: rowsHeight)
        y += rowsHeight + 10
        for button in actionButtons where !button.isHidden {
            let height = max(44, button.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
            button.frame = CGRect(x: 0, y: y, width: width, height: height)
            y += height + 10
        }
        content.frame = CGRect(x: 0, y: 0, width: width, height: y)
        scrollView.contentSize = content.bounds.size
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        guard previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory else { return }
        refreshTimerButtons()
        view.setNeedsLayout()
    }
    @objc private func selectTimer(_ button: UIButton) {
        selectedTimerMinutes = button.tag
        refreshTimerButtons()
        onSleepTimerChanged?(button.tag)
    }
}

private final class PlayerOptionSwitchRow: UIView {
    let titleLabel = UILabel()
    let toggle = UISwitch()
    var onChange: ((Bool) -> Void)?
    var showsDivider = true { didSet { divider.isHidden = !showsDivider } }
    private let divider = UIView()

    init(title: String, identifier: String) {
        super.init(frame: .zero)
        titleLabel.text = title
        titleLabel.textColor = .white
        titleLabel.font = .preferredFont(forTextStyle: .body)
        titleLabel.numberOfLines = 0
        titleLabel.adjustsFontForContentSizeCategory = true
        addSubview(titleLabel)
        toggle.onTintColor = NativeTheme(dark: true).accent
        toggle.accessibilityLabel = title
        toggle.accessibilityIdentifier = identifier
        toggle.addTarget(self, action: #selector(changed), for: .valueChanged)
        addSubview(toggle)
        divider.backgroundColor = UIColor.white.withAlphaComponent(0.08)
        addSubview(divider)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let labelHeight = titleLabel.sizeThatFits(CGSize(width: max(1, size.width - 24 - 51 - 12), height: .greatestFiniteMagnitude)).height
        return CGSize(width: size.width, height: max(44, ceil(labelHeight) + 20))
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        let toggleSize = toggle.sizeThatFits(bounds.size)
        toggle.frame = CGRect(x: bounds.width - 12 - toggleSize.width, y: (bounds.height - toggleSize.height) / 2,
                              width: toggleSize.width, height: toggleSize.height)
        titleLabel.frame = CGRect(x: 12, y: 10, width: max(0, toggle.frame.minX - 24), height: max(0, bounds.height - 20))
        divider.frame = CGRect(x: 12, y: bounds.height - 1 / UIScreen.main.scale, width: max(0, bounds.width - 24), height: 1 / UIScreen.main.scale)
    }
    @objc private func changed() { onChange?(toggle.isOn) }
}
