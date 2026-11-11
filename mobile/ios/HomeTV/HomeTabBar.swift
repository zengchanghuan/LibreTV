import UIKit

/// An opaque, compact bar whose layout stays consistent across iOS appearances.
final class HomeTabBar: UIView {
    var onSelect: ((Int) -> Void)?
    var selectedIndex = 0 { didSet { updateColors() } }
    private var theme = NativeTheme.current
    private let separator = UIView()
    private var buttons: [UIButton] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "browser.tabs"
        let stack = UIStackView(); stack.axis = .horizontal; stack.distribution = .fillEqually
        let items = [("首页", "house"), ("直播", "play.tv"), ("高清", "4k.tv"), ("设置", "gearshape")]
        for (index, item) in items.enumerated() {
            let button = UIButton(type: .system)
            var config = UIButton.Configuration.plain()
            config.image = UIImage(systemName: item.1, withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .regular))
            config.title = item.0; config.imagePlacement = .top; config.imagePadding = 4
            config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 2, bottom: 4, trailing: 2)
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var value = attributes; value.font = UIFont.systemFont(ofSize: 11, weight: .medium); return value
            }
            button.configuration = config
            button.accessibilityLabel = item.0; button.accessibilityIdentifier = "browser.tab.\(index)"
            button.addAction(UIAction { [weak self] _ in self?.selectedIndex = index; self?.onSelect?(index) }, for: .touchUpInside)
            buttons.append(button); stack.addArrangedSubview(button)
        }
        for child in [separator, stack] { child.translatesAutoresizingMaskIntoConstraints = false; addSubview(child) }
        NSLayoutConstraint.activate([
            separator.topAnchor.constraint(equalTo: topAnchor), separator.leadingAnchor.constraint(equalTo: leadingAnchor), separator.trailingAnchor.constraint(equalTo: trailingAnchor), separator.heightAnchor.constraint(equalToConstant: 0.5),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 1), stack.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 8), stack.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -8), stack.heightAnchor.constraint(equalToConstant: 55)
        ])
        apply(theme)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func apply(_ value: NativeTheme) { theme = value; overrideUserInterfaceStyle = value.style; backgroundColor = value.surface; separator.backgroundColor = value.line; updateColors() }
    private func updateColors() {
        for (index, button) in buttons.enumerated() {
            let selected = index == selectedIndex
            button.configuration?.baseForegroundColor = selected ? theme.accent : theme.muted
            button.accessibilityTraits = selected ? [.button, .selected] : [.button]
        }
    }
}
