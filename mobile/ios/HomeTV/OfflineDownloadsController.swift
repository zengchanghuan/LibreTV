import UIKit

final class OfflineDownloadsController: UITableViewController {
    private let downloads: OfflineDownloads
    private var groups: [(title: String, videos: [OfflineVideo])] = []
    private let summary = UILabel(), footer = UILabel()
    private let filter = UISegmentedControl(items: ["缓存中", "已缓存"])
    private let policy = UIButton(type: .system), all = UIButton(type: .system)
    private let header = UIStackView()
    private var selectedIDs = Set<String>()
    private var managementItem: UIBarButtonItem!
    init(downloads: OfflineDownloads = .shared) { self.downloads = downloads; super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "我的缓存"
        managementItem = UIBarButtonItem(title: "管理", style: .plain, target: self, action: #selector(toggleEditing))
        if navigationController?.viewControllers.first === self {
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(close))
            navigationItem.leftBarButtonItem = managementItem
        } else {
            // Preserve the back button when opened from the batch picker.
            navigationItem.rightBarButtonItem = managementItem
        }
        tableView.allowsMultipleSelectionDuringEditing = true
        tableView.register(OfflineTaskCell.self, forCellReuseIdentifier: "download")
        summary.numberOfLines = 0; summary.font = .preferredFont(forTextStyle: .footnote); summary.textColor = .secondaryLabel
        summary.adjustsFontForContentSizeCategory = true
        policy.contentHorizontalAlignment = .leading; policy.showsMenuAsPrimaryAction = true
        policy.titleLabel?.font = .preferredFont(forTextStyle: .footnote); policy.titleLabel?.numberOfLines = 0
        policy.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        policy.accessibilityIdentifier = "offline.policy"
        filter.selectedSegmentIndex = 0; filter.addTarget(self, action: #selector(changeFilter), for: .valueChanged)
        filter.accessibilityIdentifier = "offline.filter"
        all.addTarget(self, action: #selector(toggleAll), for: .touchUpInside)
        all.contentHorizontalAlignment = .trailing; all.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        all.accessibilityIdentifier = "offline.all"
        header.axis = .vertical; header.spacing = 8; header.isLayoutMarginsRelativeArrangement = true
        header.layoutMargins = UIEdgeInsets(top: 12, left: 20, bottom: 4, right: 20)
        [summary, policy, filter, all].forEach(header.addArrangedSubview)
        tableView.tableHeaderView = header
        footer.text = "缓存完成后可离线观看。强制退出 App 会中断任务。\n仅 Wi-Fi 模式下，网络切换后会等待 Wi-Fi。"
        footer.font = .preferredFont(forTextStyle: .footnote); footer.textColor = .secondaryLabel; footer.numberOfLines = 0
        footer.textAlignment = .center; tableView.tableFooterView = footer
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: OfflineDownloads.changed, object: downloads)
        downloads.restore(); refresh()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = tableView.bounds.width
        let height = header.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
        if header.frame.width != width || abs(header.frame.height - height) > 1 { header.frame = CGRect(x: 0, y: 0, width: width, height: height); tableView.tableHeaderView = header }
        let footerHeight = footer.sizeThatFits(CGSize(width: max(1, width - 40), height: .greatestFiniteMagnitude)).height + 36
        if footer.frame.width != width || footer.frame.height != footerHeight { footer.frame = CGRect(x: 0, y: 0, width: width, height: footerHeight); tableView.tableFooterView = footer }
    }
    @objc private func refresh() {
        let videos = downloads.videos
        let size = sizeText(videos.filter { $0.state == .completed }.reduce(0) { $0 + $1.bytes })
        let free = downloads.availableBytes.map { " · 手机可用 " + sizeText($0) } ?? ""
        let running = videos.filter { [.preparing, .downloading].contains($0.state) }.count
        let queued = videos.filter { [.queued, .waitingForNetwork].contains($0.state) }.count
        let failed = videos.filter { $0.state == .failed }.count
        summary.text = downloads.storageError ?? "已缓存 \(size)\(free)\n\(running) 个缓存中 · \(queued) 个等待\(failed > 0 ? " · \(failed) 个失败" : "")"
        filter.setTitle("缓存中 \(videos.filter { $0.state != .completed }.count)", forSegmentAt: 0)
        filter.setTitle("已缓存 \(videos.filter { $0.state == .completed }.count)", forSegmentAt: 1)
        policy.setTitle("\(downloads.allowsCellular ? "允许蜂窝网络" : "仅 Wi-Fi 缓存") · 同时缓存 \(downloads.concurrency) 个  ⌄", for: .normal)
        policy.menu = UIMenu(children: [UIMenu(title: "同时缓存", options: .displayInline, children: (1...3).map { count in
            UIAction(title: "\(count) 个任务", state: downloads.concurrency == count ? .on : .off) { [weak self] _ in self?.downloads.setConcurrency(count); self?.refresh() }
        }), UIAction(title: downloads.allowsCellular ? "改为仅 Wi-Fi" : "允许蜂窝网络") { [weak self] _ in self?.changeNetworkPolicy() }])
        all.setTitle(videos.contains(where: \.isScheduled) ? "全部暂停" : "全部继续", for: .normal)
        all.isHidden = filter.selectedSegmentIndex == 1 || isEditing
        all.isEnabled = videos.contains { $0.isScheduled || $0.state == .paused }
        let visible = videos.filter { ($0.state == .completed) == (filter.selectedSegmentIndex == 1) }
        var indexes: [String: Int] = [:]; groups = []
        for video in visible {
            let key = video.groupID ?? video.id
            if let index = indexes[key] { groups[index].videos.append(video) }
            else { indexes[key] = groups.count; groups.append((video.groupTitle ?? video.title, [video])) }
        }
        let validIDs = Set(visible.map(\.id)); selectedIDs.formIntersection(validIDs)
        tableView.reloadData()
        if isEditing {
            for (section, group) in groups.enumerated() { for (row, video) in group.videos.enumerated() where selectedIDs.contains(video.id) { tableView.selectRow(at: IndexPath(row: row, section: section), animated: false, scrollPosition: .none) } }
        }
        if groups.isEmpty {
            let empty = UILabel(); empty.numberOfLines = 0; empty.textAlignment = .center; empty.textColor = .secondaryLabel
            empty.text = filter.selectedSegmentIndex == 1 ? "还没有已完成的缓存" : "暂无缓存任务\n在播放器中点击缓存，可批量选择剧集"
            tableView.backgroundView = empty
        } else { tableView.backgroundView = nil }
        view.setNeedsLayout(); updateToolbar()
    }
    private func sizeText(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter(); formatter.countStyle = .file; formatter.allowsNonnumericFormatting = false
        return formatter.string(fromByteCount: bytes)
    }
    @objc private func changeFilter() { selectedIDs.removeAll(); refresh() }
    @objc private func close() { dismiss(animated: true) }
    @objc private func toggleAll() { downloads.videos.contains(where: \.isScheduled) ? downloads.pauseAll() : downloads.resumeAll() }
    private func changeNetworkPolicy() {
        let allow = !downloads.allowsCellular
        let prompt = UIAlertController(title: allow ? "允许使用蜂窝流量缓存？" : "改为仅 Wi-Fi 缓存？", message: "更改网络策略后，未完成的任务可能需要重新缓存。" + (allow ? "视频可能消耗较多流量。" : ""), preferredStyle: .alert)
        prompt.addAction(UIAlertAction(title: "取消", style: .cancel))
        prompt.addAction(UIAlertAction(title: "确定", style: .default) { [weak self] _ in self?.downloads.setAllowsCellular(allow); self?.refresh() })
        present(prompt, animated: true)
    }
    override func numberOfSections(in tableView: UITableView) -> Int { groups.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { groups[section].videos.count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { groups[section].title }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let video = groups[indexPath.section].videos[indexPath.row]
        let cell = tableView.dequeueReusableCell(withIdentifier: "download", for: indexPath) as! OfflineTaskCell
        cell.heading.text = video.episodeTitle ?? (video.groupTitle == nil ? "电影 / 单集" : video.title)
        let status: String, action: String
        switch video.state {
        case .queued: status = video.note ?? "排队中"; action = "优先缓存"
        case .preparing: status = "正在准备缓存…"; action = "暂停"
        case .downloading: status = "缓存中 · \(Int(video.progress * 100))%"; action = "暂停"
        case .waitingForNetwork: status = downloads.allowsCellular ? "等待网络连接" : "等待 Wi-Fi"; action = "暂停"
        case .paused: status = "已暂停 · \(Int(video.progress * 100))%"; action = "继续"
        case .verifying: status = "正在校验离线文件…"; action = "校验中"
        case .failed: status = video.error ?? "缓存失败，请重试"; action = "重试"
        case .completed:
            status = downloads.library?.playableURL(video.id) == nil ? "本地文件已丢失，请重新缓存" : "\(video.watched ? "已看完" : "可离线观看") · " + sizeText(video.bytes)
            action = downloads.library?.playableURL(video.id) == nil ? "重新缓存" : "播放"
        }
        cell.status.text = status; cell.status.textColor = video.state == .failed ? .systemOrange : .secondaryLabel
        cell.progress.progress = Float(video.progress); cell.progress.isHidden = ![.downloading, .paused].contains(video.state)
        cell.action.setTitle(action, for: .normal); cell.action.isEnabled = video.state != .verifying
        cell.action.isHidden = isEditing
        cell.onAction = { [weak self] in self?.perform(video.id) }
        cell.accessibilityIdentifier = "offline.video.\(video.id)"
        return cell
    }
    private func perform(_ id: String) {
        guard let video = downloads.library?.video(id) else { return }
        switch video.state {
        case .queued: downloads.prioritize(id)
        case .preparing, .downloading, .waitingForNetwork: downloads.pause(id)
        case .paused, .failed: downloads.resume(id)
        case .completed:
            if downloads.library?.playableURL(id) == nil { downloads.redownload(id); filter.selectedSegmentIndex = 0; refresh() }
            else { play(id) }
        case .verifying: break
        }
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let video = groups[indexPath.section].videos[indexPath.row]
        if isEditing { selectedIDs.insert(video.id); updateToolbar(); return }
        tableView.deselectRow(at: indexPath, animated: true)
        if video.state == .failed { alert((video.error ?? "缓存失败") + "\n\n" + (video.detail ?? "暂无更多详情")) }
        else if video.state == .completed { perform(video.id) }
    }
    override func tableView(_ tableView: UITableView, didDeselectRowAt indexPath: IndexPath) {
        if isEditing { selectedIDs.remove(groups[indexPath.section].videos[indexPath.row].id); updateToolbar() }
    }
    func play(_ id: String) {
        guard let video = downloads.library?.video(id), let file = downloads.library?.playableURL(id), let origin = URL(string: video.origin) else { return }
        let session = PlaybackSession(id: UUID().uuidString, title: video.title, sourceKey: "offline", vodId: video.id, sourceUrl: nil, profileId: nil, index: 0, episodes: [Episode(url: file.absoluteString, title: video.title, position: video.position)], rate: 1, autoplayNext: false, baseRevision: 0, openedAt: Int64(Date().timeIntervalSince1970 * 1000))
        let player = PlayerController(session: session, origin: origin, cookies: [])
        let downloads = self.downloads
        player.onProgress = { downloads.record(id, event: $0) }
        PlaybackCoordinator.shared.start(player, from: self)
    }
    @objc private func toggleEditing() { setEditing(!isEditing, animated: true) }
    override func setEditing(_ editing: Bool, animated: Bool) {
        super.setEditing(editing, animated: animated); selectedIDs.removeAll()
        managementItem.title = editing ? "取消" : "管理"
        navigationController?.setToolbarHidden(!editing, animated: animated); refresh()
    }
    private func updateToolbar() {
        guard isEditing else { return }
        let select = UIBarButtonItem(title: "全选", style: .plain, target: self, action: #selector(selectAllDownloads))
        let pause = UIBarButtonItem(title: "暂停", style: .plain, target: self, action: #selector(pauseSelected))
        let delete = UIBarButtonItem(title: "删除 (\(selectedIDs.count))", style: .plain, target: self, action: #selector(deleteSelected)); delete.tintColor = .systemRed
        pause.isEnabled = !selectedIDs.isEmpty; delete.isEnabled = !selectedIDs.isEmpty
        toolbarItems = [select, .flexibleSpace(), pause, .flexibleSpace(), delete]
    }
    @objc private func selectAllDownloads() { selectedIDs = Set(groups.flatMap(\.videos).map(\.id)); refresh() }
    @objc private func pauseSelected() { for id in selectedIDs { downloads.pause(id) } }
    @objc private func deleteSelected() { confirmDelete(Array(selectedIDs)) }
    private func confirmDelete(_ ids: [String]) {
        let prompt = UIAlertController(title: "删除 \(ids.count) 项缓存？", message: "将取消未完成任务，并删除这台手机上的对应文件和记录。", preferredStyle: .alert)
        prompt.addAction(UIAlertAction(title: "保留", style: .cancel))
        prompt.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            do { for id in ids { try self.downloads.delete(id) }; self.selectedIDs.subtract(ids); self.refresh() }
            catch { self.alert("删除失败：\(error.localizedDescription)") }
        }); present(prompt, animated: true)
    }
    override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let id = groups[indexPath.section].videos[indexPath.row].id
        let action = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, completion in self?.confirmDelete([id]); completion(true) }
        let config = UISwipeActionsConfiguration(actions: [action]); config.performsFirstActionWithFullSwipe = false; return config
    }
    private func alert(_ message: String) {
        let controller = UIAlertController(title: "缓存详情", message: message, preferredStyle: .alert)
        controller.addAction(UIAlertAction(title: "好", style: .default)); present(controller, animated: true)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}

private final class OfflineTaskCell: UITableViewCell {
    let heading = UILabel(), status = UILabel(), progress = UIProgressView(progressViewStyle: .default), action = UIButton(type: .system)
    var onAction: (() -> Void)?
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        heading.font = .preferredFont(forTextStyle: .body); status.font = .preferredFont(forTextStyle: .footnote)
        for label in [heading, status] { label.numberOfLines = 0; label.adjustsFontForContentSizeCategory = true }
        action.titleLabel?.font = .preferredFont(forTextStyle: .footnote); action.setContentCompressionResistancePriority(.required, for: .horizontal); action.setContentHuggingPriority(.required, for: .horizontal)
        action.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        action.widthAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true
        action.addTarget(self, action: #selector(tap), for: .touchUpInside)
        let text = UIStackView(arrangedSubviews: [heading, status]); text.axis = .vertical; text.spacing = 4
        let row = UIStackView(arrangedSubviews: [text, action]); row.spacing = 12; row.alignment = .center
        let stack = UIStackView(arrangedSubviews: [row, progress]); stack.axis = .vertical; stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false; contentView.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor), stack.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor), stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12), stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    @objc private func tap() { onAction?() }
}
