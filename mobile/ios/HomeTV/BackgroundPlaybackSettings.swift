import UIKit

final class BackgroundPlaybackSettingsController: UITableViewController {
    private let preferences: PlaybackPreferences
    init(preferences: PlaybackPreferences = PlaybackPreferences()) {
        self.preferences = preferences
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "播放器配置"
        tableView.accessibilityIdentifier = "playback.settings"
        overrideUserInterfaceStyle = NativeTheme.current.style
        navigationController?.overrideUserInterfaceStyle = NativeTheme.current.style
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .plain, target: self, action: #selector(close))
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        tableView.reloadData()
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 2 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? 1 : 2
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.section == 0 {
            let cell = UITableViewCell(style: .value1, reuseIdentifier: nil)
            cell.textLabel?.text = "双击跳转时长"
            cell.textLabel?.numberOfLines = 0
            cell.textLabel?.adjustsFontForContentSizeCategory = true
            cell.detailTextLabel?.text = "\(preferences.doubleTapSeekSeconds) 秒"
            cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "playback.double-tap-seek"
            return cell
        }
        let smallWindow = indexPath.row == 0
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = smallWindow ? "小窗播放" : "后台音频"
        cell.textLabel?.font = .preferredFont(forTextStyle: .body)
        cell.textLabel?.adjustsFontForContentSizeCategory = true
        cell.textLabel?.numberOfLines = 0
        cell.selectionStyle = .none
        let toggle = UISwitch(); toggle.tag = indexPath.row
        toggle.onTintColor = NativeTheme.current.accent
        toggle.isOn = smallWindow ? preferences.smallWindow : preferences.backgroundAudio
        toggle.accessibilityLabel = cell.textLabel?.text
        toggle.accessibilityHint = smallWindow ? "收起播放器时进入小窗" : "离开 App 后继续播放声音"
        toggle.accessibilityIdentifier = smallWindow ? "playback.small-window" : "playback.background-audio"
        toggle.addTarget(self, action: #selector(changed(_:)), for: .valueChanged)
        cell.accessoryView = toggle
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        guard indexPath.section == 0 else { return }
        let selector = DoubleTapSeekSettingsController(preferences: preferences)
        navigationController?.pushViewController(selector, animated: true)
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        section == 0 ? "手势" : "播放行为"
    }
    @objc private func changed(_ sender: UISwitch) {
        if sender.tag == 0 { preferences.smallWindow = sender.isOn }
        else { preferences.backgroundAudio = sender.isOn }
    }
    @objc private func close() { dismiss(animated: true) }
}

private final class DoubleTapSeekSettingsController: UITableViewController {
    private let preferences: PlaybackPreferences

    init(preferences: PlaybackPreferences) {
        self.preferences = preferences
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "双击跳转时长"
        tableView.accessibilityIdentifier = "playback.double-tap-seek-options"
        tableView.tintColor = NativeTheme.current.accent
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        PlaybackPreferences.doubleTapSeekOptions.count
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        "左侧双击后退，右侧双击快进，两侧共用此时长。"
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let seconds = PlaybackPreferences.doubleTapSeekOptions[indexPath.row]
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = "\(seconds) 秒"
        cell.textLabel?.adjustsFontForContentSizeCategory = true
        cell.accessibilityIdentifier = "playback.double-tap-seek.\(seconds)"
        if seconds == preferences.doubleTapSeekSeconds {
            cell.accessoryType = .checkmark
            cell.accessibilityTraits.insert(.selected)
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        preferences.doubleTapSeekSeconds = PlaybackPreferences.doubleTapSeekOptions[indexPath.row]
        navigationController?.popViewController(animated: true)
    }
}
