import UIKit

/// Batch selection uses the original episode URLs so queued resolvers can refresh URLs.
final class OfflineEpisodePickerController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    private let session: PlaybackSession
    private let origin: URL
    private let cookies: [HTTPCookie]
    private let select = UIButton(type: .system), selectionCount = UILabel()
    private let accent = NativeTheme(dark: true).accent
    private let downloads: OfflineDownloads
    private var selected = Set<Int>()
    private let collection: UICollectionView
    private var contentStack: UIStackView?
    private let add = UIButton(type: .system), note = UILabel(), heading = UILabel()
    private var groupID: String { OfflineIdentity.group(origin: origin, source: session.sourceKey, video: session.vodId) }
    var onAdded: ((Int) -> Void)?
    init(session: PlaybackSession, origin: URL, cookies: [HTTPCookie] = [], downloads: OfflineDownloads = .shared) {
        self.session = session; self.origin = origin; self.cookies = cookies; self.downloads = downloads
        let layout = UICollectionViewFlowLayout(); layout.minimumInteritemSpacing = 10; layout.minimumLineSpacing = 10
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); overrideUserInterfaceStyle = .dark; view.backgroundColor = .systemGroupedBackground; title = "缓存影片"
        navigationController?.overrideUserInterfaceStyle = .dark
        view.tintColor = accent
        navigationItem.leftBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(close))
        navigationItem.leftBarButtonItem?.accessibilityLabel = "关闭缓存影片"
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "我的缓存", style: .plain, target: self, action: #selector(showDownloads))
        heading.text = session.title; heading.font = .preferredFont(forTextStyle: .headline); heading.numberOfLines = 0
        note.numberOfLines = 0; note.font = .preferredFont(forTextStyle: .footnote); note.textColor = .secondaryLabel
        collection.backgroundColor = .clear; collection.dataSource = self; collection.delegate = self
        collection.register(OfflineSelectionCell.self, forCellWithReuseIdentifier: "episode")
        collection.accessibilityIdentifier = "offline.episodes"
        add.configuration = .filled(); add.configuration?.cornerStyle = .large
        add.configuration?.baseBackgroundColor = accent; add.configuration?.baseForegroundColor = .black
        add.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        add.accessibilityIdentifier = "offline.add-selected"; add.addTarget(self, action: #selector(enqueueSelected), for: .touchUpInside)
        select.setTitle("全选", for: .normal)
        select.accessibilityIdentifier = "offline.select-all"; select.contentHorizontalAlignment = .leading
        select.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        select.addTarget(self, action: #selector(selectAllEpisodes), for: .touchUpInside)
        selectionCount.font = .preferredFont(forTextStyle: .subheadline); selectionCount.textColor = .secondaryLabel
        let toolbar = UIStackView(arrangedSubviews: [select, selectionCount]); toolbar.distribution = .equalSpacing; toolbar.alignment = .center
        let stack = UIStackView(arrangedSubviews: [heading, note, toolbar, collection]); stack.axis = .vertical; stack.spacing = 14; stack.translatesAutoresizingMaskIntoConstraints = false
        contentStack = stack
        view.addSubview(stack)
        add.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(add)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20), stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12), stack.bottomAnchor.constraint(equalTo: add.topAnchor, constant: -12), add.leadingAnchor.constraint(equalTo: stack.leadingAnchor), add.trailingAnchor.constraint(equalTo: stack.trailingAnchor), add.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)])
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: OfflineDownloads.changed, object: downloads)
        refresh()
    }
    private func existing(_ index: Int) -> OfflineVideo? {
        guard let url = URL(string: session.episodes[index].url) else { return nil }
        return downloads.library?.matching(url: url, origin: origin, identity: OfflineIdentity.episode(group: groupID, index: index))
    }
    private func available(_ index: Int) -> Bool {
        guard session.episodes.indices.contains(index), let url = URL(string: session.episodes[index].url), ["http", "https"].contains(url.scheme) else { return false }
        return existing(index).map { $0.state == .failed } ?? true
    }
    @objc private func refresh() {
        selected = selected.filter { available($0) }
        add.setTitle("开始缓存（\(selected.count)\(session.episodes.count > 1 ? " 集" : " 部")）", for: .normal); add.isEnabled = !selected.isEmpty
        selectionCount.text = "已选 \(selected.count) \(session.episodes.count > 1 ? "集" : "部")"
        let availableIndices = Set(session.episodes.indices.filter { available($0) })
        select.isEnabled = !availableIndices.isEmpty
        select.setTitle(!availableIndices.isEmpty && selected == availableIndices ? "取消全选" : "全选", for: .normal)
        note.text = "\(downloads.allowsCellular ? "允许使用蜂窝流量" : "仅 Wi-Fi 缓存") · 同时缓存 \(downloads.concurrency) 个\n保存在这台手机，影片大小暂未知。"
        collection.reloadData()
    }
    @objc private func selectAllEpisodes() {
        let availableIndices = Set(session.episodes.indices.filter { available($0) })
        selected = selected == availableIndices ? [] : availableIndices; refresh()
    }
    @objc private func close() { dismiss(animated: true) }
    @objc private func showDownloads() { navigationController?.pushViewController(OfflineDownloadsController(downloads: downloads), animated: true) }
    @objc private func enqueueSelected() {
        var count = 0
        do {
            for index in selected.sorted() where available(index) {
                let episode = session.episodes[index]
                guard let url = URL(string: episode.url) else { continue }
                let episodeTitle = session.episodes.count > 1 ? (episode.title.isEmpty ? "第 \(index + 1) 集" : episode.title) : "电影"
                try downloads.enqueue(url: url, title: session.title + (session.episodes.count > 1 ? " " + episodeTitle : ""), origin: origin, cookies: cookies, identity: OfflineIdentity.episode(group: groupID, index: index), groupID: groupID, groupTitle: session.title, episodeTitle: episodeTitle)
                count += 1
            }
            let callback = onAdded
            dismiss(animated: true) { callback?(count) }
        } catch {
            let prompt = UIAlertController(title: count > 0 ? "已加入 \(count) 项，其余未加入" : "无法加入缓存", message: error.localizedDescription, preferredStyle: .alert)
            prompt.addAction(UIAlertAction(title: "好", style: .default)); present(prompt, animated: true); refresh()
        }
    }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { session.episodes.count }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let index = indexPath.item, cell = collectionView.dequeueReusableCell(withReuseIdentifier: "episode", for: indexPath) as! OfflineSelectionCell
        let video = existing(index), chosen = selected.contains(index), enabled = available(index)
        let status: String
        switch video?.state {
        case .completed: status = "已缓存"
        case .failed: status = "失败，可重试"
        case .downloading: status = "缓存中 \(Int((video?.progress ?? 0) * 100))%"
        case .paused: status = "已暂停"
        case .waitingForNetwork: status = "等待网络"
        case .verifying: status = "校验中"
        case .preparing: status = "准备中"
        case .queued: status = "排队中"
        case nil: status = chosen ? "已选择" : "可缓存"
        }
        let title = session.episodes[index].title.isEmpty ? (session.episodes.count > 1 ? "第 \(index + 1) 集" : "电影") : session.episodes[index].title
        cell.label.text = title
        cell.status.text = status
        cell.checkmark.image = UIImage(systemName: chosen ? "checkmark.square.fill" : "square")
        cell.checkmark.tintColor = chosen ? accent : .tertiaryLabel
        cell.label.textColor = enabled ? .label : .secondaryLabel
        cell.progress.isHidden = video?.state != .downloading
        cell.progress.progress = Float(video?.progress ?? 0)
        cell.progress.progressTintColor = accent
        cell.contentView.backgroundColor = chosen ? accent.withAlphaComponent(0.08) : .secondarySystemGroupedBackground
        cell.contentView.layer.borderWidth = 1
        cell.contentView.layer.borderColor = (chosen ? accent : UIColor.separator).cgColor
        cell.accessibilityLabel = "\(session.episodes[index].title)，\(status)"
        cell.accessibilityIdentifier = "offline.episode.\(index)"
        cell.accessibilityTraits = enabled ? (chosen ? [.button, .selected] : [.button]) : [.button, .notEnabled]
        return cell
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        let index = indexPath.item; guard available(index) else { return }
        if selected.contains(index) { selected.remove(index) } else { selected.insert(index) }; refresh()
    }
    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let width = collectionView.bounds.width, font = UIFont.preferredFont(forTextStyle: .body)
        let columns = max(1, min(4, Int((width + 10) / max(150, font.pointSize * 8))))
        let cellWidth = floor((width - CGFloat(columns - 1) * 10) / CGFloat(columns))
        let text = session.episodes[indexPath.item].title + "\n已加入"
        let height = (text as NSString).boundingRect(with: CGSize(width: max(1, cellWidth - 52), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height
        return CGSize(width: cellWidth, height: max(90, ceil(height) + 28))
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let compact = view.bounds.width > view.bounds.height
        if heading.isHidden != compact {
            heading.isHidden = compact; note.isHidden = compact
            contentStack?.spacing = compact ? 8 : 14
        }
        collection.collectionViewLayout.invalidateLayout()
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}

private final class OfflineSelectionCell: UICollectionViewCell {
    let label = UILabel(), status = UILabel(), checkmark = UIImageView(), progress = UIProgressView(progressViewStyle: .default)
    override init(frame: CGRect) {
        super.init(frame: frame); isAccessibilityElement = true
        contentView.layer.cornerRadius = 10
        label.font = .preferredFont(forTextStyle: .body); label.numberOfLines = 0; label.adjustsFontForContentSizeCategory = true
        status.font = .preferredFont(forTextStyle: .caption1); status.textColor = .secondaryLabel; status.numberOfLines = 0
        status.adjustsFontForContentSizeCategory = true
        checkmark.contentMode = .scaleAspectFit
        let text = UIStackView(arrangedSubviews: [label, status, progress]); text.axis = .vertical; text.spacing = 6
        let row = UIStackView(arrangedSubviews: [checkmark, text]); row.alignment = .top; row.spacing = 10
        row.translatesAutoresizingMaskIntoConstraints = false; contentView.addSubview(row)
        NSLayoutConstraint.activate([
            checkmark.widthAnchor.constraint(equalToConstant: 22), checkmark.heightAnchor.constraint(equalToConstant: 24),
            row.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            row.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            row.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 14),
            row.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -12)
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
