import UIKit

enum BackgroundPlaybackMode: String, CaseIterable {
    case pictureInPicture, audio, pause
    static var current: Self {
        get { UserDefaults.standard.string(forKey: "playback.backgroundMode").flatMap(Self.init(rawValue:)) ?? .pictureInPicture }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "playback.backgroundMode"); NotificationCenter.default.post(name: .backgroundPlaybackChanged, object: nil) }
    }
    var title: String {
        switch self {
        case .pictureInPicture: return "小窗优先，锁屏暂停"
        case .audio: return "后台仅播放声音，锁屏暂停"
        case .pause: return "离开 App 后暂停"
        }
    }
}
extension Notification.Name { static let backgroundPlaybackChanged = Notification.Name("HomeTVBackgroundPlaybackChanged") }

final class BackgroundPlaybackSettingsController: UITableViewController {
    init() { super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "后台播放"
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(close))
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { BackgroundPlaybackMode.allCases.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let mode = BackgroundPlaybackMode.allCases[indexPath.row]
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = mode.title; cell.textLabel?.numberOfLines = 0
        cell.accessoryType = mode == .current ? .checkmark : .none
        cell.accessibilityIdentifier = "playback.mode.\(mode.rawValue)"
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        BackgroundPlaybackMode.current = BackgroundPlaybackMode.allCases[indexPath.row]; tableView.reloadData()
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        "默认小窗优先。系统画中画不可用时继续播放声音。\n返回影片页会缩成 App 内小窗；点击关闭才停止播放。\n手动暂停和定时停止始终有效。强制退出 App 会停止播放。"
    }
    @objc private func close() { dismiss(animated: true) }
}
