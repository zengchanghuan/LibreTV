import UIKit

/// A right-hand overlay shared by player drawers. It never owns or resizes the video.
class PlayerDrawerController: UIViewController {
    let panel = UIView()
    let backdrop = UIButton(type: .custom)
    let closeButton = UIButton(type: .system)
    let heading = UILabel()
    var onDismiss: (() -> Void)?
    private(set) var contentFrame = CGRect.zero

    private enum Presentation { case idle, entering, visible, exiting, hidden }
    private var presentation: Presentation = .idle
    private var animator: UIViewPropertyAnimator?
    private var exitCompletions: [() -> Void] = []
    private let drawerTitle: String
    private let overlayIdentifier: String
    private let panelIdentifier: String
    private let dismissIdentifier: String
    private let closeIdentifier: String

    init(title: String, overlayIdentifier: String, panelIdentifier: String, dismissIdentifier: String, closeIdentifier: String) {
        drawerTitle = title
        self.overlayIdentifier = overlayIdentifier
        self.panelIdentifier = panelIdentifier
        self.dismissIdentifier = dismissIdentifier
        self.closeIdentifier = closeIdentifier
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .dark
        view.backgroundColor = .clear
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = overlayIdentifier
        // This button consumes the touch; it cannot also pause the player underneath.
        backdrop.backgroundColor = UIColor.black.withAlphaComponent(0.12)
        backdrop.accessibilityLabel = "收起\(drawerTitle)"
        backdrop.accessibilityIdentifier = dismissIdentifier
        backdrop.addTarget(self, action: #selector(requestDismiss), for: .touchUpInside)
        view.addSubview(backdrop)

        panel.backgroundColor = NativeTheme(dark: true).page.withAlphaComponent(0.70)
        panel.accessibilityIdentifier = panelIdentifier
        panel.clipsToBounds = true
        view.addSubview(panel)
        heading.text = drawerTitle
        heading.textColor = .white
        heading.font = .preferredFont(forTextStyle: .headline)
        heading.adjustsFontForContentSizeCategory = true
        heading.numberOfLines = 2
        panel.addSubview(heading)
        closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeButton.tintColor = .white
        closeButton.accessibilityLabel = "收起\(drawerTitle)"
        closeButton.accessibilityIdentifier = closeIdentifier
        closeButton.addTarget(self, action: #selector(requestDismiss), for: .touchUpInside)
        panel.addSubview(closeButton)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let bounds = view.bounds
        let safe = view.safeAreaInsets
        let landscape = bounds.width > bounds.height
        let maximumWidth = max(0, bounds.width - max(44, safe.left))
        let preferredWidth = landscape ? min(480, max(360, bounds.width * 0.46)) : min(360, maximumWidth)
        let width = min(preferredWidth, maximumWidth)
        let size = CGSize(width: width, height: bounds.height)
        let center = CGPoint(x: bounds.maxX - width / 2, y: bounds.midY)
        let geometryChanged = panel.bounds.size != size || panel.center != center

        // Setting a transformed view's frame is undefined. Bounds/center keep a
        // slide stable during ordinary layout; rotation finishes it in its new geometry.
        if geometryChanged && animator != nil {
            animator?.stopAnimation(true)
            animator = nil
        }
        backdrop.frame = bounds
        panel.bounds = CGRect(origin: .zero, size: size)
        panel.center = center
        if geometryChanged {
            switch presentation {
            case .exiting, .hidden:
                panel.transform = CGAffineTransform(translationX: width, y: 0)
                backdrop.alpha = 0
                if presentation == .exiting {
                    presentation = .hidden
                    DispatchQueue.main.async { [weak self] in self?.finishExit() }
                }
            case .idle, .entering, .visible:
                panel.transform = .identity
                panel.alpha = 1
                backdrop.alpha = 1
                if presentation == .entering { presentation = .visible }
            }
        }

        let left: CGFloat = 16
        let right: CGFloat = 16 + safe.right
        let top = max(12, safe.top + 8)
        let availableWidth = max(0, width - left - right)
        let headingWidth = max(0, availableWidth - 52)
        let headingHeight = max(44, heading.sizeThatFits(CGSize(width: headingWidth, height: .greatestFiniteMagnitude)).height)
        heading.frame = CGRect(x: left, y: top, width: headingWidth, height: headingHeight)
        closeButton.frame = CGRect(x: width - right - 44, y: top, width: 44, height: 44)
        contentFrame = CGRect(x: left, y: top + headingHeight + 12, width: availableWidth,
                              height: max(0, bounds.height - top - headingHeight - 24 - safe.bottom))
    }

    func animateIn() {
        loadViewIfNeeded()
        view.layoutIfNeeded()
        guard presentation == .idle || presentation == .hidden else { return }
        animator?.stopAnimation(true)
        presentation = .entering
        view.isUserInteractionEnabled = true
        panel.isUserInteractionEnabled = true
        backdrop.isUserInteractionEnabled = true
        let reducedMotion = UIAccessibility.isReduceMotionEnabled
        panel.transform = reducedMotion ? .identity : CGAffineTransform(translationX: panel.bounds.width, y: 0)
        panel.alpha = reducedMotion ? 0 : 1
        backdrop.alpha = 0
        let animation = UIViewPropertyAnimator(duration: reducedMotion ? 0.12 : 0.26, curve: .easeOut) { [weak self] in
            self?.panel.transform = .identity
            self?.panel.alpha = 1
            self?.backdrop.alpha = 1
        }
        animator = animation
        animation.addCompletion { [weak self] _ in
            guard let self, self.presentation == .entering else { return }
            self.animator = nil
            self.presentation = .visible
            UIAccessibility.post(notification: .screenChanged, argument: self.heading)
        }
        animation.startAnimation()
    }

    func animateOut(completion: @escaping () -> Void) {
        loadViewIfNeeded()
        exitCompletions.append(completion)
        if presentation == .hidden { finishExit(); return }
        guard presentation != .exiting else { return }
        let visibleTransform = panel.layer.presentation()?.affineTransform()
        let visibleAlpha = panel.layer.presentation()?.opacity
        let backdropAlpha = backdrop.layer.presentation()?.opacity
        animator?.stopAnimation(true)
        if let visibleTransform { panel.transform = visibleTransform }
        if let visibleAlpha { panel.alpha = CGFloat(visibleAlpha) }
        if let backdropAlpha { backdrop.alpha = CGFloat(backdropAlpha) }
        presentation = .exiting
        // Keep the overlay hit-testable until removal; disable only its controls.
        panel.isUserInteractionEnabled = false
        backdrop.isUserInteractionEnabled = false
        let reducedMotion = UIAccessibility.isReduceMotionEnabled
        let animation = UIViewPropertyAnimator(duration: reducedMotion ? 0.12 : 0.24, curve: .easeIn) { [weak self] in
            guard let self else { return }
            if reducedMotion { self.panel.alpha = 0 }
            else { self.panel.transform = CGAffineTransform(translationX: self.panel.bounds.width, y: 0) }
            self.backdrop.alpha = 0
        }
        animator = animation
        animation.addCompletion { [weak self] _ in
            guard let self, self.presentation == .exiting else { return }
            self.presentation = .hidden
            self.animator = nil
            self.finishExit()
        }
        animation.startAnimation()
    }

    private func finishExit() {
        let completions = exitCompletions
        exitCompletions.removeAll()
        completions.forEach { $0() }
    }
    @objc private func requestDismiss() { onDismiss?() }
    override func accessibilityPerformEscape() -> Bool { onDismiss?(); return true }
}
