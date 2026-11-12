import UIKit

final class OfflineDownloadsController: UITableViewController {
    private let downloads: OfflineDownloads
    private var groups: [(title: String, videos: [OfflineVideo])] = []
    private let summary = UILabel(), policySummary = UILabel(), queueSummary = UILabel(), disclosure = UILabel()
    private let filter = UISegmentedControl(items: ["缓存中", "已缓存"])
    private let policy = UIButton(type: .system), all = UIButton(type: .system)
    private let queueRow = UIStackView()
    private let header = UIStackView()
    private var theme = NativeTheme.current
    private var navigationStyle: UIUserInterfaceStyle?
    private var navigationTint: UIColor?
    private var selectedIDs = Set<String>()
    private var managementItem: UIBarButtonItem!
    init(downloads: OfflineDownloads = .shared) { self.downloads = downloads; super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "我的缓存"
        managementItem = UIBarButtonItem(title: "管理", style: .plain, target: self, action: #selector(toggleEditing))
        if navigationController?.viewControllers.first === self {
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .plain, target: self, action: #selector(close))
            navigationItem.leftBarButtonItem = managementItem
        } else {
            // Preserve the back button when opened from the batch picker.
            navigationItem.rightBarButtonItem = managementItem
        }
        for item in [navigationItem.leftBarButtonItem, navigationItem.rightBarButtonItem].compactMap({ $0 }) {
            item.tintColor = theme.accent
            if #available(iOS 26.0, *) { item.hidesSharedBackground = true }
        }
        tableView.sectionHeaderTopPadding = 0
        tableView.allowsMultipleSelectionDuringEditing = true
        tableView.register(OfflineTaskCell.self, forCellReuseIdentifier: "download")
        summary.numberOfLines = 0; summary.font = .preferredFont(forTextStyle: .footnote); summary.textColor = .secondaryLabel
        summary.adjustsFontForContentSizeCategory = true
        policySummary.font = .preferredFont(forTextStyle: .footnote); policySummary.textColor = .secondaryLabel
        policySummary.numberOfLines = 0; policySummary.adjustsFontForContentSizeCategory = true
        disclosure.text = "设置 ›"; disclosure.textColor = theme.accent
        disclosure.font = .preferredFont(forTextStyle: .footnote); disclosure.adjustsFontForContentSizeCategory = true
        disclosure.setContentCompressionResistancePriority(.required, for: .horizontal)
        disclosure.setContentHuggingPriority(.required, for: .horizontal)
        let policyRow = UIStackView(arrangedSubviews: [policySummary, disclosure]); policyRow.spacing = 12; policyRow.alignment = .center
        policyRow.isUserInteractionEnabled = false; policyRow.translatesAutoresizingMaskIntoConstraints = false
        policy.addSubview(policyRow)
        NSLayoutConstraint.activate([policyRow.leadingAnchor.constraint(equalTo: policy.leadingAnchor), policyRow.trailingAnchor.constraint(equalTo: policy.trailingAnchor), policyRow.topAnchor.constraint(equalTo: policy.topAnchor, constant: 8), policyRow.bottomAnchor.constraint(equalTo: policy.bottomAnchor, constant: -8), policy.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)])
        policy.accessibilityIdentifier = "offline.open-settings"
        policy.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        filter.selectedSegmentIndex = downloads.videos.isEmpty || downloads.videos.contains { $0.state != .completed } ? 0 : 1; filter.addTarget(self, action: #selector(changeFilter), for: .valueChanged)
        filter.accessibilityIdentifier = "offline.filter"
        all.addTarget(self, action: #selector(toggleAll), for: .touchUpInside)
        all.contentHorizontalAlignment = .trailing; all.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        all.accessibilityIdentifier = "offline.all"
        queueSummary.numberOfLines = 0; queueSummary.font = .preferredFont(forTextStyle: .footnote)
        queueSummary.textColor = .secondaryLabel; queueSummary.adjustsFontForContentSizeCategory = true
        queueRow.addArrangedSubview(queueSummary); queueRow.addArrangedSubview(all); queueRow.spacing = 12; queueRow.alignment = .center
        all.setContentCompressionResistancePriority(.required, for: .horizontal)
        all.setContentHuggingPriority(.required, for: .horizontal)
        header.axis = .vertical; header.spacing = 8; header.isLayoutMarginsRelativeArrangement = true
        header.layoutMargins = UIEdgeInsets(top: 12, left: 20, bottom: 4, right: 20)
        [summary, filter, policy, queueRow].forEach(header.addArrangedSubview)
        header.setCustomSpacing(16, after: summary)
        tableView.tableHeaderView = header
        tableView.tableFooterView = UIView(frame: .zero)
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: OfflineDownloads.changed, object: downloads)
        downloads.restore(); refresh()
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationStyle = navigationController?.overrideUserInterfaceStyle
        navigationTint = navigationController?.navigationBar.tintColor
        applyTheme(); refresh()
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // A cache picker can share this navigation stack. Restore its own
        // player appearance when returning, including cancelled transitions.
        if let navigationStyle { navigationController?.overrideUserInterfaceStyle = navigationStyle }
        if let navigationTint { navigationController?.navigationBar.tintColor = navigationTint }
    }
    private func applyTheme() {
        theme = NativeTheme.current
        overrideUserInterfaceStyle = theme.style
        navigationController?.overrideUserInterfaceStyle = theme.style
        view.backgroundColor = theme.page; view.tintColor = theme.accent
        tableView.separatorColor = theme.line
        navigationController?.navigationBar.tintColor = theme.accent
        let appearance = theme.navigationAppearance
        navigationItem.standardAppearance = appearance; navigationItem.scrollEdgeAppearance = appearance
        navigationItem.compactAppearance = appearance; navigationItem.compactScrollEdgeAppearance = appearance
        for item in [navigationItem.leftBarButtonItem, navigationItem.rightBarButtonItem].compactMap({ $0 }) { item.tintColor = theme.accent }
        summary.textColor = theme.muted; policySummary.textColor = theme.muted; queueSummary.textColor = theme.muted; disclosure.textColor = theme.accent
        filter.backgroundColor = theme.chip; filter.selectedSegmentTintColor = theme.hover
        filter.setTitleTextAttributes([.foregroundColor: theme.muted], for: .normal)
        filter.setTitleTextAttributes([.foregroundColor: theme.content], for: .selected)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = tableView.bounds.width
        let height = header.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
        if header.frame.width != width || abs(header.frame.height - height) > 1 { header.frame = CGRect(x: 0, y: 0, width: width, height: height); tableView.tableHeaderView = header }
    }
    @objc private func refresh() {
        if theme.dark != NativeTheme.current.dark { applyTheme() }
        let videos = downloads.videos
        let size = sizeText(videos.filter { $0.state == .completed }.reduce(0) { $0 + $1.bytes })
        let free = downloads.availableBytes.map { " · 手机可用 " + sizeText($0) } ?? ""
        let running = videos.filter { [.preparing, .downloading].contains($0.state) }.count
        let queued = videos.filter { [.queued, .waitingForNetwork].contains($0.state) }.count
        let failed = videos.filter { $0.state == .failed }.count
        summary.text = downloads.storageError ?? "已缓存 \(size)\(free)"
        queueSummary.text = "\(running) 个缓存中 · \(queued) 个等待\(failed > 0 ? " · \(failed) 个失败" : "")"
        filter.setTitle("缓存中 \(videos.filter { $0.state != .completed }.count)", forSegmentAt: 0)
        filter.setTitle("已缓存 \(videos.filter { $0.state == .completed }.count)", forSegmentAt: 1)
        policySummary.text = "同时缓存 \(downloads.concurrency) 个 · \(downloads.allowsCellular ? "允许蜂窝网络" : "仅 Wi-Fi")"
        policy.accessibilityLabel = "缓存设置，" + (policySummary.text ?? "")
        all.setTitle(videos.contains(where: \.isScheduled) ? "全部暂停" : "全部继续", for: .normal)
        queueRow.isHidden = filter.selectedSegmentIndex == 1 || isEditing || !videos.contains { $0.state != .completed }
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
            let empty = UILabel(); empty.numberOfLines = 0; empty.textAlignment = .center; empty.textColor = theme.muted
            empty.text = filter.selectedSegmentIndex == 1 ? "还没有已完成的缓存" : "暂无缓存任务\n在播放器中点击缓存，可批量选择剧集"
            tableView.backgroundView = empty
        } else { tableView.backgroundView = nil }
        view.setNeedsLayout(); updateToolbar()
    }
    private func sizeText(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter(); formatter.countStyle = .file; formatter.allowsNonnumericFormatting = false
        return bytes == 0 ? "0 KB" : formatter.string(fromByteCount: bytes)
    }
    @objc private func changeFilter() { selectedIDs.removeAll(); refresh() }
    @objc private func close() { dismiss(animated: true) }
    @objc private func toggleAll() { downloads.videos.contains(where: \.isScheduled) ? downloads.pauseAll() : downloads.resumeAll() }
    @objc private func openSettings() {
        let controller = OfflineCacheSettingsController(downloads: downloads)
        let nav = UINavigationController(rootViewController: controller)
        nav.overrideUserInterfaceStyle = NativeTheme.current.style
        nav.modalPresentationStyle = .pageSheet
        if let sheet = nav.sheetPresentationController {
            sheet.detents = [.medium(), .large()]; sheet.prefersGrabberVisible = true
            sheet.selectedDetentIdentifier = traitCollection.preferredContentSizeCategory.isAccessibilityCategory ? .large : .medium
        }
        present(nav, animated: true)
    }
    private func isStandalone(_ video: OfflineVideo) -> Bool { video.episodeTitle == nil || video.episodeTitle == "电影" }
    private func sectionTitle(_ section: Int) -> String? {
        let group = groups[section]
        return group.videos.count == 1 && isStandalone(group.videos[0]) ? nil : group.title
    }
    override func numberOfSections(in tableView: UITableView) -> Int { groups.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { groups[section].videos.count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { sectionTitle(section) }
    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat { sectionTitle(section) == nil ? .leastNormalMagnitude : UITableView.automaticDimension }
    override func tableView(_ tableView: UITableView, heightForFooterInSection section: Int) -> CGFloat { 12 }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let video = groups[indexPath.section].videos[indexPath.row]
        let cell = tableView.dequeueReusableCell(withIdentifier: "download", for: indexPath) as! OfflineTaskCell
        let standalone = isStandalone(video)
        cell.heading.text = standalone ? (video.groupTitle ?? video.title) : (video.episodeTitle ?? video.title)
        cell.heading.font = .preferredFont(forTextStyle: standalone ? .headline : .body)
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
            status = downloads.library?.playableURL(video.id) == nil ? "本地文件已丢失，请重新缓存" : (standalone ? "电影 · " : "") + sizeText(video.bytes) + " · \(video.watched ? "已看完" : "可离线观看")"
            action = downloads.library?.playableURL(video.id) == nil ? "重新缓存" : "播放"
        }
        cell.backgroundColor = theme.surface; cell.heading.textColor = theme.content
        cell.status.text = status; cell.status.textColor = video.state == .failed ? .systemOrange : theme.muted
        cell.action.tintColor = theme.accent
        cell.progress.progressTintColor = theme.accent; cell.progress.trackTintColor = theme.chip
        let selection = UIView(); selection.backgroundColor = theme.hover; cell.selectedBackgroundView = selection
        cell.progress.progress = Float(video.progress); cell.progress.isHidden = ![.downloading, .paused].contains(video.state)
        cell.action.setTitle(action, for: .normal); cell.action.isEnabled = video.state != .verifying
        cell.action.isHidden = isEditing
        cell.onAction = { [weak self] in self?.perform(video.id) }
        cell.accessibilityIdentifier = "offline.video.\(video.id)"
        return cell
    }
    override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
        (view as? UITableViewHeaderFooterView)?.textLabel?.textColor = theme.muted
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
        select.tintColor = theme.accent; pause.tintColor = theme.accent
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
        let row = UIStackView(arrangedSubviews: [status, action]); row.spacing = 12; row.alignment = .center
        let stack = UIStackView(arrangedSubviews: [heading, row, progress]); stack.axis = .vertical; stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false; contentView.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor), stack.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor), stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12), stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    @objc private func tap() { onAction?() }
}

private final class OfflineCacheSettingsController: UIViewController {
    private let theme = NativeTheme.current
    private let downloads: OfflineDownloads
    private let concurrentTasks = UISegmentedControl(items: ["1", "2", "3"])
    private let cellularSwitch = UISwitch()
    private var rows: [UIStackView] = []
    init(downloads: OfflineDownloads) { self.downloads = downloads; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "缓存设置"
        overrideUserInterfaceStyle = theme.style; navigationController?.overrideUserInterfaceStyle = theme.style
        view.backgroundColor = theme.page; view.tintColor = theme.accent
        navigationController?.navigationBar.tintColor = theme.accent
        let appearance = theme.navigationAppearance
        navigationItem.standardAppearance = appearance; navigationItem.scrollEdgeAppearance = appearance
        navigationItem.compactAppearance = appearance; navigationItem.compactScrollEdgeAppearance = appearance
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .plain, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem?.tintColor = theme.accent
        if #available(iOS 26.0, *) { navigationItem.rightBarButtonItem?.hidesSharedBackground = true }
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll)
        concurrentTasks.backgroundColor = theme.chip; concurrentTasks.selectedSegmentTintColor = theme.hover
        concurrentTasks.setTitleTextAttributes([.foregroundColor: theme.muted], for: .normal)
        concurrentTasks.setTitleTextAttributes([.foregroundColor: theme.content], for: .selected)
        cellularSwitch.onTintColor = theme.accent
        concurrentTasks.accessibilityIdentifier = "offline.concurrency"; concurrentTasks.accessibilityLabel = "同时缓存任务数"
        concurrentTasks.widthAnchor.constraint(equalToConstant: 144).isActive = true
        concurrentTasks.heightAnchor.constraint(equalToConstant: 44).isActive = true
        concurrentTasks.addTarget(self, action: #selector(changeConcurrency), for: .valueChanged)
        cellularSwitch.accessibilityIdentifier = "offline.cellular"; cellularSwitch.accessibilityLabel = "允许蜂窝网络"
        cellularSwitch.addTarget(self, action: #selector(changeNetworkPolicy), for: .valueChanged)
        rows = [settingRow(title: "同时缓存", detail: "最多同时下载的任务数", control: concurrentTasks), settingRow(title: "允许蜂窝网络", detail: "关闭后仅使用 Wi-Fi", control: cellularSwitch)]
        let divider = UIView(); divider.backgroundColor = theme.line; divider.heightAnchor.constraint(equalToConstant: 0.5).isActive = true
        let card = UIStackView(arrangedSubviews: [rows[0], divider, rows[1]])
        card.axis = .vertical; card.spacing = 16; card.isLayoutMarginsRelativeArrangement = true
        card.layoutMargins = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        card.backgroundColor = theme.surface; card.layer.cornerRadius = 14
        card.accessibilityIdentifier = "offline.settings"
        let note = UILabel(); note.numberOfLines = 0; note.font = .preferredFont(forTextStyle: .footnote)
        note.textColor = theme.muted; note.adjustsFontForContentSizeCategory = true
        note.text = "使用蜂窝网络可能产生流量费用。\n手动暂停的任务不会自动开始。\n强制退出 App 会中断缓存任务。"
        let content = UIStackView(arrangedSubviews: [card, note]); content.axis = .vertical; content.spacing = 16
        content.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(content)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20), content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20), content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: OfflineDownloads.changed, object: downloads)
        refresh()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let large = traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        for row in rows { row.axis = large ? .vertical : .horizontal; row.alignment = large ? .leading : .center }
    }
    private func settingRow(title: String, detail: String, control: UIView) -> UIStackView {
        let label = UILabel(), note = UILabel()
        label.text = title; label.textColor = theme.content; label.font = .preferredFont(forTextStyle: .subheadline)
        note.text = detail; note.font = .preferredFont(forTextStyle: .caption1); note.textColor = theme.muted
        for item in [label, note] { item.numberOfLines = 0; item.adjustsFontForContentSizeCategory = true }
        let text = UIStackView(arrangedSubviews: [label, note]); text.axis = .vertical; text.spacing = 4
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        control.setContentCompressionResistancePriority(.required, for: .horizontal)
        let row = UIStackView(arrangedSubviews: [text, control]); row.spacing = 12; row.alignment = .center
        row.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        text.widthAnchor.constraint(lessThanOrEqualTo: row.widthAnchor).isActive = true
        return row
    }
    @objc private func refresh() {
        concurrentTasks.selectedSegmentIndex = downloads.concurrency - 1
        concurrentTasks.accessibilityValue = "\(downloads.concurrency) 个任务"
        cellularSwitch.setOn(downloads.allowsCellular, animated: false)
    }
    @objc private func changeConcurrency() { downloads.setConcurrency(concurrentTasks.selectedSegmentIndex + 1) }
    @objc private func changeNetworkPolicy() { downloads.setAllowsCellular(cellularSwitch.isOn) }
    @objc private func close() { dismiss(animated: true) }
    deinit { NotificationCenter.default.removeObserver(self) }
}
