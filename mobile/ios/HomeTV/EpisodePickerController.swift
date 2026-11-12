import UIKit

/// A transparent, in-player drawer. The video keeps its original frame beneath it.
final class EpisodePickerController: PlayerDrawerController, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    let collection: UICollectionView
    private let theme = NativeTheme(dark: true)
    private var episodes: [Episode]
    private var current: Int
    private var lastSize = CGSize.zero
    var onSelect: ((Int) -> Void)?

    init(episodes: [Episode], current: Int) {
        self.episodes = episodes; self.current = current
        let layout = UICollectionViewFlowLayout()
        layout.minimumInteritemSpacing = 8; layout.minimumLineSpacing = 8
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(title: "选集", overlayIdentifier: "player.episode-overlay", panelIdentifier: "player.episode-pane",
                   dismissIdentifier: "player.episode-dismiss", closeIdentifier: "player.episode-close")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        collection.backgroundColor = .clear
        collection.dataSource = self; collection.delegate = self
        collection.register(EpisodeGridCell.self, forCellWithReuseIdentifier: "episode")
        collection.contentInsetAdjustmentBehavior = .never
        collection.alwaysBounceVertical = true
        collection.indicatorStyle = .white
        panel.addSubview(collection)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        collection.frame = contentFrame
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
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        guard previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory else { return }
        collection.collectionViewLayout.invalidateLayout()
        collection.reloadData()
        view.setNeedsLayout()
    }
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
        cell.contentView.backgroundColor = selected ? theme.accent.withAlphaComponent(0.18) : UIColor.white.withAlphaComponent(0.09)
        cell.playingIndicator.isHidden = !selected
        cell.playingIndicator.tintColor = theme.accent
        cell.accessibilityIdentifier = "player.episode.\(indexPath.item)"
        cell.accessibilityLabel = episodes[indexPath.item].title + (selected ? "，当前集" : "")
        cell.accessibilityTraits = selected ? [.button, .selected] : [.button]
        return cell
    }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let width = collectionView.bounds.width
        let font = UIFont.preferredFont(forTextStyle: .body)
        let minimumWidth = max(44, font.pointSize * 2.7)
        let maximumColumns = view.bounds.width > view.bounds.height ? 5 : 4
        let columns = max(1, min(maximumColumns, Int((width + 8) / (minimumWidth + 8))))
        let named = shortTitle(indexPath.item) == nil
        let cellWidth = named ? width : floor((width - CGFloat(columns - 1) * 8) / CGFloat(columns))
        let text = shortTitle(indexPath.item) ?? episodes[indexPath.item].title
        let textHeight = (text as NSString).boundingRect(with: CGSize(width: max(1, cellWidth - 16), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height
        return CGSize(width: cellWidth, height: max(60, ceil(textHeight) + 32))
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { onSelect?(indexPath.item) }
}

final class EpisodeGridCell: UICollectionViewCell {
    let label = UILabel()
    let playingIndicator = EpisodePlayingIndicator()
    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.layer.cornerRadius = 10
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0; label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false; contentView.addSubview(label)
        playingIndicator.translatesAutoresizingMaskIntoConstraints = false
        playingIndicator.isUserInteractionEnabled = false
        playingIndicator.isAccessibilityElement = false
        playingIndicator.accessibilityIdentifier = "player.episode-playing"
        contentView.addSubview(playingIndicator)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
            label.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
            label.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -22),
            playingIndicator.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 9),
            playingIndicator.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8),
            playingIndicator.widthAnchor.constraint(equalToConstant: 14),
            playingIndicator.heightAnchor.constraint(equalToConstant: 11)
        ])
        isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

final class EpisodePlayingIndicator: UIView {
    private let bars = [UIView(), UIView(), UIView()]
    override init(frame: CGRect) {
        super.init(frame: frame)
        bars.forEach { $0.layer.cornerRadius = 1; addSubview($0) }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        for (index, height) in [CGFloat(11), 6, 9].enumerated() {
            bars[index].frame = CGRect(x: CGFloat(index) * 5, y: bounds.height - height, width: 3, height: height)
            bars[index].backgroundColor = tintColor
        }
    }
    override func tintColorDidChange() {
        super.tintColorDidChange()
        bars.forEach { $0.backgroundColor = tintColor }
    }
}
