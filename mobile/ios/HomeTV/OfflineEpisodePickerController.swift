import UIKit

/// Batch selection uses the original episode URLs so queued resolvers can refresh URLs.
final class OfflineEpisodePickerController: UIViewController, UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    private let session: PlaybackSession
    private let origin: URL
    private let downloads: OfflineDownloads
    private var selected = Set<Int>()
    private let collection: UICollectionView
    private let add = UIButton(type: .system), note = UILabel(), heading = UILabel()
    private var groupID: String { OfflineIdentity.group(origin: origin, source: session.sourceKey, video: session.vodId) }
    var onAdded: ((Int) -> Void)?
    init(session: PlaybackSession, origin: URL, downloads: OfflineDownloads = .shared) {
        self.session = session; self.origin = origin; self.downloads = downloads
        let layout = UICollectionViewFlowLayout(); layout.minimumInteritemSpacing = 10; layout.minimumLineSpacing = 10
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemGroupedBackground; title = session.episodes.count > 1 ? "缓存选集" : "缓存影片"
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "我的缓存", style: .plain, target: self, action: #selector(showDownloads))
        heading.text = session.title; heading.font = .preferredFont(forTextStyle: .headline); heading.numberOfLines = 0
        note.numberOfLines = 0; note.font = .preferredFont(forTextStyle: .footnote); note.textColor = .secondaryLabel
        collection.backgroundColor = .clear; collection.dataSource = self; collection.delegate = self
        collection.register(EpisodeGridCell.self, forCellWithReuseIdentifier: "episode")
        collection.accessibilityIdentifier = "offline.episodes"
        add.configuration = .filled(); add.configuration?.cornerStyle = .large
        add.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        add.accessibilityIdentifier = "offline.add-selected"; add.addTarget(self, action: #selector(enqueueSelected), for: .touchUpInside)
        let select = UIButton(type: .system); select.setTitle("全选可缓存", for: .normal)
        select.accessibilityIdentifier = "offline.select-all"; select.contentHorizontalAlignment = .trailing
        select.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        select.addTarget(self, action: #selector(selectAllEpisodes), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [heading, note, select, collection, add]); stack.axis = .vertical; stack.spacing = 14; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20), stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12), stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)])
        if available(session.index) { selected.insert(session.index) }
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: OfflineDownloads.changed, object: downloads)
        refresh()
    }
    private func existing(_ index: Int) -> OfflineVideo? {
        guard let url = URL(string: session.episodes[index].url) else { return nil }
        return downloads.library?.matching(url: url, origin: origin, identity: OfflineIdentity.episode(group: groupID, index: index))
    }
    private func available(_ index: Int) -> Bool { existing(index).map { $0.state == .failed } ?? true }
    @objc private func refresh() {
        selected = selected.filter { available($0) }
        add.setTitle("加入缓存（\(selected.count)\(session.episodes.count > 1 ? " 集" : " 部")）", for: .normal); add.isEnabled = !selected.isEmpty
        note.text = "\(downloads.allowsCellular ? "允许使用蜂窝流量" : "仅 Wi-Fi 缓存") · 同时缓存 \(downloads.concurrency) 个\n保存在这台手机，影片大小暂未知。"
        collection.reloadData()
    }
    @objc private func selectAllEpisodes() { selected = Set(session.episodes.indices.filter { available($0) }); refresh() }
    @objc private func close() { dismiss(animated: true) }
    @objc private func showDownloads() { navigationController?.pushViewController(OfflineDownloadsController(downloads: downloads), animated: true) }
    @objc private func enqueueSelected() {
        var count = 0
        do {
            for index in selected.sorted() {
                let episode = session.episodes[index]
                guard let url = URL(string: episode.url) else { continue }
                let episodeTitle = session.episodes.count > 1 ? (episode.title.isEmpty ? "第 \(index + 1) 集" : episode.title) : "电影"
                try downloads.enqueue(url: url, title: session.title + (session.episodes.count > 1 ? " " + episodeTitle : ""), origin: origin, cookies: [], identity: OfflineIdentity.episode(group: groupID, index: index), groupID: groupID, groupTitle: session.title, episodeTitle: episodeTitle)
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
        let index = indexPath.item, cell = collectionView.dequeueReusableCell(withReuseIdentifier: "episode", for: indexPath) as! EpisodeGridCell
        let video = existing(index), chosen = selected.contains(index), enabled = available(index)
        let status = video.map { $0.state == .completed ? "已缓存" : $0.state == .failed ? "可重试" : "已加入" } ?? (chosen ? "已选择" : "可缓存")
        cell.label.text = "\(session.episodes[index].title)\n\(status)"
        cell.label.textColor = !enabled ? .secondaryLabel : chosen ? .systemBlue : .label
        cell.contentView.backgroundColor = chosen ? UIColor.systemBlue.withAlphaComponent(0.12) : .secondarySystemGroupedBackground
        cell.contentView.layer.borderWidth = chosen ? 1.5 : 0; cell.contentView.layer.borderColor = UIColor.systemBlue.cgColor
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
        let columns = max(1, min(5, Int((width + 10) / max(100, font.pointSize * 5))))
        let cellWidth = floor((width - CGFloat(columns - 1) * 10) / CGFloat(columns))
        let text = session.episodes[indexPath.item].title + "\n已加入"
        let height = (text as NSString).boundingRect(with: CGSize(width: max(1, cellWidth - 16), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height
        return CGSize(width: cellWidth, height: max(76, ceil(height) + 24))
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); collection.collectionViewLayout.invalidateLayout() }
    deinit { NotificationCenter.default.removeObserver(self) }
}
