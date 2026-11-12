import UIKit
import AVFoundation
import WebKit

/// Compiled only into the isolated simulator app by --cache-only.
@MainActor func runPlayerIntegration(window: UIWindow, scene: UIWindowScene) {
    Task { @MainActor in
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let savedTheme = UserDefaults.standard.object(forKey: "native.theme.dark")
        defer { if let savedTheme { UserDefaults.standard.set(savedTheme, forKey: "native.theme.dark") } else { UserDefaults.standard.removeObject(forKey: "native.theme.dark") } }
        var results: [String: Any] = [:], failures: [String] = [], details: [String] = []
        func report(_ name: String) throws {
            var value = results; value["failures"] = failures; value["failureDetails"] = details; value["aborted"] = false
            try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent(name), options: .atomic)
        }
        func check(_ name: String, _ passed: Bool) {
            results[name] = passed
            if !passed { failures.append(name); details.append(name) }
            print("PLAYER_CHECK \(name): \(passed)"); fflush(stdout)
            try? report("player-progress.json")
        }
        func matches(_ color: UIColor?, _ expected: UIColor, traits: UITraitCollection) -> Bool {
            guard let color else { return false }
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            var er: CGFloat = 0, eg: CGFloat = 0, eb: CGFloat = 0, ea: CGFloat = 0
            color.resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a)
            expected.resolvedColor(with: traits).getRed(&er, green: &eg, blue: &eb, alpha: &ea)
            return zip([r, g, b, a], [er, eg, eb, ea]).allSatisfy { abs($0 - $1) < 0.01 }
        }
        func wait(_ seconds: Double = 0.2) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        func until(_ seconds: Double = 15, _ condition: () -> Bool) async -> Bool {
            for _ in 0..<Int(seconds * 10) { if condition() { return true }; await wait(0.1) }; return false
        }
        @MainActor func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
        @MainActor func snapshot(_ name: String) throws {
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            try image.pngData()?.write(to: output.appendingPathComponent(name + ".png"))
        }
        do {
            let host = try testRequire(window.rootViewController, "Host")
            let origin = URL(string: "http://127.0.0.1:18085")!
            let downloads = OfflineDownloads.shared
            _ = await until { host.viewIfLoaded?.window != nil }
            for item in downloads.videos { try downloads.delete(item.id) }
            downloads.setAllowsCellular(false); downloads.setConcurrency(2)
            var ids: [String] = []
            for index in 0..<3 {
                ids.append(try downloads.enqueue(url: origin.appendingPathComponent("offline-slow-\(index).mp4"), title: index == 0 ? "1987：黎明到来的那一天" : "多影片测试 \(index + 1)", origin: origin, cookies: [], episodeTitle: index == 0 ? "电影" : nil))
            }
            let started = await until { downloads.videos.filter { $0.state == .downloading }.count == 2 }
            check("two-movies-transfer-with-third-queued", started && downloads.library?.video(ids[2])?.state == .queued)
            _ = await until { (downloads.library?.video(ids[0])?.progress ?? 0) > 0 }
            let wifiToken = downloads.library?.video(ids[0])?.token
            let wifiProgress = downloads.library?.video(ids[0])?.progress ?? 0
            downloads.setAllowsCellular(true)
            check("allow-cellular-keeps-active-wifi-transfer", downloads.library?.video(ids[0])?.token == wifiToken && downloads.library?.video(ids[0])?.state == .downloading && (downloads.library?.video(ids[0])?.progress ?? 0) >= wifiProgress)
            downloads.setAllowsCellular(true)
            check("same-network-setting-does-not-restart", downloads.library?.video(ids[0])?.token == wifiToken)
            let continued = await until { (downloads.library?.video(ids[0])?.progress ?? 0) > wifiProgress || downloads.library?.video(ids[0])?.state == .completed }
            check("allow-cellular-progresses-without-manual-resume", continued)
            downloads.setConcurrency(1)
            check("lower-limit-suspends-excess-transfers", downloads.videos.filter { [.preparing, .downloading].contains($0.state) }.count == 1)
            downloads.prioritize(ids[2]); downloads.pause(ids[0])
            let priorityStarted = await until { downloads.library?.video(ids[2])?.state == .downloading }
            check("priority-starts-next-without-resuming-user-pause", priorityStarted && downloads.library?.video(ids[0])?.state == .paused)
            downloads.pauseAll()
            check("pause-all-retains-three-records", downloads.videos.count == 3 && downloads.videos.allSatisfy { $0.state == .paused })
            let restored = try OfflineLibrary()
            check("paused-records-survive-manifest-reload", restored.videos.count == 3 && restored.videos.allSatisfy { $0.state == .paused })
            let manager = OfflineDownloadsController(); let nav = UINavigationController(rootViewController: manager)
            host.present(nav, animated: false); _ = await until { manager.viewIfLoaded?.window != nil }
            await wait()
            let settingsButton = try testRequire(descendants(manager.view).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "offline.open-settings" }, "Settings entry")
            let mainFilter = try testRequire(descendants(manager.view).compactMap { $0 as? UISegmentedControl }.first { $0.accessibilityIdentifier == "offline.filter" }, "Main tabs")
            check("main-page-keeps-settings-secondary", descendants(manager.view).compactMap { $0 as? UISegmentedControl }.count == 1 && descendants(manager.view).compactMap { $0 as? UISwitch }.isEmpty && settingsButton.convert(settingsButton.bounds, to: manager.view).minY >= mainFilter.convert(mainFilter.bounds, to: manager.view).maxY && settingsButton.bounds.height >= 44)
            try snapshot("cache-paused-portrait")
            check("manager-shows-task-actions", descendants(manager.view).compactMap { $0 as? UIButton }.filter { $0.title(for: .normal) == "继续" }.count == 3)
            settingsButton.sendActions(for: .touchUpInside)
            _ = await until { manager.presentedViewController is UINavigationController }; await wait(0.6)
            let settingsNav = try testRequire(manager.presentedViewController as? UINavigationController, "Settings sheet")
            let settingsPage = try testRequire(settingsNav.topViewController, "Settings page")
            let concurrencyControl = try testRequire(descendants(settingsPage.view).compactMap { $0 as? UISegmentedControl }.first { $0.accessibilityIdentifier == "offline.concurrency" }, "Concurrency control")
            let networkControl = try testRequire(descendants(settingsPage.view).compactMap { $0 as? UISwitch }.first { $0.accessibilityIdentifier == "offline.cellular" }, "Cellular switch")
            check("settings-show-independent-network-and-concurrency", concurrencyControl.numberOfSegments == 3 && concurrencyControl.selectedSegmentIndex == downloads.concurrency - 1 && networkControl.isOn == downloads.allowsCellular)
            let pausedTokens = downloads.videos.map(\.token)
            networkControl.setOn(false, animated: false); networkControl.sendActions(for: .valueChanged)
            networkControl.setOn(true, animated: false); networkControl.sendActions(for: .valueChanged)
            check("network-switch-preserves-user-paused-tasks", downloads.videos.allSatisfy { $0.state == .paused } && downloads.videos.map(\.token) == pausedTokens)
            concurrencyControl.selectedSegmentIndex = 2; concurrencyControl.sendActions(for: .valueChanged)
            check("concurrency-segments-apply-without-resuming-paused", downloads.concurrency == 3 && downloads.videos.allSatisfy { $0.state == .paused })
            check("settings-summary-updates-immediately", settingsButton.accessibilityLabel?.contains("同时缓存 3 个 · 允许蜂窝网络") == true)
            settingsPage.view.layoutIfNeeded(); await wait()
            let networkFrame = networkControl.convert(networkControl.bounds, to: settingsPage.view)
            check("settings-sheet-controls-visible", settingsPage.view.bounds.contains(networkFrame) && settingsPage.view.hitTest(CGPoint(x: networkFrame.midX, y: networkFrame.midY), with: nil)?.isDescendant(of: networkControl) == true)
            try snapshot("cache-settings-sheet-portrait")
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            _ = await until { scene.interfaceOrientation == .landscapeRight }; await wait(0.8)
            check("landscape-settings-remain-accessible", settingsPage.view.bounds.contains(networkControl.convert(networkControl.bounds, to: settingsPage.view)))
            try snapshot("cache-settings-sheet-landscape")
            let done = try testRequire(settingsPage.navigationItem.rightBarButtonItem, "Settings done")
            let doneAction = try testRequire(done.action, "Settings done action")
            UIApplication.shared.sendAction(doneAction, to: done.target, from: done, for: nil)
            _ = await until { manager.presentedViewController == nil }; await wait(0.5)
            check("settings-close-preserves-library", host.presentedViewController === nav && mainFilter.selectedSegmentIndex == 0 && downloads.videos.count == 3)
            check("landscape-list-has-visible-first-card", manager.tableView.visibleCells.first.map { manager.view.bounds.contains($0.convert($0.bounds, to: manager.view)) } == true)
            if let first = manager.tableView.visibleCells.first {
                let cardFrame = first.convert(first.bounds, to: manager.view), tabsFrame = mainFilter.convert(mainFilter.bounds, to: manager.view)
                check("landscape-tabs-align-with-movie-cards", abs(cardFrame.minX - tabsFrame.minX) < 1 && abs(cardFrame.maxX - tabsFrame.maxX) < 1)
            } else { check("landscape-tabs-align-with-movie-cards", false) }
            try snapshot("cache-paused-landscape")
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)); _ = await until { scene.interfaceOrientation == .portrait }; await wait(0.5)
            nav.setOverrideTraitCollection(UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge), forChild: manager)
            manager.view.setNeedsLayout(); manager.view.layoutIfNeeded(); await wait(0.5)
            check("large-text-summary-stays-within-header", manager.tableView.tableHeaderView.map { $0.bounds.contains(settingsButton.convert(settingsButton.bounds, to: $0)) } == true)
            try snapshot("cache-main-large-text")
            settingsButton.sendActions(for: .touchUpInside)
            _ = await until { manager.presentedViewController is UINavigationController }; await wait(0.6)
            let largeNav = try testRequire(manager.presentedViewController as? UINavigationController, "Large settings sheet")
            let largePage = try testRequire(largeNav.topViewController, "Large settings page")
            largeNav.setOverrideTraitCollection(UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge), forChild: largePage)
            largePage.view.setNeedsLayout(); largePage.view.layoutIfNeeded(); await wait(0.5)
            let settingsCard = try testRequire(descendants(largePage.view).first { $0.accessibilityIdentifier == "offline.settings" }, "Settings card")
            let largeControls = descendants(settingsCard).filter { $0 is UISwitch || $0 is UISegmentedControl }
            check("large-text-settings-keep-controls-within-card", largeControls.count == 2 && largeControls.allSatisfy { settingsCard.bounds.contains($0.convert($0.bounds, to: settingsCard)) })
            try snapshot("cache-settings-large-text")
            largeNav.dismiss(animated: false); await wait()
            nav.setOverrideTraitCollection(nil, forChild: manager)
            nav.dismiss(animated: false); await wait()
            // Drive the actual picker, including notification-driven refresh during enqueue.
            let session = PlaybackSession(id: "cache-picker", title: "玫瑰战争 · 粤语", sourceKey: "fixture", vodId: "season-one", sourceUrl: nil, profileId: nil, index: 0, episodes: (1...6).map { Episode(url: origin.appendingPathComponent("offline-batch-\($0).mp4").absoluteString, title: "第 \($0) 集", position: 0) }, rate: 1, autoplayNext: false, baseRevision: 0, openedAt: 1)
            let picker = OfflineEpisodePickerController(session: session, origin: origin)
            var addedCount = 0; picker.onAdded = { addedCount = $0 }
            let pickerNav = UINavigationController(rootViewController: picker); host.present(pickerNav, animated: false)
            _ = await until { picker.viewIfLoaded?.window != nil }
            let select = try testRequire(descendants(picker.view).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "offline.select-all" }, "Select all")
            let pickerCollection = try testRequire(descendants(picker.view).compactMap { $0 as? UICollectionView }.first, "Picker grid")
            let start = try testRequire(descendants(picker.view).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "offline.add-selected" }, "Start cache")
            check("cache-start-disabled-with-no-selection", !start.isEnabled)
            picker.collectionView(pickerCollection, didSelectItemAt: IndexPath(item: 1, section: 0))
            check("cache-checkbox-selects-one", start.isEnabled && start.title(for: .normal)?.contains("1 集") == true)
            picker.collectionView(pickerCollection, didSelectItemAt: IndexPath(item: 1, section: 0))
            check("cache-checkbox-deselects", !start.isEnabled)
            select.sendActions(for: .touchUpInside)
            check("cache-select-all-count", start.title(for: .normal)?.contains("6 集") == true)
            select.sendActions(for: .touchUpInside)
            check("cache-select-all-toggles-off", !start.isEnabled)
            select.sendActions(for: .touchUpInside)
            await wait(); try snapshot("cache-picker-portrait")
            // Wait for the preceding sheet/portrait transition before requesting
            // another scene orientation; UIKit can otherwise ignore the request.
            await wait(0.8)
            host.setNeedsUpdateOfSupportedInterfaceOrientations()
            picker.setNeedsUpdateOfSupportedInterfaceOrientations()
            pickerNav.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { error in
                results["picker-rotation-error"] = error.localizedDescription
            }
            let pickerRotated = await until { scene.interfaceOrientation == .landscapeRight && window.bounds.width > window.bounds.height }
            check("picker-rotates-to-landscape", pickerRotated)
            await wait(0.5)
            check("landscape-cache-grid-has-room-for-complete-row", pickerCollection.bounds.height >= 90)
            check("cache-navigation-matches-dark-panel", pickerNav.overrideUserInterfaceStyle == .dark)
            let startFrame = start.convert(start.bounds, to: picker.view)
            check("landscape-cache-action-visible-and-tappable", !start.isHidden && start.alpha > 0 && picker.view.safeAreaLayoutGuide.layoutFrame.contains(startFrame) && startFrame.height >= 44 && picker.view.hitTest(CGPoint(x: startFrame.midX, y: startFrame.midY), with: nil)?.isDescendant(of: start) == true)
            try snapshot("cache-picker-landscape")
            let pickerTheme = UserDefaults.standard.object(forKey: "native.theme.dark")
            UserDefaults.standard.set(false, forKey: "native.theme.dark")
            let downloadsItem = try testRequire(picker.navigationItem.rightBarButtonItem, "Picker downloads entry")
            let downloadsAction = try testRequire(downloadsItem.action, "Picker downloads action")
            UIApplication.shared.sendAction(downloadsAction, to: downloadsItem.target, from: downloadsItem, for: nil)
            _ = await until { pickerNav.topViewController is OfflineDownloadsController }; await wait(0.5)
            check("picker-cache-list-follows-app-light-theme", pickerNav.topViewController?.overrideUserInterfaceStyle == .light && pickerNav.overrideUserInterfaceStyle == .light)
            pickerNav.popViewController(animated: false); await wait()
            check("return-to-picker-restores-player-dark-theme", pickerNav.topViewController === picker && pickerNav.overrideUserInterfaceStyle == .dark)
            if let pickerTheme { UserDefaults.standard.set(pickerTheme, forKey: "native.theme.dark") } else { UserDefaults.standard.removeObject(forKey: "native.theme.dark") }
            let add = try testRequire(descendants(picker.view).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "offline.add-selected" }, "Batch add")
            add.sendActions(for: .touchUpInside)
            _ = await until { host.presentedViewController == nil }; downloads.pauseAll()
            check("batch-picker-adds-six-and-delivers-toast-count", addedCount == 6 && downloads.videos.count == 9)
            let group = OfflineIdentity.group(origin: origin, source: session.sourceKey, video: session.vodId)
            let existing = try testRequire(downloads.videos.first { $0.identity == OfflineIdentity.episode(group: group, index: 0) }, "Batch identity")
            let repeated = try downloads.enqueue(url: URL(string: session.episodes[0].url + "?rotated")!, title: "第一集", origin: origin, cookies: [], identity: existing.identity, groupID: group)
            check("rotated-url-deduplicates-episode", repeated == existing.id && downloads.videos.count == 9)
            for item in downloads.videos where !ids.contains(item.id) { try downloads.delete(item.id) }
            downloads.setConcurrency(2); downloads.resumeAll()
            let downloadsDone = await until(75) { ids.allSatisfy { downloads.library?.video($0)?.state == .completed } }
            results["mp4-states"] = downloads.videos.map { $0.state.rawValue + ":" + ($0.detail ?? "") }
            check("paused-movies-resume-and-complete", downloadsDone)
            // Only necessary policy changes retire a task, and automatically resume
            // after the real background-session cancellation callback.
            downloads.setAllowsCellular(false)
            let migrating = try downloads.enqueue(url: origin.appendingPathComponent("offline-slow-migration.mp4"), title: "网络切换测试", origin: origin, cookies: [])
            _ = await until { downloads.library?.video(migrating)?.state == .downloading }
            let oldMigrationToken = downloads.library?.video(migrating)?.token
            downloads.setAllowsCellular(true)
            downloads.networkChanged(connected: true, wifi: false)
            let migrationFinished = await until(30) { downloads.library?.video(migrating)?.state == .completed }
            check("wifi-loss-migrates-to-permitted-cellular-automatically", migrationFinished && downloads.library?.video(migrating)?.cellular == true && downloads.library?.video(migrating)?.token != oldMigrationToken)
            downloads.setAllowsCellular(false)
            let waiting = try downloads.enqueue(url: origin.appendingPathComponent("offline-network-wait.mp4"), title: "等待网络测试", origin: origin, cookies: [])
            check("wifi-only-task-waits-on-cellular-path", downloads.library?.video(waiting)?.state == .waitingForNetwork)
            downloads.setAllowsCellular(true)
            let waitingFinished = await until(20) { downloads.library?.video(waiting)?.state == .completed }
            check("enabling-cellular-resumes-network-wait-without-tap", waitingFinished)
            downloads.networkChanged(connected: true, wifi: true)
            let migratingHLS = try downloads.enqueue(url: origin.appendingPathComponent("offline-slow-hls/index.m3u8"), title: "HLS 策略切换测试", origin: origin, cookies: [])
            _ = await until { downloads.library?.video(migratingHLS)?.state == .downloading }
            let oldHLS = downloads.library?.video(migratingHLS)?.token
            downloads.setAllowsCellular(false)
            let transfers = Mirror(reflecting: downloads).children.first { $0.label == "tasks" }?.value as? [String: URLSessionTask]
            let retiring = Mirror(reflecting: downloads).children.first { $0.label == "retiringTasks" }?.value as? [String: String]
            check("hls-policy-change-waits-for-retiring-task", transfers?[migratingHLS] == nil && oldHLS.flatMap { retiring?[$0] } == migratingHLS)
            downloads.setAllowsCellular(true); downloads.setAllowsCellular(false)
            let hlsMigrated = await until(60) { downloads.library?.video(migratingHLS)?.state == .completed }
            check("rapid-policy-toggles-resume-hls-with-latest-setting", hlsMigrated && downloads.library?.video(migratingHLS)?.cellular == false && downloads.storageError == nil)
            for id in [migrating, waiting, migratingHLS] { try downloads.delete(id) }
            // Retry stays in one row and rejects a late callback from the previous attempt.
            let bad = try downloads.enqueue(url: origin.appendingPathComponent("fail.mp4"), title: "失败测试", origin: origin, cookies: [])
            _ = await until { downloads.library?.video(bad)?.state == .failed }
            let oldToken = downloads.library?.video(bad)?.token
            let retryID = try downloads.enqueue(url: origin.appendingPathComponent("fail.mp4"), title: "失败测试", origin: origin, cookies: [])
            let stale = URLSession.shared.downloadTask(with: origin.appendingPathComponent("fail.mp4")); stale.taskDescription = oldToken
            downloads.urlSession(URLSession.shared, task: stale, didCompleteWithError: URLError(.cancelled))
            check("retry-reuses-row-and-rejects-old-callback", retryID == bad && downloads.library?.video(bad)?.token != oldToken && downloads.library?.video(bad)?.state != .failed)
            try downloads.delete(bad)
            downloads.urlSession(URLSession.shared, task: stale, didCompleteWithError: nil)
            check("deleted-task-cannot-be-resurrected", downloads.library?.video(bad) == nil)
            let hls = try downloads.enqueue(url: origin.appendingPathComponent("offline-hls/index.m3u8"), title: "HLS 合成短片", origin: origin, cookies: [])
            _ = await until(75) { [.completed, .failed].contains(downloads.library?.video(hls)?.state) }
            results["hls-detail"] = downloads.library?.video(hls)?.detail ?? ""
            check("hls-saves-system-package-and-validates", downloads.library?.playableURL(hls) != nil)
            _ = try await URLSession.shared.data(from: origin.appendingPathComponent("offline-test-block"))
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)); _ = await until { scene.interfaceOrientation == .portrait }
            let complete = OfflineDownloadsController(); let completeNav = UINavigationController(rootViewController: complete)
            host.present(completeNav, animated: false); _ = await until { complete.viewIfLoaded?.window != nil }
            let filter = try testRequire(descendants(complete.view).compactMap { $0 as? UISegmentedControl }.first { $0.accessibilityIdentifier == "offline.filter" }, "Completed tab")
            filter.selectedSegmentIndex = 1; filter.sendActions(for: .valueChanged); await wait()
            let movieLabels = complete.tableView.visibleCells.flatMap { descendants($0).compactMap { $0 as? UILabel }.compactMap(\.text) }
            check("movie-title-is-inside-card", movieLabels.contains("1987：黎明到来的那一天") && !movieLabels.contains("电影"))
            check("completed-page-hides-queue-and-long-footer", !descendants(complete.view).contains { ($0 as? UILabel)?.text?.contains("强制退出") == true } && complete.tableView.tableHeaderView!.bounds.height < 180)
            try snapshot("cache-completed-portrait")
            completeNav.dismiss(animated: false); await wait()
            // App theme must win even when the presenting controller uses the opposite scheme.
            for dark in [false, true] {
                UserDefaults.standard.set(dark, forKey: "native.theme.dark")
                host.overrideUserInterfaceStyle = dark ? .light : .dark
                let themed = OfflineDownloadsController(), themedNav = UINavigationController()
                themedNav.setViewControllers([themed], animated: false); host.present(themedNav, animated: false)
                _ = await until { themed.viewIfLoaded?.window != nil }; await wait(0.3)
                let theme = NativeTheme(dark: dark), suffix = dark ? "dark" : "light", traits = themed.traitCollection
                let firstCell = try testRequire(themed.tableView.visibleCells.first, "Themed movie card")
                let play = try testRequire(descendants(firstCell).compactMap { $0 as? UIButton }.first, "Themed play button")
                check("cache-uses-app-" + suffix + "-palette", themed.overrideUserInterfaceStyle == theme.style && matches(themed.view.backgroundColor, theme.page, traits: traits) && matches(firstCell.backgroundColor, theme.surface, traits: traits) && matches(play.tintColor, theme.accent, traits: traits) && matches(themed.navigationItem.standardAppearance?.backgroundColor, theme.surface, traits: traits))
                try snapshot("cache-completed-" + suffix)
                let settingsEntry = try testRequire(descendants(themed.view).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "offline.open-settings" }, "Themed settings entry")
                settingsEntry.sendActions(for: .touchUpInside); await wait(0.6)
                let sheet = try testRequire(themed.presentedViewController as? UINavigationController, "Themed settings sheet")
                let page = try testRequire(sheet.topViewController, "Themed settings page")
                let toggle = try testRequire(descendants(page.view).compactMap { $0 as? UISwitch }.first, "Themed cellular switch")
                toggle.setOn(true, animated: false); toggle.sendActions(for: .valueChanged)
                let card = try testRequire(descendants(page.view).first { $0.accessibilityIdentifier == "offline.settings" }, "Themed card")
                check("cache-settings-use-app-" + suffix + "-palette", page.overrideUserInterfaceStyle == theme.style && matches(page.view.backgroundColor, theme.page, traits: page.traitCollection) && matches(card.backgroundColor, theme.surface, traits: page.traitCollection) && matches(toggle.onTintColor, theme.accent, traits: page.traitCollection) && matches(page.navigationItem.rightBarButtonItem?.tintColor, theme.accent, traits: page.traitCollection))
                try snapshot("cache-settings-" + suffix)
                sheet.dismiss(animated: false); await wait(); themedNav.dismiss(animated: false); await wait()
            }
            host.overrideUserInterfaceStyle = .unspecified
            host.present(completeNav, animated: false); _ = await until { complete.viewIfLoaded?.window != nil }; await wait()
            for (name, id) in [("mp4", ids[0]), ("hls", hls)] {
                guard downloads.library?.playableURL(id) != nil else { check(name + "-offline-playback", false); continue }
                complete.play(id); _ = await until { complete.presentedViewController is PlayerController }
                let player = try testRequire(complete.presentedViewController as? PlayerController, "Offline player")
                let controls = try testRequire(Mirror(reflecting: player).children.first { $0.label == "controls" }?.value as? HomeTVPlayerControls, "Controls")
                let engine = try testRequire(controls.player?.currentPlayerManager as? ZFAVPlayerManager, "Engine")
                let plays = await until { engine.isPlaying && engine.currentTime > 0.5 }
                check(name + "-offline-playback", plays && engine.assetURL?.isFileURL == true && controls.downloadButton.isHidden)
                player.closePlayer(); _ = await until { complete.presentedViewController == nil }
            }
            completeNav.dismiss(animated: false); await wait()
            let paths = downloads.videos.compactMap { downloads.library?.playableURL($0.id) }
            for item in downloads.videos { try downloads.delete(item.id) }
            await wait()
            check("delete-cleans-records-and-packages", downloads.videos.isEmpty && paths.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) })
            downloads.setAllowsCellular(false)
            check("wifi-only-setting-persists", !downloads.allowsCellular)
            _ = try await URLSession.shared.data(from: origin.appendingPathComponent("offline-test-unblock"))
        } catch { failures.append("harness-prerequisite"); details.append(String(describing: error)) }
        do { try report("player-integration.json") }
        catch { print("PLAYER_REPORT_ERROR: \(error)") }
        print("PLAYER_INTEGRATION_DONE failures=\(failures.count)"); fflush(stdout)
    }
}
