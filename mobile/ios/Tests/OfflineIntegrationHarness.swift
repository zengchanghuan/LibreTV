import UIKit
import AVFoundation
import WebKit

/// Compiled only into the isolated simulator app by --cache-only.
@MainActor func runPlayerIntegration(window: UIWindow, scene: UIWindowScene) {
    Task { @MainActor in
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
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
                ids.append(try downloads.enqueue(url: origin.appendingPathComponent("offline-slow-\(index).mp4"), title: "多影片测试 \(index + 1)", origin: origin, cookies: []))
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
            let concurrencyControl = try testRequire(descendants(manager.view).compactMap { $0 as? UISegmentedControl }.first { $0.accessibilityIdentifier == "offline.concurrency" }, "Concurrency control")
            let networkControl = try testRequire(descendants(manager.view).compactMap { $0 as? UISwitch }.first { $0.accessibilityIdentifier == "offline.cellular" }, "Cellular switch")
            check("settings-show-independent-network-and-concurrency", concurrencyControl.numberOfSegments == 3 && concurrencyControl.selectedSegmentIndex == downloads.concurrency - 1 && networkControl.isOn == downloads.allowsCellular)
            let pausedTokens = downloads.videos.map(\.token)
            networkControl.setOn(false, animated: false); networkControl.sendActions(for: .valueChanged)
            networkControl.setOn(true, animated: false); networkControl.sendActions(for: .valueChanged)
            check("network-switch-preserves-user-paused-tasks", downloads.videos.allSatisfy { $0.state == .paused } && downloads.videos.map(\.token) == pausedTokens)
            concurrencyControl.selectedSegmentIndex = 2; concurrencyControl.sendActions(for: .valueChanged)
            check("concurrency-segments-apply-without-resuming-paused", downloads.concurrency == 3 && downloads.videos.allSatisfy { $0.state == .paused })
            try snapshot("cache-paused-portrait")
            check("manager-shows-task-actions", descendants(manager.view).compactMap { $0 as? UIButton }.filter { $0.title(for: .normal) == "继续" }.count == 3)
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            _ = await until { scene.interfaceOrientation == .landscapeRight }; await wait(0.8)
            let settingsCard = try testRequire(descendants(manager.view).first { $0.accessibilityIdentifier == "offline.settings" }, "Settings card")
            check("landscape-settings-use-compact-side-by-side-rows", settingsCard.bounds.height < 100 && !networkControl.isHidden && !concurrencyControl.isHidden)
            try snapshot("cache-paused-landscape")
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)); _ = await until { scene.interfaceOrientation == .portrait }; await wait(0.5)
            nav.setOverrideTraitCollection(UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge), forChild: manager)
            manager.view.setNeedsLayout(); manager.view.layoutIfNeeded(); await wait(0.5)
            check("large-text-settings-keep-controls-within-card", settingsCard.bounds.contains(concurrencyControl.convert(concurrencyControl.bounds, to: settingsCard)) && settingsCard.bounds.contains(networkControl.convert(networkControl.bounds, to: settingsCard)))
            try snapshot("cache-settings-large-text")
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
            let done = await until(75) { ids.allSatisfy { downloads.library?.video($0)?.state == .completed } }
            results["mp4-states"] = downloads.videos.map { $0.state.rawValue + ":" + ($0.detail ?? "") }
            check("paused-movies-resume-and-complete", done)
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
            filter.selectedSegmentIndex = 1; filter.sendActions(for: .valueChanged); await wait(); try snapshot("cache-completed-portrait")
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
