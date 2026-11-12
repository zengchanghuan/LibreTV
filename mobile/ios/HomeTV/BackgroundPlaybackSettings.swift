import UIKit

final class BackgroundPlaybackSettingsController: UITableViewController {
    private let preferences = PlaybackPreferences()
    init() { super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "播放器配置"
        overrideUserInterfaceStyle = NativeTheme.current.style
        navigationController?.overrideUserInterfaceStyle = NativeTheme.current.style
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .plain, target: self, action: #selector(close))
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 2 }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let smallWindow = indexPath.row == 0
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = smallWindow ? "小窗播放" : "后台音频"
        cell.detailTextLabel?.text = smallWindow ? "收起播放器时，自动进入小窗" : "离开 App 后仅继续播放声音"
        cell.textLabel?.font = .preferredFont(forTextStyle: .body)
        cell.detailTextLabel?.font = .preferredFont(forTextStyle: .footnote)
        cell.detailTextLabel?.textColor = .secondaryLabel
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        cell.selectionStyle = .none
        let toggle = UISwitch(); toggle.tag = indexPath.row
        toggle.onTintColor = NativeTheme.current.accent
        toggle.isOn = smallWindow ? preferences.smallWindow : preferences.backgroundAudio
        toggle.accessibilityLabel = cell.textLabel?.text
        toggle.accessibilityIdentifier = smallWindow ? "playback.small-window" : "playback.background-audio"
        toggle.addTarget(self, action: #selector(changed(_:)), for: .valueChanged)
        cell.accessoryView = toggle
        return cell
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { "仅作用于当前设备" }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        "小窗默认开启，后台音频默认关闭，两项独立设置。\n关闭小窗后，收起播放器会结束本次播放并保存进度。\n小窗未能启动时，仅在开启后台音频后继续声音。锁屏、手动暂停及定时停止始终暂停播放。"
    }
    @objc private func changed(_ sender: UISwitch) {
        if sender.tag == 0 { preferences.smallWindow = sender.isOn }
        else { preferences.backgroundAudio = sender.isOn }
    }
    @objc private func close() { dismiss(animated: true) }
}
