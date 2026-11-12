import UIKit

/// The portrait page below the fixed 16:9 player. The collection stays virtualized
/// for large episode catalogs and survives rotations without recreating playback.
final class PlayerPortraitInfoView: UIView, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    private let heading = UILabel(), subtitle = UILabel(), sectionTitle = UILabel(), countLabel = UILabel()
    private let infoHeader = UIView()
    let collection: UICollectionView
    private var episodes: [Episode] = []
    private var current = 0
    private var lastCollectionSize = CGSize.zero
    private var needsRevealCurrent = true
    private var theme = NativeTheme.current
    var onSelect: ((Int) -> Void)?

    override init(frame: CGRect) {
        let layout = UICollectionViewFlowLayout()
        layout.minimumInteritemSpacing = 8; layout.minimumLineSpacing = 8
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(frame: frame)
        accessibilityIdentifier = "player.portrait-details"
        heading.font = .preferredFont(forTextStyle: .title2); heading.numberOfLines = 2
        subtitle.font = .preferredFont(forTextStyle: .subheadline); subtitle.numberOfLines = 2
        sectionTitle.text = "选集"; sectionTitle.font = .preferredFont(forTextStyle: .headline)
        countLabel.font = .preferredFont(forTextStyle: .footnote); countLabel.textAlignment = .right
        [heading, subtitle, sectionTitle, countLabel].forEach {
            $0.adjustsFontForContentSizeCategory = true; infoHeader.addSubview($0)
        }
        collection.backgroundColor = .clear; collection.contentInsetAdjustmentBehavior = .never
        collection.dataSource = self; collection.delegate = self
        collection.register(PortraitEpisodeCell.self, forCellWithReuseIdentifier: "episode")
        collection.register(UICollectionReusableView.self, forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader, withReuseIdentifier: "info")
        collection.accessibilityIdentifier = "player.page-episodes"
        addSubview(collection)
        applyTheme()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func update(title: String, episodes: [Episode], current: Int) {
        heading.text = title; self.episodes = episodes; self.current = current
        subtitle.text = episodes.indices.contains(current) ? "当前播放 · " + episodes[current].title : nil
        countLabel.text = "共 \(episodes.count) 集"
        needsRevealCurrent = true
        collection.reloadData(); collection.collectionViewLayout.invalidateLayout(); setNeedsLayout()
    }
    private func applyTheme() {
        theme = NativeTheme.current; overrideUserInterfaceStyle = theme.style
        backgroundColor = theme.surface; heading.textColor = theme.content; sectionTitle.textColor = theme.content
        subtitle.textColor = theme.muted; countLabel.textColor = theme.muted
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        applyTheme()
        collection.frame = CGRect(x: 20, y: 0, width: max(0, bounds.width - 40), height: bounds.height)
        collection.contentInset.bottom = max(20, safeAreaInsets.bottom + 8)
        if lastCollectionSize != collection.bounds.size {
            lastCollectionSize = collection.bounds.size
            collection.collectionViewLayout.invalidateLayout()
            needsRevealCurrent = true
        }
        if needsRevealCurrent, !isHidden, collection.bounds.height > 0, episodes.indices.contains(current) {
            collection.layoutIfNeeded()
            let selected = IndexPath(item: current, section: 0)
            let visible = collection.bounds.inset(by: collection.adjustedContentInset)
            if let item = collection.layoutAttributesForItem(at: selected), !visible.contains(item.frame) {
                collection.scrollToItem(at: selected, at: .centeredVertically, animated: false)
            }
            needsRevealCurrent = false
        }
    }
    private func layoutHeader(width: CGFloat) -> CGFloat {
        let titleHeight = min(heading.font.lineHeight * 2, heading.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
        heading.frame = CGRect(x: 0, y: 20, width: width, height: ceil(titleHeight))
        let subtitleHeight = min(subtitle.font.lineHeight * 2, subtitle.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
        subtitle.frame = CGRect(x: 0, y: heading.frame.maxY + 6, width: width, height: ceil(subtitleHeight))
        let sectionY = subtitle.frame.maxY + 24
        let sectionHeight = max(28, sectionTitle.font.lineHeight)
        sectionTitle.frame = CGRect(x: 0, y: sectionY, width: width * 0.55, height: sectionHeight)
        countLabel.frame = CGRect(x: width * 0.55, y: sectionY, width: width * 0.45, height: sectionHeight)
        return sectionTitle.frame.maxY + 12
    }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, referenceSizeForHeaderInSection section: Int) -> CGSize {
        CGSize(width: collectionView.bounds.width, height: layoutHeader(width: collectionView.bounds.width))
    }
    func collectionView(_ collectionView: UICollectionView, viewForSupplementaryElementOfKind kind: String, at indexPath: IndexPath) -> UICollectionReusableView {
        let header = collectionView.dequeueReusableSupplementaryView(ofKind: kind, withReuseIdentifier: "info", for: indexPath)
        infoHeader.frame = header.bounds; infoHeader.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        header.addSubview(infoHeader)
        return header
    }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { episodes.count }
    private func shortTitle(_ index: Int) -> String? {
        let title = episodes[index].title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard title.range(of: "^(第\\s*)?[0-9０-９一二三四五六七八九十百零〇两]+\\s*(集|话|期)?$", options: .regularExpression) != nil else { return nil }
        return title.replacingOccurrences(of: "[第集话期\\s]", with: "", options: .regularExpression)
    }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "episode", for: indexPath) as! PortraitEpisodeCell
        let selected = indexPath.item == current
        cell.label.text = shortTitle(indexPath.item) ?? episodes[indexPath.item].title
        cell.label.textColor = selected ? theme.accent : theme.content
        cell.contentView.backgroundColor = selected ? theme.accent.withAlphaComponent(0.14) : theme.chip
        cell.playingMark.isHidden = !selected; cell.playingMark.tintColor = theme.accent
        cell.accessibilityIdentifier = "player.page-episode.\(indexPath.item)"
        cell.accessibilityLabel = episodes[indexPath.item].title + (selected ? "，当前集" : "")
        cell.accessibilityTraits = selected ? [.button, .selected] : .button
        return cell
    }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let font = UIFont.preferredFont(forTextStyle: .body)
        let columns = max(1, min(5, Int((collectionView.bounds.width + 8) / (max(44, font.pointSize * 2.6) + 8))))
        let width = shortTitle(indexPath.item) == nil ? collectionView.bounds.width : floor((collectionView.bounds.width - CGFloat(columns - 1) * 8) / CGFloat(columns))
        let title = shortTitle(indexPath.item) ?? episodes[indexPath.item].title
        let height = (title as NSString).boundingRect(with: CGSize(width: max(1, width - 16), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height
        return CGSize(width: width, height: max(52, ceil(height) + 26))
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { onSelect?(indexPath.item) }
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
            collection.collectionViewLayout.invalidateLayout(); setNeedsLayout()
        }
    }
}

private final class PortraitEpisodeCell: UICollectionViewCell {
    let label = UILabel()
    let playingMark = UIImageView(image: UIImage(systemName: "chart.bar.fill"))
    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.layer.cornerRadius = 10
        label.font = .preferredFont(forTextStyle: .body); label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0; label.textAlignment = .center
        contentView.addSubview(label); contentView.addSubview(playingMark)
        playingMark.contentMode = .scaleAspectFit
        isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        label.frame = contentView.bounds.insetBy(dx: 8, dy: 12)
        playingMark.frame = CGRect(x: 7, y: contentView.bounds.height - 14, width: 11, height: 9)
    }
}
