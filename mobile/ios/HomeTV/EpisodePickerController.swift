import UIKit

/// A transparent, in-player drawer. The video keeps its original frame beneath it.
final class EpisodePickerController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    let panel = UIView()
    let backdrop = UIButton(type: .custom)
    let closeButton = UIButton(type: .system)
    let collection: UICollectionView
    private let heading = UILabel()
    private let theme = NativeTheme(dark: true)
    private var episodes: [Episode]
    private var current: Int
    private var lastSize = CGSize.zero
    var onSelect: ((Int) -> Void)?
    var onDismiss: (() -> Void)?

    init(episodes: [Episode], current: Int) {
        self.episodes = episodes; self.current = current
        let layout = UICollectionViewFlowLayout()
        layout.minimumInteritemSpacing = 8; layout.minimumLineSpacing = 8
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.accessibilityIdentifier = "player.episode-overlay"
        backdrop.accessibilityIdentifier = "player.episode-dismiss"
        backdrop.accessibilityLabel = "收起选集"
        backdrop.addTarget(self, action: #selector(dismissPicker), for: .touchUpInside)
        view.addSubview(backdrop)
        panel.backgroundColor = theme.page.withAlphaComponent(0.82)
        panel.accessibilityIdentifier = "player.episode-pane"
        panel.clipsToBounds = true; view.addSubview(panel)
        heading.text = "选集"; heading.textColor = .white
        heading.font = .preferredFont(forTextStyle: .headline)
        heading.adjustsFontForContentSizeCategory = true; panel.addSubview(heading)
        closeButton.setImage(UIImage(systemName: "xmark"), for: .normal)
        closeButton.tintColor = .white; closeButton.accessibilityLabel = "收起选集"
        closeButton.accessibilityIdentifier = "player.episode-close"
        closeButton.addTarget(self, action: #selector(dismissPicker), for: .touchUpInside)
        panel.addSubview(closeButton)
        collection.backgroundColor = .clear
        collection.dataSource = self; collection.delegate = self
        collection.register(EpisodeGridCell.self, forCellWithReuseIdentifier: "episode")
        collection.contentInsetAdjustmentBehavior = .never
        panel.addSubview(collection)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let bounds = view.bounds
        backdrop.frame = bounds
        let landscape = bounds.width > bounds.height
        if landscape {
            let width = min(480, bounds.width * 0.46)
            panel.frame = CGRect(x: bounds.width - width, y: 0, width: width, height: bounds.height)
        } else {
            let height = bounds.height * 0.52
            panel.frame = CGRect(x: 0, y: bounds.height - height, width: bounds.width, height: height)
        }
        let safe = view.safeAreaInsets
        let left: CGFloat = 16
        let right = 16 + (landscape ? safe.right : 0)
        let top: CGFloat = landscape ? max(8, safe.top) : 8
        heading.frame = CGRect(x: left, y: top, width: panel.bounds.width - left - right - 52, height: 44)
        closeButton.frame = CGRect(x: panel.bounds.width - right - 44, y: top, width: 44, height: 44)
        collection.frame = CGRect(x: left, y: top + 52, width: panel.bounds.width - left - right, height: max(0, panel.bounds.height - top - 60 - safe.bottom))
        if lastSize != collection.bounds.size {
            lastSize = collection.bounds.size
            collection.collectionViewLayout.invalidateLayout()
            collection.layoutIfNeeded()
            scrollToCurrent()
        }
    }
    func update(episodes: [Episode], current: Int) {
        self.episodes = episodes; self.current = current
        guard isViewLoaded else { return }
        collection.reloadData(); collection.layoutIfNeeded(); scrollToCurrent()
    }
    private func scrollToCurrent() {
        guard episodes.indices.contains(current) else { return }
        collection.scrollToItem(at: IndexPath(item: current, section: 0), at: .centeredVertically, animated: false)
    }
    @objc private func dismissPicker() { onDismiss?() }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { episodes.count }
    private func shortTitle(_ index: Int) -> String? {
        let title = episodes[index].title.trimmingCharacters(in: .whitespacesAndNewlines)
        // Numbered episodes form the compact grid; named specials retain their full title.
        return title.range(of: "^(第\\s*)?[0-9０-９一二三四五六七八九十百零〇两]+\\s*(集|话|期)?$", options: .regularExpression) != nil ? title.replacingOccurrences(of: "[第集话期\\s]", with: "", options: .regularExpression) : nil
    }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "episode", for: indexPath) as! EpisodeGridCell
        let selected = indexPath.item == current
        cell.label.text = shortTitle(indexPath.item) ?? episodes[indexPath.item].title
        cell.label.textColor = selected ? theme.accent : .white
        cell.contentView.backgroundColor = UIColor.white.withAlphaComponent(selected ? 0.04 : 0.09)
        cell.contentView.layer.borderWidth = selected ? 1.5 : 0
        cell.contentView.layer.borderColor = theme.accent.cgColor
        cell.accessibilityIdentifier = "player.episode.\(indexPath.item)"
        cell.accessibilityLabel = episodes[indexPath.item].title + (selected ? "，当前集" : "")
        cell.accessibilityTraits = selected ? [.button, .selected] : [.button]
        return cell
    }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let width = collectionView.bounds.width
        let font = UIFont.preferredFont(forTextStyle: .body)
        let minimumWidth = max(60, font.pointSize * 3.5)
        let columns = max(1, min(5, Int((width + 8) / (minimumWidth + 8))))
        let named = shortTitle(indexPath.item) == nil
        let cellWidth = named ? width : floor((width - CGFloat(columns - 1) * 8) / CGFloat(columns))
        let text = shortTitle(indexPath.item) ?? episodes[indexPath.item].title
        let textHeight = (text as NSString).boundingRect(with: CGSize(width: max(1, cellWidth - 16), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height
        return CGSize(width: cellWidth, height: max(56, ceil(textHeight) + 24))
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { onSelect?(indexPath.item) }
}

final class EpisodeGridCell: UICollectionViewCell {
    let label = UILabel()
    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.layer.cornerRadius = 8
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0; label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false; contentView.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
            label.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            label.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)
        ])
        isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
