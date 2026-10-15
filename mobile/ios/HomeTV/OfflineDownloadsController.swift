import UIKit

final class OfflineDownloadsController: UITableViewController {
    private let downloads: OfflineDownloads
    private var videos: [OfflineVideo] = []
    private let summary = UILabel()
    init(downloads: OfflineDownloads = .shared) {
        self.downloads = downloads; super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "我的下载"
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(close))
        summary.numberOfLines = 0; summary.font = .preferredFont(forTextStyle: .footnote); summary.textColor = .secondaryLabel
        summary.textAlignment = .center
        tableView.tableHeaderView = summary
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: OfflineDownloads.changed, object: downloads)
        downloads.restore(); refresh()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let height = summary.sizeThatFits(CGSize(width: tableView.bounds.width - 40, height: .greatestFiniteMagnitude)).height + 32
        if abs(summary.frame.height - height) > 1 { summary.frame = CGRect(x: 0, y: 0, width: tableView.bounds.width, height: height); tableView.tableHeaderView = summary }
    }
    @objc private func refresh() {
        videos = downloads.videos
        let size = ByteCountFormatter.string(fromByteCount: videos.reduce(0) { $0 + $1.bytes }, countStyle: .file)
        summary.text = downloads.storageError ?? "保存在这台手机 · 已完成文件占用 \(size)\n下载完成后可断网播放，看完可左滑删除释放空间。\n下载可能使用蜂窝流量；强制退出 App 会中断任务。" + (videos.isEmpty ? "\n\n暂无下载，在播放器右上角点击下载按钮。" : "")
        tableView.reloadData(); view.setNeedsLayout()
    }
    @objc private func close() { dismiss(animated: true) }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { videos.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let video = videos[indexPath.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = video.title; cell.textLabel?.numberOfLines = 0
        cell.detailTextLabel?.numberOfLines = 0
        switch video.state {
        case .preparing: cell.detailTextLabel?.text = "正在准备下载…"
        case .downloading: cell.detailTextLabel?.text = "下载中 · \(Int(video.progress * 100))% · 左滑可取消"
        case .completed:
            let state = downloads.library?.playableURL(video.id) != nil ? (video.watched ? "已看完 · 可重看或删除" : "已下载 · 点击离线观看") : "本地文件已丢失，请删除记录后重新下载"
            cell.detailTextLabel?.text = state + "\n" + ByteCountFormatter.string(fromByteCount: video.bytes, countStyle: .file)
        case .failed: cell.detailTextLabel?.text = "下载失败：\(video.error ?? "未知错误")\n请删除记录，再从影片页重新下载。"
        }
        cell.accessibilityIdentifier = "offline.video.\(video.id)"
        cell.accessoryType = video.state == .completed ? .disclosureIndicator : .none
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        play(videos[indexPath.row].id)
    }
    func play(_ id: String) {
        guard let video = downloads.library?.video(id), video.state == .completed else { return }
        guard let file = downloads.library?.playableURL(id), let origin = URL(string: video.origin) else { alert("本地文件已丢失，请删除记录后重新下载"); return }
        let session = PlaybackSession(id: UUID().uuidString, title: video.title, sourceKey: "offline", vodId: video.id, sourceUrl: nil, profileId: nil, index: 0, episodes: [Episode(url: file.absoluteString, title: video.title, position: video.position)], rate: 1, autoplayNext: false, baseRevision: 0, openedAt: Int64(Date().timeIntervalSince1970 * 1000))
        let player = PlayerController(session: session, origin: origin, cookies: [])
        player.onProgress = { [weak self] in self?.downloads.record(id, event: $0) }
        player.modalPresentationStyle = .fullScreen
        present(player, animated: true)
    }
    override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let video = videos[indexPath.row]
        let action = UIContextualAction(style: .destructive, title: video.state == .completed ? "删除文件" : "取消并删除") { [weak self] _, _, completion in
            guard let self else { completion(false); return }
            let prompt = UIAlertController(title: "删除《\(video.title)》？", message: "将删除这台手机上的视频和下载记录，释放占用空间。", preferredStyle: .alert)
            prompt.addAction(UIAlertAction(title: "保留", style: .cancel) { _ in completion(false) })
            prompt.addAction(UIAlertAction(title: "删除", style: .destructive) { _ in
                do { try self.downloads.delete(video.id); completion(true) }
                catch { completion(false); self.alert("删除失败：\(error.localizedDescription)") }
            })
            self.present(prompt, animated: true)
        }
        let config = UISwipeActionsConfiguration(actions: [action]); config.performsFirstActionWithFullSwipe = false; return config
    }
    private func alert(_ message: String) {
        let controller = UIAlertController(title: "我的下载", message: message, preferredStyle: .alert)
        controller.addAction(UIAlertAction(title: "好", style: .default)); present(controller, animated: true)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}
