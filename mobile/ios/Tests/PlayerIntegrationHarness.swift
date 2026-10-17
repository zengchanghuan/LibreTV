import UIKit
import AVFoundation
import WebKit

// AVFoundation allows a full/playable buffer while its throughput prediction
// remains pessimistic. Keep real media/clock behaviour and control only that hint.
private final class PessimisticBufferItem: AVPlayerItem {
    override var isPlaybackLikelyToKeepUp: Bool { false }
}

/// Copied into an isolated app by run-player-integration.py, never into HomeTV.
@MainActor func runPlayerIntegration(window: UIWindow, scene: UIWindowScene) {
    Task { @MainActor in
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        var results: [String: Any] = [:]
        var failures: [String] = []
        var failureDetails: [String] = []
        var aborted = false
        let fault = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--harness-failure=") }?.split(separator: "=", maxSplits: 1).last.map(String.init)
        func writeReport(_ name: String) throws {
            let directory = try testRequire(output, "Missing Documents directory for test report")
            var report = results
            report["failures"] = failures
            report["failureDetails"] = failureDetails
            report["aborted"] = aborted
            let failWrite = (fault == "report-write" && name == "player-integration.json")
                || (fault == "progress-write" && name == "player-progress.json")
            let destination = directory.appendingPathComponent(failWrite ? "missing-parent/" + name : name)
            try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
                .write(to: destination, options: .atomic)
        }
        func wait(_ seconds: Double = 0.3) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        func check(_ name: String, _ value: Bool, file: String = #fileID, line: UInt = #line) {
            results[name] = value
            if !value { failures.append(name); failureDetails.append("\(file):\(line): \(name)") }
            print("PLAYER_CHECK \(name): \(value)")
            do { try writeReport("player-progress.json") }
            catch {
                failures.append("progress-report")
                failureDetails.append("\(file):\(line): Could not write progress report: \(error)")
            }
        }
        func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
        func until(_ condition: () -> Bool) async -> Bool {
            for _ in 0..<100 { if condition() { return true }; await wait(0.1) }; return false
        }
        func snapshot(_ name: String) {
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            do {
                let directory = try testRequire(output, "Missing screenshot directory")
                let data = try testRequire(image.pngData(), "Could not encode screenshot: \(name)")
                try data.write(to: directory.appendingPathComponent(name + ".png"), options: .atomic)
            } catch { check("snapshot-" + name, false); failureDetails.append(String(describing: error)) }
        }
        func session(_ path: String = "/video.mp4", autoplay: Bool = true) -> PlaybackSession {
            PlaybackSession(id: UUID().uuidString, title: "HomeTV 播放器验收 · 横竖屏与续播", sourceKey: "fixture", vodId: "player", sourceUrl: nil, profileId: nil, index: 0,
              episodes: [Episode(url: "http://127.0.0.1:18085" + path, title: "第一集", position: 4), Episode(url: "http://127.0.0.1:18085/video.mp4?second", title: "第二集", position: 2)],
              rate: 1.5, autoplayNext: autoplay, baseRevision: 0, openedAt: 1)
        }
        do {
            let origin = try testRequire(URL(string: "http://127.0.0.1:18085"), "Invalid fixture URL")
            // These switches exist only in the isolated test app. Each exercises the
            // same checked lookup used below, without changing production app data.
            let host = try testRequire(fault == "missing-root" ? nil : window.rootViewController, "Missing root view controller")
            if fault == "failed-check" || fault == "progress-write" {
                check("injected-expectation", fault == "progress-write")
                try writeReport("player-integration.json")
                print("PLAYER_INTEGRATION_DONE failures=\(failures.count)")
                fflush(stdout)
                return
            }
            if fault == "report-write" {
                try writeReport("player-integration.json")
            }
            if fault == "missing-reflection" || fault == "wrong-type" {
                let reflected: Any? = fault == "wrong-type" ? "not a control" : Mirror(reflecting: host).children.first { $0.label == "missing" }?.value
                _ = try testRequire(reflected as? HomeTVPlayerControls, "Missing or invalid reflected controls")
            }
            if ProcessInfo.processInfo.arguments.contains("--sleep-minute-only") {
                // Real elapsed time, real menu action, real media. Slow the 20s
                // synthetic clip so it is still playing at the one-minute mark.
                var minuteSession = session(autoplay: false)
                minuteSession.rate = 0.25; minuteSession.episodes[0].position = 0
                let minuteTimer = SleepTimer()
                let minute = PlayerController(session: minuteSession, origin: origin, cookies: [], sleepTimer: minuteTimer)
                var minuteEvents: [[String: Any]] = []
                minute.onProgress = { minuteEvents.append($0) }
                minute.modalPresentationStyle = .fullScreen; host.present(minute, animated: false)
                minute.loadViewIfNeeded()
                let mc = try testRequire(Mirror(reflecting: minute).children.first { $0.label == "controls" }?.value as? HomeTVPlayerControls, "Minute controls")
                let me = try testRequire(mc.player?.currentPlayerManager as? ZFAVPlayerManager, "Minute engine")
                let playing = await until { me.isPlaying }
                try testCheck(playing, "Minute fixture must start playback")
                let action = try testRequire(mc.sleepButton.menu?.children.compactMap { $0 as? UIAction }.first { $0.title == "1 分钟后停止" }, "One-minute menu action")
                let began = Date()
                mc.sleepButton.sendAction(action)
                check("one-minute-menu-sets-deadline", minuteTimer.minutesRemaining == 1)
                await wait(3)
                check("one-minute-does-not-stop-early", me.isPlaying && me.currentTime > 0)
                // No touches, foreground events, synthetic clock or manual tick.
                for _ in 0..<65 {
                    if minuteEvents.contains(where: { $0["reason"] as? String == "sleep" }) { break }
                    await wait(1)
                }
                let elapsed = Date().timeIntervalSince(began)
                let sleepEvents = minuteEvents.filter { $0["reason"] as? String == "sleep" }
                check("one-minute-unattended-stops-on-time", sleepEvents.count == 1 && elapsed >= 59 && elapsed < 65 && !me.isPlaying && me.player == nil)
                check("one-minute-releases-auto-lock", !UIApplication.shared.isIdleTimerDisabled)
                let count = minuteEvents.count
                let saved = sleepEvents.last?["position"] as? Double ?? -1
                me.play(); await wait(6)
                check("one-minute-stays-stopped-without-periodic-work", me.player == nil && minuteEvents.count == count)
                minute.closePlayer(); _ = await until { host.presentedViewController == nil }
                check("one-minute-close-preserves-progress", saved > 10 && abs((minuteEvents.last?["position"] as? Double ?? -1) - saved) < 0.1 && (minuteEvents.last?["duration"] as? Double ?? 0) > 19)
                results["one-minute-elapsed-seconds"] = elapsed
                try writeReport("player-integration.json")
                print("PLAYER_INTEGRATION_DONE failures=\(failures.count)"); fflush(stdout)
                return
            }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
            _ = await until { scene.interfaceOrientation == .portrait && host.view.bounds.height > host.view.bounds.width }
            let browser = try testRequire(host as? BrowserController, "Missing browser host")
            let tabs = try testRequire(descendants(host.view).compactMap { $0 as? UITabBar }.first, "Missing native tabs")
            let web = try testRequire(descendants(host.view).compactMap { $0 as? WKWebView }.first, "Missing browser web view")
            let navigation = try testRequire(descendants(host.view).compactMap { $0 as? UINavigationBar }.first, "Missing browser navigation bar")
            let tabItems = try testRequire(tabs.items, "Missing tab items")
            try testCheck(tabItems.count == 4, "Expected home, live, HD and settings tabs")
            check("four-tabs-have-labels-and-icons", tabItems.map(\.title) == ["首页", "直播", "高清", "设置"] && tabItems.allSatisfy { $0.image != nil })
            _ = await until { !web.isLoading }
            browser.tabBar(tabs, didSelect: tabItems[2])
            let hdLoaded = await until { !web.isLoading && web.url?.path == "/hd" && tabs.selectedItem?.tag == 2 }
            check("hd-tab-navigates-and-highlights", hdLoaded)
            let historyCount = web.backForwardList.backList.count
            browser.tabBar(tabs, didSelect: tabItems[2]); await wait()
            check("repeated-hd-tab-preserves-document", !web.isLoading && web.backForwardList.backList.count == historyCount && web.url?.path == "/hd")
            snapshot("hd-tabs-portrait")
            check("four-tabs-portrait-layout", tabs.bounds.height >= 49 + host.view.safeAreaInsets.bottom && web.frame.maxY <= tabs.frame.minY + 1 && navigation.frame.minY >= host.view.safeAreaInsets.top && navigation.frame.maxY <= web.frame.minY + 1 && navigation.bounds.height >= 44)
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            _ = await until { scene.interfaceOrientation == .landscapeRight }; await wait(0.5)
            snapshot("hd-tabs-landscape")
            check("four-tabs-landscape-layout", tabs.bounds.height >= 49 + host.view.safeAreaInsets.bottom && web.frame.maxY <= tabs.frame.minY + 1 && navigation.frame.minY >= host.view.safeAreaInsets.top && navigation.frame.maxY <= web.frame.minY + 1 && navigation.bounds.height >= 44)
            browser.tabBar(tabs, didSelect: tabItems[3])
            let settingsLoaded = await until { !web.isLoading && web.url?.path == "/settings" && tabs.selectedItem?.tag == 3 }
            check("settings-after-hd-highlights-fourth-tab", settingsLoaded)
            browser.tabBar(tabs, didSelect: tabItems[0])
            _ = await until { !web.isLoading && tabs.selectedItem?.tag == 0 }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
            _ = await until { scene.interfaceOrientation == .portrait }; await wait(0.5)
            // Native navigation follows both full loads and SPA history. Tab roots
            // never expose a back button into another tab's browser history.
            func tapNavigationBack() throws {
                let item = try testRequire(navigation.topItem?.leftBarButtonItem, "Missing native back button")
                let action = try testRequire(item.action, "Missing native back action")
                UIApplication.shared.sendAction(action, to: item.target, from: item, for: nil)
            }
            for (index, title) in [(0, "首页"), (1, "直播"), (2, "高清专区"), (3, "设置")] {
                browser.tabBar(tabs, didSelect: tabItems[index])
                let loaded = await until { !web.isLoading && navigation.topItem?.title == title }
                check("navigation-root-\(index)", loaded && navigation.topItem?.leftBarButtonItem == nil && tabs.selectedItem?.tag == index)
            }
            _ = try await web.evaluateJavaScript("history.pushState({},'', '/about')")
            _ = await until { navigation.topItem?.title == "关于 HomeTV" }
            check("navigation-about-has-back", navigation.topItem?.leftBarButtonItem?.accessibilityLabel == "返回")
            try tapNavigationBack()
            let aboutBack = await until { navigation.topItem?.title == "设置" && web.url?.path == "/settings" }
            check("navigation-about-back-to-settings", aboutBack)
            browser.tabBar(tabs, didSelect: tabItems[2])
            _ = await until { !web.isLoading && web.url?.path == "/hd" }
            _ = try await web.evaluateJavaScript("window.navigationFixture='preserved';history.replaceState({},'', '/hd?site=hdzone');history.pushState({},'', '/hd/hdzone?url=fixture')")
            let detailReady = await until { navigation.topItem?.title == "资源详情" && navigation.topItem?.leftBarButtonItem != nil }
            check("navigation-spa-detail-updates-title-and-tab", detailReady && tabs.selectedItem?.tag == 2)
            await wait(0.5) // Capture after the system tab selection animation settles.
            snapshot("navigation-hd-detail-portrait")
            try tapNavigationBack()
            let detailBack = await until { web.url?.path == "/hd" && navigation.topItem?.leftBarButtonItem == nil }
            let state = try await web.evaluateJavaScript("window.navigationFixture") as? String
            check("navigation-back-preserves-filter-and-document", detailBack && web.url?.query == "site=hdzone" && state == "preserved")
            browser.tabBar(tabs, didSelect: tabItems[0])
            _ = await until { !web.isLoading && navigation.topItem?.title == "首页" }
            web.load(URLRequest(url: origin.appendingPathComponent("hd/hdzone")))
            _ = await until { !web.isLoading && navigation.topItem?.title == "资源详情" }
            try tapNavigationBack()
            let directBack = await until { !web.isLoading && web.url?.path == "/hd" && web.url?.query == "site=hdzone" }
            check("navigation-direct-detail-falls-back-to-catalog", directBack && navigation.topItem?.leftBarButtonItem == nil)
            browser.tabBar(tabs, didSelect: tabItems[0])
            _ = await until { !web.isLoading && navigation.topItem?.title == "首页" }
            _ = try await web.evaluateJavaScript("history.pushState({},'', '/?s=movie');history.pushState({},'', '/watch?id=42')")
            _ = await until { navigation.topItem?.title == "影片详情" }
            try tapNavigationBack()
            let searchBack = await until { navigation.topItem?.title == "搜索结果" && web.url?.query == "s=movie" }
            check("navigation-watch-back-to-search", searchBack && navigation.topItem?.leftBarButtonItem != nil)
            try tapNavigationBack()
            _ = await until { navigation.topItem?.title == "首页" }
            check("navigation-search-back-to-home", navigation.topItem?.leftBarButtonItem == nil && tabs.selectedItem?.tag == 0)
            // Theme changes come through the actual document-start bridge. Compare
            // the native bars to the web CSS, including full document navigation.
            func nativeColorsMatchPage() async throws -> Bool {
                let palette = try testRequire(try await web.evaluateJavaScript("Object.fromEntries(['surface','page','content','muted','accent'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue('--c-'+k).trim()]))") as? [String: String], "Missing fixture theme palette")
                func matches(_ actual: UIColor?, _ key: String) -> Bool {
                    let channels = (palette[key] ?? "").split(separator: " ").compactMap { Double($0) }
                    guard channels.count == 3 else { return false }
                    let expected = UIColor(red: channels[0] / 255, green: channels[1] / 255, blue: channels[2] / 255, alpha: 1)
                    return actual?.isEqual(expected) == true
                }
                return matches(navigation.standardAppearance.backgroundColor, "surface")
                    && matches(navigation.standardAppearance.titleTextAttributes[.foregroundColor] as? UIColor, "content")
                    && matches(tabs.standardAppearance.backgroundColor, "surface")
                    && matches(tabs.tintColor, "accent") && matches(tabs.unselectedItemTintColor, "muted")
                    && matches(host.view.backgroundColor, "surface") && matches(web.backgroundColor, "page")
            }
            let systemThemeBefore = try await web.evaluateJavaScript("matchMedia('(prefers-color-scheme: dark)').matches") as? Bool
            for dark in [true, false] {
                _ = try await web.evaluateJavaScript("localStorage.setItem('fixture-theme','\(dark ? "dark" : "light")');document.documentElement.classList.toggle('dark',\(dark))")
                _ = await until { browser.preferredStatusBarStyle == (dark ? .lightContent : .darkContent) }
                await wait(0.5)
                check(dark ? "theme-dark-matches-web" : "theme-light-matches-web", try await nativeColorsMatchPage())
                snapshot(dark ? "navigation-theme-dark" : "navigation-theme-light")
            }
            browser.tabBar(tabs, didSelect: tabItems[3])
            _ = await until { !web.isLoading && web.url?.path == "/settings" }
            let retainedColors = try await nativeColorsMatchPage()
            check("theme-retained-across-document-navigation", browser.preferredStatusBarStyle == .darkContent && retainedColors)
            let systemThemeAfter = try await web.evaluateJavaScript("matchMedia('(prefers-color-scheme: dark)').matches") as? Bool
            check("theme-does-not-override-web-system-preference", systemThemeBefore == systemThemeAfter && web.overrideUserInterfaceStyle == .unspecified && host.overrideUserInterfaceStyle == .unspecified)
            _ = try await web.evaluateJavaScript("localStorage.setItem('fixture-theme','dark');document.documentElement.classList.add('dark')")
            _ = await until { browser.preferredStatusBarStyle == .lightContent }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            _ = await until { scene.interfaceOrientation == .landscapeRight }; await wait(0.5)
            snapshot("navigation-theme-dark-landscape")
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
            _ = await until { scene.interfaceOrientation == .portrait }
            browser.tabBar(tabs, didSelect: tabItems[0])
            _ = await until { !web.isLoading && navigation.topItem?.title == "首页" }
            if CommandLine.arguments.contains("--navigation-only") {
                try writeReport("player-integration.json"); fflush(stdout); return
            }
            if !CommandLine.arguments.contains("--offline-only") && !CommandLine.arguments.contains("--sleep-minute-only") {
                let scrubbing = PlayerController(session: session(), origin: origin, cookies: [])
                scrubbing.modalPresentationStyle = .fullScreen
                host.present(scrubbing, animated: false); await wait()
                let controls = try testRequire(descendants(scrubbing.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Scrubbing controls")
                let zf = try testRequire(controls.player, "Scrubbing player")
                let manager = try testRequire(zf.currentPlayerManager as? ZFAVPlayerManager, "Scrubbing manager")
                _ = await until { manager.isPlaying && manager.currentTime >= 4 }
                let originalItem = manager.playerItem
                // Buffer-empty temporarily pauses AVPlayer while retaining play intent.
                // A seek to already available data must not wait for the old 3s timer.
                func injectBufferWait() {
                    manager.setValue(NSNumber(value: 8), forKey: "loadState")
                    manager.perform(NSSelectorFromString("bufferingSomeSecond"))
                }
                injectBufferWait()
                check("seek-buffer-precondition", manager.isPlaying && manager.player?.rate == 0)
                let beforeDrag = manager.currentTime
                for value: Float in [0.3, 0.4, 0.5] { controls.portraitControlView.slider.delegate?.sliderValueChanged?(value) }
                check("seek-drag-previews-without-network-seeks", abs(manager.currentTime - beforeDrag) < 0.3)
                let start = Date()
                controls.portraitControlView.slider.delegate?.sliderTouchEnded?(0.5)
                _ = await until { !controls.portraitControlView.slider.isdragging && abs(manager.currentTime - 10) < 0.4 }
                await wait(0.6)
                results["seek-buffer-recovery-seconds"] = Date().timeIntervalSince(start)
                check("seek-buffer-resumes-without-old-retry-delay", Date().timeIntervalSince(start) < 2 && manager.isPlaying && manager.player?.rate == 1.5 && manager.currentTime > 10.2)
                // A pause issued after committing a seek takes priority over completion.
                injectBufferWait()
                controls.portraitControlView.slider.delegate?.sliderTouchEnded?(0.3)
                controls.playButton.sendActions(for: .touchUpInside)
                _ = await until { !controls.portraitControlView.slider.isdragging }; await wait(0.3)
                check("seek-buffer-completion-respects-manual-pause", !manager.isPlaying && manager.player?.rate == 0)
                controls.playButton.sendActions(for: .touchUpInside)
                injectBufferWait()
                for value: Float in [0.25, 0.6, 0.4] { controls.portraitControlView.slider.delegate?.sliderTouchEnded?(value) }
                _ = await until { !controls.portraitControlView.slider.isdragging && abs(manager.currentTime - 8) < 0.4 }
                await wait(0.3)
                check("seek-rapid-drag-last-target-plays", manager.isPlaying && manager.player?.rate == 1.5 && manager.currentTime >= 7.75 && manager.currentTime < 9.5 && manager.playerItem === originalItem)
                await wait(3.2)
                check("seek-old-buffer-timer-cannot-repause", manager.isPlaying && manager.player?.rate == 1.5 && manager.currentTime > 11)
                injectBufferWait()
                controls.gestureBeganPan(zf.gestureControl, panDirection: .H, panLocation: .left)
                controls.gestureChangedPan(zf.gestureControl, panDirection: .H, panLocation: .left, withVelocity: CGPoint(x: -800, y: 0))
                controls.gestureEndedPan(zf.gestureControl, panDirection: .H, panLocation: .left)
                _ = await until { !controls.portraitControlView.slider.isdragging }; await wait(0.6)
                check("seek-pan-recovers-buffered-playback", manager.isPlaying && manager.player?.rate == 1.5 && manager.playerItem === originalItem)
                controls.playButton.sendActions(for: .touchUpInside)
                controls.portraitControlView.slider.delegate?.sliderTouchEnded?(0.25)
                _ = await until { !controls.portraitControlView.slider.isdragging }; await wait(0.2)
                check("seek-paused-player-stays-paused", !manager.isPlaying && manager.player?.rate == 0 && abs(manager.currentTime - 5) < 0.3)
                scrubbing.closePlayer(); await wait(0.5)
                check("seek-close-releases-player", manager.player == nil)
                // HLS seeks cross a transport-stream boundary, not just an MP4 range.
                var hlsSession = session("/offline-hls/index.m3u8", autoplay: false)
                hlsSession.rate = 1; hlsSession.episodes[0].position = 0
                let hlsSeeking = PlayerController(session: hlsSession, origin: origin, cookies: [])
                hlsSeeking.modalPresentationStyle = .fullScreen
                host.present(hlsSeeking, animated: false); await wait()
                let hc = try testRequire(descendants(hlsSeeking.view).compactMap { $0 as? HomeTVPlayerControls }.first, "HLS seek controls")
                let hm = try testRequire(hc.player?.currentPlayerManager as? ZFAVPlayerManager, "HLS seek manager")
                _ = await until { hm.isPlaying && hm.totalTime > 6 }
                let hlsItem = hm.playerItem
                hm.setValue(NSNumber(value: 8), forKey: "loadState")
                hm.perform(NSSelectorFromString("bufferingSomeSecond"))
                hc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.55)
                let hlsLanded = await until { !hc.portraitControlView.slider.isdragging && hm.currentTime >= 3.1 }
                let hlsTime = hm.currentTime
                await wait(0.5)
                check("seek-hls-cross-segment-recovers", hlsLanded && hm.isPlaying && hm.player?.rate == 1 && hm.currentTime > hlsTime + 0.2 && hm.playerItem === hlsItem)
                hc.playButton.sendActions(for: .touchUpInside)
                hc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.2)
                _ = await until { !hc.portraitControlView.slider.isdragging }; await wait(0.2)
                check("seek-hls-paused-reposition-stays-paused", !hm.isPlaying && hm.player?.rate == 0 && abs(hm.currentTime - hm.totalTime * 0.2) <= 0.3)
                hlsSeeking.closePlayer(); await wait(0.5)
                let pessimistic = HomeTVPlayerManager()
                pessimistic.assetURL = origin.appendingPathComponent("video.mp4")
                _ = await until { pessimistic.playerItem?.status == .readyToPlay }
                let realPlayer = try testRequire(pessimistic.player, "Pessimistic buffer player")
                let pessimisticItem = PessimisticBufferItem(url: origin.appendingPathComponent("video.mp4"))
                realPlayer.replaceCurrentItem(with: pessimisticItem)
                pessimistic.setValue(pessimisticItem, forKey: "playerItem")
                _ = await until { pessimisticItem.status == .readyToPlay && !pessimisticItem.loadedTimeRanges.isEmpty }
                pessimistic.play(); await wait(0.3)
                check("buffer-pessimistic-has-playable-data", !pessimisticItem.isPlaybackLikelyToKeepUp && pessimistic.currentTime > 0)
                let stalledTime = pessimistic.currentTime
                pessimistic.setValue(NSNumber(value: 8), forKey: "loadState")
                pessimistic.perform(NSSelectorFromString("bufferingSomeSecond"))
                await wait(3.7)
                check("buffer-pessimistic-prediction-cannot-loop-pause", pessimistic.isPlaying && realPlayer.rate > 0 && pessimistic.currentTime > stalledTime + 0.3)
                check("buffer-pessimistic-playback-clears-spinner", pessimistic.loadState.rawValue != 8)
                pessimistic.stop()
                // A remote item may report EOF before its advertised duration.
                // Exercise the real notification chain at mid-film position.
                let premature = PlayerController(session: session(autoplay: false), origin: origin, cookies: [])
                var prematureEvents: [[String: Any]] = []
                premature.onProgress = { prematureEvents.append($0) }
                premature.modalPresentationStyle = .fullScreen
                host.present(premature, animated: false)
                _ = await until { premature.isViewLoaded && host.presentedViewController === premature }
                let pc = try testRequire(descendants(premature.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Premature EOF controls")
                let pm = try testRequire(pc.player?.currentPlayerManager as? ZFAVPlayerManager, "Premature EOF manager")
                _ = await until { pm.isPlaying && pm.currentTime >= 4 }
                let eofPosition = pm.currentTime
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: pm.playerItem)
                await wait(0.4)
                check("premature-eof-does-not-mark-watched", !prematureEvents.contains { $0["reason"] as? String == "ended" })
                _ = await until { pm.isPlaying && pm.currentTime >= eofPosition - 0.25 }
                check("premature-eof-recovers-same-position", pm.isPlaying && pm.currentTime >= eofPosition - 0.25 && premature.session.index == 0)
                // A second EOF must stop bounded recovery, retaining the retry
                // position rather than presenting a replay-from-zero action.
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: pm.playerItem)
                await wait(0.3)
                check("premature-eof-repeat-shows-retry", !pm.isPlaying && !pc.failBtn.isHidden)
                pc.playButton.sendActions(for: .touchUpInside)
                _ = await until { pm.isPlaying }
                check("premature-eof-play-button-never-restarts-zero", pm.currentTime >= eofPosition - 0.25)
                let stableItem = pm.playerItem
                // Deliver EOF, then supersede it before the queued handler runs.
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: stableItem)
                pc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.5)
                _ = await until { !pc.portraitControlView.slider.isdragging && pm.currentTime >= 9.75 }
                check("queued-eof-cannot-override-new-user-seek", pm.playerItem === stableItem && pm.isPlaying && pm.currentTime >= 9.75)
                // And the opposite ordering: an EOF during an outstanding seek.
                pc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.6)
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: stableItem)
                _ = await until { !pc.portraitControlView.slider.isdragging && pm.currentTime >= 11.75 }
                check("eof-during-seek-preserves-target", pm.playerItem === stableItem && pm.isPlaying && pm.currentTime >= 11.75)
                pc.playButton.sendActions(for: .touchUpInside)
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: pm.playerItem)
                await wait(0.3)
                check("premature-eof-respects-manual-pause", !pm.isPlaying && pm.playerItem === stableItem && pm.currentTime >= 11.75)
                NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: pm.playerItem)
                await wait(0.2)
                check("premature-eof-respects-background", !pm.isPlaying && pm.playerItem === stableItem)
                NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
                check("premature-eof-foreground-stays-paused", !pm.isPlaying)
                premature.closePlayer(); await wait(0.5)
                let prematureAuto = PlayerController(session: session(), origin: origin, cookies: [])
                var autoEndEvents: [[String: Any]] = []
                prematureAuto.onProgress = { autoEndEvents.append($0) }
                prematureAuto.modalPresentationStyle = .fullScreen
                host.present(prematureAuto, animated: false)
                _ = await until { prematureAuto.isViewLoaded && host.presentedViewController === prematureAuto }
                let ac = try testRequire(descendants(prematureAuto.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Premature autoplay controls")
                let am = try testRequire(ac.player?.currentPlayerManager as? ZFAVPlayerManager, "Premature autoplay manager")
                _ = await until { am.isPlaying && am.currentTime >= 4 }
                let obsoleteItem = am.playerItem
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: obsoleteItem)
                _ = await until { am.playerItem !== obsoleteItem && am.isPlaying }
                check("premature-eof-cannot-auto-advance-episode", prematureAuto.session.index == 0 && !autoEndEvents.contains { $0["reason"] as? String == "ended" })
                let recoveredItem = am.playerItem
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: obsoleteItem)
                await wait(0.2)
                check("obsolete-item-eof-cannot-interrupt-replacement", am.playerItem === recoveredItem && am.isPlaying)
                NotificationCenter.default.post(name: AVPlayerItem.didPlayToEndTimeNotification, object: recoveredItem)
                ac.nextButton.sendActions(for: .touchUpInside)
                _ = await until { prematureAuto.session.index == 1 && am.isPlaying }
                check("queued-eof-cannot-override-manual-next-episode", prematureAuto.session.index == 1 && am.isPlaying && am.currentTime >= 2 && am.currentTime < 5)
                prematureAuto.closePlayer(); await wait(0.5)
                // Real player diagnostics must persist in ordinary launches,
                // without --playback-diagnostics or an attached console.
                PlaybackLogStore.shared.flush()
                let logDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PlaybackLogs")
                let logData = try Data(contentsOf: logDirectory.appendingPathComponent("playback-0.jsonl"))
                let logText = String(decoding: logData, as: UTF8.self)
                check("file-logs-record-player-seeks-without-console-flag", logText.contains("seek-start") && logText.contains("seek-end"))
                check("file-logs-include-pause-intent-and-network-metrics", logText.contains("toggle-request") && logText.contains("userPaused") && logText.contains("observedBitrate"))
                check("file-logs-omit-media-addresses", !logText.contains("127.0.0.1") && !logText.contains("video.mp4") && !logText.contains("http:"))
                if CommandLine.arguments.contains("--seek-only") { try writeReport("player-integration.json"); fflush(stdout); return }
            }

            if fault == nil {
                let downloads = OfflineDownloads.shared
                for item in downloads.videos { try downloads.delete(item.id) }
                let mp4 = origin.appendingPathComponent("offline-fixture.mp4")
                let downloadID = try downloads.enqueue(url: mp4, title: "离线测试 · 合成短片", origin: origin, cookies: [])
                let duplicateID = try downloads.enqueue(url: mp4, title: "离线测试", origin: origin, cookies: [])
                check("download-deduplicates-repeated-taps", downloadID == duplicateID)
                for _ in 0..<600 {
                    if [.completed, .failed].contains(downloads.library?.video(downloadID)?.state) { break }; await wait(0.1)
                }
                let downloaded = try testRequire(downloads.library?.video(downloadID), "Missing MP4 download")
                results["mp4-download-error"] = downloaded.error ?? ""
                check("mp4-download-saves-playable-local-file", downloaded.state == .completed && downloads.library?.playableURL(downloadID)?.isFileURL == true && downloaded.bytes > 0)
                let hlsURL = origin.appendingPathComponent("offline-hls/index.m3u8")
                let hlsID = try downloads.enqueue(url: hlsURL, title: "离线测试 · HLS 短片", origin: origin, cookies: [])
                for _ in 0..<600 {
                    if [.completed, .failed].contains(downloads.library?.video(hlsID)?.state) { break }; await wait(0.1)
                }
                results["hls-download-error"] = downloads.library?.video(hlsID)?.error ?? ""
                check("hls-download-saves-offline-package", downloads.library?.video(hlsID)?.state == .completed && downloads.library?.playableURL(hlsID)?.pathExtension == "movpkg")
                let restoredLibrary = try OfflineLibrary()
                check("download-library-survives-reload", restoredLibrary.playableURL(downloadID) != nil && restoredLibrary.playableURL(hlsID) != nil)
                _ = try await URLSession.shared.data(from: origin.appendingPathComponent("offline-test-block"))
                // Exercise the real document-start bridge and the same Settings action.
                _ = try await web.evaluateJavaScript("window.dispatchEvent(new Event('libretv:show-download-manager'))")
                _ = await until { host.presentedViewController is UINavigationController }
                let nav = try testRequire(host.presentedViewController as? UINavigationController, "Native download manager must open from Settings event")
                let list = try testRequire(nav.topViewController as? OfflineDownloadsController, "Offline list")
                _ = await until { list.viewIfLoaded?.window != nil }
                check("settings-download-event-opens-native-library", list.title == "我的下载")
                await wait(0.5); snapshot("offline-downloads-portrait")
                for id in [downloadID, hlsID] where downloads.library?.playableURL(id) != nil {
                    list.play(id)
                    _ = await until { list.presentedViewController is PlayerController }
                    let offline = try testRequire(list.presentedViewController as? PlayerController, "Offline player")
                    let oc = try testRequire(Mirror(reflecting: offline).children.first { $0.label == "controls" }?.value as? HomeTVPlayerControls, "Offline controls")
                    let oe = try testRequire(oc.player?.currentPlayerManager as? ZFAVPlayerManager, "Offline engine")
                    let playing = await until { oe.isPlaying && oe.currentTime > 0.5 }
                    check(id == downloadID ? "mp4-plays-with-source-offline" : "hls-plays-with-source-offline", playing && oe.assetURL?.isFileURL == true && oc.downloadButton.isHidden)
                    offline.closePlayer(); _ = await until { list.presentedViewController == nil }
                }
                check("offline-playback-persists-resume", (downloads.library?.video(downloadID)?.position ?? 0) > 0)
                nav.dismiss(animated: false); _ = await until { host.presentedViewController == nil }
                let localFile = try testRequire(downloads.library?.playableURL(downloadID), "Downloaded MP4 path")
                let localHLS = try testRequire(downloads.library?.playableURL(hlsID), "Downloaded HLS path")
                try downloads.delete(downloadID); try downloads.delete(hlsID)
                check("delete-download-removes-file-and-record", !FileManager.default.fileExists(atPath: localFile.path) && !FileManager.default.fileExists(atPath: localHLS.path) && downloads.videos.isEmpty)
                _ = try await URLSession.shared.data(from: origin.appendingPathComponent("offline-test-unblock"))
                let cancelID = try downloads.enqueue(url: mp4, title: "取消测试", origin: origin, cookies: [])
                try downloads.delete(cancelID); await wait(0.5)
                check("cancelled-download-does-not-reappear", downloads.library?.video(cancelID) == nil)
                let badID = try downloads.enqueue(url: origin.appendingPathComponent("fail.mp4"), title: "失败测试", origin: origin, cookies: [])
                _ = await until { downloads.library?.video(badID)?.state == .failed }
                check("download-http-error-is-not-completed", downloads.library?.video(badID)?.state == .failed && downloads.library?.playableURL(badID) == nil)
                try downloads.delete(badID)
                browser.webView(web, didFailProvisionalNavigation: nil, withError: URLError(.notConnectedToInternet))
                let offlineButton = try testRequire(descendants(host.view).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "offline.open" }, "Offline entry button")
                check("network-error-keeps-offline-entry", !offlineButton.isHidden)
                offlineButton.sendActions(for: .touchUpInside)
                _ = await until { host.presentedViewController is UINavigationController }
                check("offline-entry-opens-without-web-page", (host.presentedViewController as? UINavigationController)?.topViewController is OfflineDownloadsController)
                host.dismiss(animated: false); _ = await until { host.presentedViewController == nil }
                web.reload(); _ = await until { !web.isLoading }
            }
            if CommandLine.arguments.contains("--offline-only") {
                try writeReport("player-integration.json"); fflush(stdout); return
            }
            var now = Date(timeIntervalSince1970: 1000)
            let timer = SleepTimer(now: { now })
            let controller = PlayerController(session: session(), origin: origin, cookies: [], sleepTimer: timer)
            var events: [[String: Any]] = []
            controller.onProgress = { events.append($0) }
            controller.modalPresentationStyle = .fullScreen
            host.present(controller, animated: false)
            await wait()
            let controls = try testRequire(fault == "missing-controls" ? nil : descendants(controller.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing initial player controls")
            let controlsPlayer = try testRequire(fault == "missing-player" ? nil : controls.player, "Missing player: controls")
            let engine = try testRequire(fault == "wrong-manager" ? nil : controlsPlayer.currentPlayerManager as? ZFAVPlayerManager, "Unexpected player manager: controls")
            check("uses-ZFPlayer-engine-and-controls", engine.view.superview != nil && controls.superview != nil)
            let ready = await until { engine.isPlaying && engine.currentTime >= 4 }
            check("restores-position-before-autoplay", ready && engine.currentTime < 8)
            check("restores-playback-rate", abs((engine.player?.rate ?? -1) - 1.5) < 0.01)
            controls.playButton.sendActions(for: .touchUpInside)
            check("pause-button", !engine.isPlaying && events.last?["reason"] as? String == "pause")
            controls.downloadButton.sendActions(for: .touchUpInside)
            _ = await until { controller.presentedViewController is UIAlertController }
            let downloadPrompt = try testRequire(controller.presentedViewController as? UIAlertController, "Download confirmation")
            check("player-download-button-selects-current-episode", controls.downloadButton.isEnabled && downloadPrompt.title == "下载到这台手机" && downloadPrompt.message?.contains("第1集") == true)
            downloadPrompt.dismiss(animated: false); _ = await until { controller.presentedViewController == nil }
            // Put a long title on-screen and exercise the actual rotation button.
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)); await wait(1)
            if !controls.controlViewAppeared { controls.gestureSingleTapped(controlsPlayer.gestureControl) }
            await wait()
            func layoutIsSafe() -> Bool {
                let safe = controller.view.safeAreaLayoutGuide.layoutFrame
                let buttons = [controls.backButton, controls.downloadButton, controls.rotateButton, controls.previousButton, controls.playButton, controls.nextButton, controls.episodesButton, controls.speedButton, controls.sleepButton]
                return buttons.allSatisfy { button in
                    let frame = button.convert(button.bounds, to: controller.view)
                    return frame.width >= 44 && frame.height >= 44 && safe.contains(frame)
                } && controls.portraitControlView.slider.bounds.width > 100
            }
            check("portrait-safe-area-and-hit-targets", layoutIsSafe())
            snapshot("player-zf-portrait")
            controls.rotateButton.sendActions(for: .touchUpInside); await wait(1.2)
            check("rotation-button", controller.view.bounds.width > controller.view.bounds.height)
            check("landscape-safe-area-and-hit-targets", layoutIsSafe())
            let prev = controls.previousButton.convert(controls.previousButton.bounds, to: controller.view)
            let play = controls.playButton.convert(controls.playButton.bounds, to: controller.view)
            let next = controls.nextButton.convert(controls.nextButton.bounds, to: controller.view)
            check("transport-controls-left-aligned", prev.maxX <= play.minX && play.maxX <= next.minX && next.maxX < controller.view.bounds.midX)
            snapshot("player-zf-landscape")
            check("speed-and-sleep-menus", controls.speedButton.menu?.children.count == 8 && controls.sleepButton.menu?.children.count == 8)
            await wait(4.5)
            check("controls-auto-hide", !controls.controlViewAppeared && controls.playButton.superview?.alpha == 0)
            controls.gestureSingleTapped(controlsPlayer.gestureControl); await wait()
            check("tap-shows-controls", controls.controlViewAppeared && controls.playButton.superview?.alpha == 1)
            controls.gestureDoubleTapped(controlsPlayer.gestureControl)
            check("double-tap-resumes", engine.isPlaying)
            controls.gestureDoubleTapped(controlsPlayer.gestureControl)
            check("double-tap-pauses", !engine.isPlaying)
            engine.seek(toTime: 10, completionHandler: nil); await wait()
            check("seek-while-paused", abs(engine.currentTime - 10) < 0.5 && !engine.isPlaying)
            controls.nextButton.sendActions(for: .touchUpInside)
            let second = await until { controller.session.index == 1 && engine.isPlaying && engine.currentTime >= 2 }
            check("next-episode-restores-own-position", second && engine.currentTime < 6 && abs((engine.player?.rate ?? -1) - 1.5) < 0.01)
            controls.previousButton.sendActions(for: .touchUpInside)
            let previous = await until { controller.session.index == 0 && engine.isPlaying && engine.currentTime >= 10 }
            check("previous-episode-preserves-progress", previous && engine.currentTime < 14)
            NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
            check("background-pauses", !engine.isPlaying)
            NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
            check("foreground-does-not-autoplay", !engine.isPlaying)
            controls.playButton.sendActions(for: .touchUpInside)
            engine.seek(toTime: 19.5, completionHandler: nil)
            let autoNext = await until { controller.session.index == 1 && engine.isPlaying }
            check("natural-end-autoplays-next", autoNext && events.contains { $0["reason"] as? String == "ended" })
            timer.set(minutes: 1); now += 60
            // A seek/replay completion can still be queued when the deadline fires.
            engine.replay()
            NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
            let slept = await until { events.contains { $0["reason"] as? String == "sleep" } }
            await wait(0.5)
            check("sleep-deadline-stops-and-disables-autoplay", slept && !engine.isPlaying && !controller.session.autoplayNext)
            check("sleep-releases-media-and-screen", engine.player == nil && !UIApplication.shared.isIdleTimerDisabled)
            let timerStopped = (Mirror(reflecting: controller).children.first { $0.label == "tick" }?.value as? Timer)?.isValid != true
            check("sleep-stops-progress-timer", timerStopped)
            let eventCount = events.count
            engine.play() // Simulate a delayed library/recovery callback, without a user command.
            await wait(1.2)
            check("sleep-rejects-late-play", !engine.isPlaying && engine.player == nil)
            check("sleep-has-no-periodic-work", events.count == eventCount)
            controls.playButton.sendActions(for: .touchUpInside)
            _ = await until { engine.isPlaying }
            check("sleep-explicit-resume-reactivates-screen", engine.isPlaying && UIApplication.shared.isIdleTimerDisabled)
            engine.seek(toTime: 19.5, completionHandler: nil)
            let finalEnd = await until { !engine.isPlaying && events.last?["reason"] as? String == "ended" }
            check("last-episode-stops-at-end", finalEnd && controller.session.index == 1)
            controls.portraitControlView.sliderValueChanging?(0.5, false)
            engine.seek(toTime: 10, completionHandler: nil); await wait()
            controls.playButton.sendActions(for: .touchUpInside); await wait()
            check("seek-after-end-resumes-selected-position", engine.isPlaying && engine.currentTime >= 10 && engine.currentTime < 14)
            var closeCompleted = false
            controller.onClose = { closeCompleted = true }
            controller.closePlayer()
            // Dismissal is asynchronous; CI may take longer than a fixed 0.6s.
            // Keep the deadline and all resource checks, but wait for completion.
            let dismissed = await until { closeCompleted && host.presentedViewController == nil }
            results["close-completion-received"] = closeCompleted
            results["close-player-released"] = engine.player == nil
            results["close-idle-timer-restored"] = !UIApplication.shared.isIdleTimerDisabled
            check("close-releases-player", dismissed && engine.player == nil && !UIApplication.shared.isIdleTimerDisabled)
            let restoredPortrait = await until { scene.interfaceOrientation == .portrait && host.view.bounds.height > host.view.bounds.width }
            check("landscape-close-restores-portrait-home", restoredPortrait)
            check("home-tab-bar-visible-after-return", descendants(host.view).compactMap { $0 as? UITabBar }.contains { $0.window != nil && !$0.isHidden && $0.frame.maxY <= host.view.bounds.height + 1 && $0.frame.minY > host.view.bounds.midY })
            snapshot("home-after-landscape-close")

            let retryController = PlayerController(session: session("/fail.mp4", autoplay: false), origin: origin, cookies: [])
            retryController.modalPresentationStyle = .fullScreen
            host.present(retryController, animated: false); await wait()
            let retryControls = try testRequire(descendants(retryController.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing controls: retryController")
            let retryControlsPlayer = try testRequire(retryControls.player, "Missing player: retryControls")
            let retryEngine = try testRequire(retryControlsPlayer.currentPlayerManager as? ZFAVPlayerManager, "Unexpected player manager: retryControls")
            let recovered = await until { retryEngine.isPlaying && retryEngine.currentTime >= 4 }
            check("proxy-fallback-restores-position", recovered && retryEngine.assetURL?.path == "/api/proxy" && retryEngine.currentTime < 8)
            retryController.closePlayer(); await wait(0.5)
            let failed = PlayerController(session: session("/always-fail.mp4"), origin: origin, cookies: [])
            var errors = 0
            failed.onProgress = { if $0["reason"] as? String == "error" { errors += 1 } }
            failed.modalPresentationStyle = .fullScreen
            host.present(failed, animated: false); await wait()
            let failControls = try testRequire(descendants(failed.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing controls: failed")
            _ = await until { errors == 1 }
            check("failed-source-shows-retry", !failControls.failBtn.isHidden && errors == 1)
            failControls.failBtn.sendActions(for: .touchUpInside)
            let retried = await until { errors == 2 }
            check("retry-button-reloads-failed-source", retried && !failControls.failBtn.isHidden)
            failed.closePlayer(); await wait(0.5)
            // Regression: rapid rotation and picker selection while playback continues.
            let rotation = PlayerController(session: session(), origin: origin, cookies: [])
            rotation.modalPresentationStyle = .fullScreen
            host.present(rotation, animated: false); await wait()
            let rc = try testRequire(descendants(rotation.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing controls: rotation")
            let rcPlayer = try testRequire(rc.player, "Missing player: rc")
            let re = try testRequire(rcPlayer.currentPlayerManager as? ZFAVPlayerManager, "Unexpected player manager: rc")
            _ = await until { re.isPlaying }
            let itemBeforeRotation = re.playerItem
            let positionBeforeRotation = re.currentTime
            for _ in 0..<4 {
                rc.rotateButton.sendActions(for: .touchUpInside); await wait(0.7)
            }
            check("rotation-keeps-item-and-progress", re.playerItem === itemBeforeRotation && re.currentTime >= positionBeforeRotation && re.isPlaying)
            let videoSurface = try testRequire(descendants(rotation.view).first { $0.accessibilityIdentifier == "player.video-surface" }, "Video surface")
            @MainActor func checkEpisodeOverlay(_ name: String, _ picker: EpisodePickerController, landscape: Bool) {
                let video = videoSurface.frame
                let panel = picker.panel.frame
                let renderer = re.view.convert(re.view.bounds, to: rotation.view)
                check(name + "-video-unchanged", video == rotation.view.bounds && renderer == rotation.view.bounds && re.playerItem === itemBeforeRotation)
                check(name + "-placement", landscape ? (panel.maxX == video.maxX && panel.width < video.width * 0.5 && panel.height == video.height) : (panel.maxY == video.maxY && panel.width == video.width && panel.height < video.height * 0.6))
                let safe = rotation.view.safeAreaLayoutGuide.layoutFrame
                let close = picker.closeButton.convert(picker.closeButton.bounds, to: rotation.view)
                let grid = picker.collection.convert(picker.collection.bounds, to: rotation.view)
                check(name + "-safe-controls", safe.contains(close) && safe.contains(grid) && close.width >= 44 && close.height >= 44 && !close.intersects(grid))
                let outside = landscape ? CGPoint(x: panel.minX / 2, y: video.midY) : CGPoint(x: video.midX, y: panel.minY / 2)
                check(name + "-outside-tap-isolated", picker.view.hitTest(outside, with: nil) === picker.backdrop && rc.isHidden)
            }
            let beforePaneTime = re.currentTime
            rc.episodesButton.sendActions(for: .touchUpInside); await wait(0.5)
            check("episode-pane-keeps-playing", re.isPlaying && re.playerItem === itemBeforeRotation && re.currentTime > beforePaneTime && rotation.presentedViewController == nil && videoSurface.frame == rotation.view.bounds)
            rc.episodesButton.sendActions(for: .touchUpInside); await wait(0.2)
            check("episode-pane-toggle-restores-controls", rotation.children.isEmpty && !rc.isHidden && videoSurface.frame == rotation.view.bounds && re.isPlaying && re.playerItem === itemBeforeRotation)
            rc.playButton.sendActions(for: .touchUpInside) // Inspect drawers without natural auto-next.
            let originalEpisodes = rotation.session.episodes
            let originalEpisode = originalEpisodes[0]
            let longEpisodeTitle = "第一集 · 这是用于检查长标题完整显示的特别篇：当故事跨越山川与城市，仍然保留所有章节名称和补充说明"
            rotation.session.episodes[0] = Episode(url: originalEpisode.url, title: longEpisodeTitle, position: originalEpisode.position)
            rotation.session.episodes += (3...30).map { Episode(url: originalEpisode.url, title: "第\($0 + 10)集", position: 0) }
            for dark in [false, true] {
                _ = try await web.evaluateJavaScript("localStorage.setItem('fixture-theme','\(dark ? "dark" : "light")');document.documentElement.classList.toggle('dark',\(dark))")
                _ = await until { NativeTheme.current.dark == dark }
                rc.episodesButton.sendActions(for: .touchUpInside); await wait(0.6)
                let picker = try testRequire(rotation.children.first as? EpisodePickerController, "Episode drawer")
                let currentCell = try testRequire(picker.collection.cellForItem(at: IndexPath(item: 0, section: 0)) as? EpisodeGridCell, "Current episode cell")
                let prefix = dark ? "episode-drawer-dark" : "episode-drawer-light"
                check(prefix + "-transparent-player-style", picker.view.backgroundColor == .clear && picker.collection.backgroundColor == .clear && picker.panel.backgroundColor == NativeTheme(dark: true).page.withAlphaComponent(0.82))
                check(prefix + "-current-and-long-title", currentCell.accessibilityTraits.contains(.selected) && currentCell.label.text == longEpisodeTitle && currentCell.label.numberOfLines == 0 && currentCell.frame.height > 76)
                let second = try testRequire(picker.collection.layoutAttributesForItem(at: IndexPath(item: 1, section: 0)), "Second episode layout")
                let third = try testRequire(picker.collection.layoutAttributesForItem(at: IndexPath(item: 2, section: 0)), "Third episode layout")
                check(prefix + "-numbered-grid", second.frame.minY == third.frame.minY && second.frame.maxX < third.frame.minX && second.frame.width >= 44)
                let thirdCell = picker.collection.cellForItem(at: IndexPath(item: 2, section: 0)) as? EpisodeGridCell
                check(prefix + "-preserves-source-episode-number", thirdCell?.label.text == "13")
                checkEpisodeOverlay(prefix + "-portrait", picker, landscape: false)
                snapshot(prefix + "-portrait")
                if dark {
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
                    _ = await until { scene.interfaceOrientation == .landscapeRight }; await wait(0.5)
                    check("episode-pane-rotation-keeps-current", rotation.session.index == 0 && !re.isPlaying && picker.collection.cellForItem(at: IndexPath(item: 0, section: 0))?.accessibilityTraits.contains(.selected) == true)
                    checkEpisodeOverlay(prefix + "-landscape", picker, landscape: true)
                    snapshot(prefix + "-landscape")
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeLeft))
                    _ = await until { scene.interfaceOrientation == .landscapeLeft }; await wait(0.4)
                    checkEpisodeOverlay(prefix + "-landscape-left", picker, landscape: true)
                    check("episode-pane-both-landscapes-preserve-item", re.playerItem === itemBeforeRotation && !re.isPlaying)
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
                    _ = await until { scene.interfaceOrientation == .portrait }; await wait(0.3)
                }
                // Exercise both dismissal affordances; neither may play/pause or seek.
                (dark ? picker.backdrop : picker.closeButton).sendActions(for: .touchUpInside)
                let closed = await until { rotation.children.isEmpty && videoSurface.frame == rotation.view.bounds }
                check(prefix + "-dismiss-preserves-pause", closed && !rc.isHidden && rotation.session.index == 0 && !re.isPlaying && re.playerItem === itemBeforeRotation)
            }
            rotation.session.episodes = originalEpisodes
            rc.playButton.sendActions(for: .touchUpInside)
            rc.episodesButton.sendActions(for: .touchUpInside); await wait(0.4)
            if let picker = rotation.children.first as? EpisodePickerController {
                picker.collectionView(picker.collection, didSelectItemAt: IndexPath(item: 1, section: 0))
                _ = await until { rotation.session.index == 1 && re.isPlaying }
                check("picker-selects-episode", rotation.session.index == 1 && re.currentTime >= 2 && re.currentTime < 6 && rotation.children.isEmpty && !rc.isHidden && videoSurface.frame == rotation.view.bounds)
            } else { check("picker-selects-episode", false) }
            rc.previousButton.sendActions(for: .touchUpInside)
            rc.nextButton.sendActions(for: .touchUpInside)
            rc.previousButton.sendActions(for: .touchUpInside)
            _ = await until { rotation.session.index == 0 && re.isPlaying }
            check("rapid-switch-keeps-last-choice", rotation.session.index == 0 && re.assetURL?.query == nil)
            rc.gestureBeganPan(rcPlayer.gestureControl, panDirection: .H, panLocation: .left)
            rc.gestureChangedPan(rcPlayer.gestureControl, panDirection: .H, panLocation: .left, withVelocity: CGPoint(x: 600, y: 0))
            rc.gestureEndedPan(rcPlayer.gestureControl, panDirection: .H, panLocation: .left)
            rc.nextButton.sendActions(for: .touchUpInside)
            _ = await until { rotation.session.index == 1 && re.isPlaying }
            await wait(0.5)
            results["drag-switch-clock"] = re.currentTime
            results["drag-switch-label"] = rc.portraitControlView.currentTimeLabel.text
            check("drag-switch-clears-slider-state", !rc.portraitControlView.slider.isdragging && !rc.landScapeControlView.slider.isdragging && !rc.bottomPgrogress.isdragging)
            check("drag-switch-updates-progress-label", re.currentTime >= 2 && rc.portraitControlView.currentTimeLabel.text != "00:00")
            // Cancel a same-item pan seek, then begin another before its callback.
            func pan(_ end: Bool) {
                rc.gestureBeganPan(rcPlayer.gestureControl, panDirection: .H, panLocation: .left)
                rc.gestureChangedPan(rcPlayer.gestureControl, panDirection: .H, panLocation: .left, withVelocity: CGPoint(x: 200, y: 0))
                if end { rc.gestureEndedPan(rcPlayer.gestureControl, panDirection: .H, panLocation: .left) }
            }
            pan(true)
            re.playerItem?.cancelPendingSeeks()
            re.pause()
            await wait()
            check("cancelled-pan-releases-all-sliders", !rc.portraitControlView.slider.isdragging && !rc.landScapeControlView.slider.isdragging && !rc.bottomPgrogress.isdragging)
            pan(true)
            pan(false)
            await wait()
            check("old-pan-completion-preserves-new-drag", rc.portraitControlView.slider.isdragging && rc.bottomPgrogress.isdragging)
            rc.gestureEndedPan(rcPlayer.gestureControl, panDirection: .H, panLocation: .left)
            await wait()
            check("new-pan-completion-releases-sliders", !rc.portraitControlView.slider.isdragging && !rc.bottomPgrogress.isdragging)
            // Slider completions must obey the same reset/new-gesture boundary.
            rc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.5)
            pan(false)
            await wait()
            check("old-slider-completion-preserves-new-pan", rc.portraitControlView.slider.isdragging && rc.bottomPgrogress.isdragging)
            rc.nextButton.sendActions(for: .touchUpInside) // Last episode: no-op.
            rc.previousButton.sendActions(for: .touchUpInside)
            _ = await until { rotation.session.index == 0 && re.isPlaying }
            check("switch-resets-active-pan", !rc.portraitControlView.slider.isdragging && !rc.bottomPgrogress.isdragging)
            rotation.closePlayer(); await wait(0.6)

            // Regression: a real user seek supersedes the initial AVPlayer restore seek.
            let seeking = PlayerController(session: session(), origin: origin, cookies: [])
            seeking.loadViewIfNeeded()
            let sc = try testRequire(Mirror(reflecting: seeking).children.first { $0.label == "controls" }?.value as? HomeTVPlayerControls, "Missing or invalid reflected controls: seeking")
            let scPlayer = try testRequire(sc.player, "Missing player: sc")
            let se = try testRequire(scPlayer.currentPlayerManager as? ZFAVPlayerManager, "Unexpected player manager: sc")
            var injectedSeek = false
            var seekEvents: [[String: Any]] = []
            seeking.onProgress = { seekEvents.append($0) }
            let observation = se.observe(\.assetURL, options: [.new]) { _, _ in
                guard se.assetURL != nil, !injectedSeek else { return }
                let original = scPlayer.playerReadyToPlay
                scPlayer.playerReadyToPlay = { asset, url in
                    original?(asset, url)
                    injectedSeek = true
                    sc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.5)
                }
            }
            seeking.modalPresentationStyle = .fullScreen
            host.present(seeking, animated: false)
            _ = await until { injectedSeek && se.currentTime >= 10 }
            sc.playButton.sendActions(for: .touchUpInside)
            await wait(0.7)
            check("superseded-restore-still-allows-play", se.isPlaying)
            results["superseded-restore-clock"] = se.currentTime
            seeking.closePlayer(); await wait(0.6)
            results["superseded-restore-saved"] = seekEvents.last?["position"]
            check("superseded-restore-saves-new-position", (seekEvents.last?["position"] as? Double ?? 0) >= 10)
            observation.invalidate()

            // Fault-inject a buffer-empty event, then use actual episode/pause buttons.
            let buffering = PlayerController(session: session(), origin: origin, cookies: [])
            buffering.modalPresentationStyle = .fullScreen
            host.present(buffering, animated: false); await wait()
            let bc = try testRequire(descendants(buffering.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing controls: buffering")
            let bcPlayer = try testRequire(bc.player, "Missing player: bc")
            let be = try testRequire(bcPlayer.currentPlayerManager as? ZFAVPlayerManager, "Unexpected player manager: bc")
            _ = await until { be.isPlaying }
            be.setValue(NSNumber(value: 8), forKey: "loadState")
            be.perform(NSSelectorFromString("bufferingSomeSecond"))
            bc.nextButton.sendActions(for: .touchUpInside)
            _ = await until { buffering.session.index == 1 && be.isPlaying }
            bc.playButton.sendActions(for: .touchUpInside)
            check("next-episode-paused-before-old-buffer-retry", !be.isPlaying)
            await wait(3.5)
            check("old-buffer-retry-respects-paused-next-episode", !be.isPlaying)
            // A same-item manual pause must also cancel retries after load recovers.
            bc.playButton.sendActions(for: .touchUpInside)
            func stall() {
                be.setValue(NSNumber(value: 8), forKey: "loadState")
                be.perform(NSSelectorFromString("bufferingSomeSecond"))
            }
            stall()
            check("buffering-retains-play-intent", be.isPlaying && (be.player?.rate ?? -1) == 0)
            bc.playButton.sendActions(for: .touchUpInside)
            be.setValue(NSNumber(value: 2), forKey: "loadState")
            await wait(3.3)
            check("buffer-retry-respects-same-item-pause", !be.isPlaying && (be.player?.rate ?? -1) == 0)
            bc.playButton.sendActions(for: .touchUpInside)
            stall()
            let recoveredBuffer = await until { (be.player?.rate ?? -1) > 0 }
            check("buffer-retry-recovers-when-play-intended", recoveredBuffer && be.isPlaying)
            stall()
            NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
            await wait(3.3)
            check("buffer-retry-respects-background-pause", !be.isPlaying && (be.player?.rate ?? -1) == 0)
            bc.playButton.sendActions(for: .touchUpInside)
            stall()
            buffering.closePlayer(); await wait(3.3)
            check("buffer-retry-after-close-does-not-recreate-player", be.player == nil && !be.isPlaying)

            // Exercise both landscape directions, an already-landscape home, and a
            // close while a rotation request or episode sheet is still in flight.
            for scenario in ["left-landscape", "landscape-home", "rotate-immediately-close", "close-with-episode-picker"] {
                let landscapeHome = scenario == "landscape-home"
                let entry: UIInterfaceOrientation = landscapeHome ? .landscapeRight : .portrait
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscapeHome ? .landscapeRight : .portrait))
                let entryReady = await until { scene.interfaceOrientation == entry }
                check(scenario + "-entry-orientation", entryReady)
                let returning = PlayerController(session: session(), origin: origin, cookies: [])
                var closeCount = 0
                returning.onClose = { closeCount += 1 }
                returning.modalPresentationStyle = .fullScreen
                host.present(returning, animated: false); await wait()
                let returningControls = try testRequire(descendants(returning.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing controls: returning")
                if scenario == "rotate-immediately-close" {
                    returningControls.rotateButton.sendActions(for: .touchUpInside)
                } else {
                    let target: UIInterfaceOrientation = landscapeHome ? .portrait : .landscapeLeft
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscapeHome ? .portrait : .landscapeLeft))
                    let rotated = await until { scene.interfaceOrientation == target }
                    check(scenario + "-player-rotated", rotated)
                }
                if scenario == "close-with-episode-picker" {
                    returningControls.episodesButton.sendActions(for: .touchUpInside)
                    await wait(0.5)
                }
                returning.closePlayer()
                let returned = await until { closeCount == 1 && host.presentedViewController == nil && scene.interfaceOrientation == entry }
                await wait(0.5) // A late geometry callback must not undo the restoration.
                check(scenario + "-restores-home-orientation", returned && scene.interfaceOrientation == entry && (host.view.bounds.width > host.view.bounds.height) == landscapeHome)
                check(scenario + "-closes-once", closeCount == 1)
                if scenario == "close-with-episode-picker" { check("closing-player-removes-episode-pane", returning.children.isEmpty) }
                if host.presentedViewController != nil { host.dismiss(animated: false); await wait() }
            }

            // A committed slider or horizontal pan seek must survive immediate
            // episode replacement or dismissal, before AVPlayer updates its clock.
            for seekKind in ["slider", "pan"] {
                let jumping = PlayerController(session: session(), origin: origin, cookies: [])
                var jumpEvents: [[String: Any]] = []
                jumping.onProgress = { jumpEvents.append($0) }
                jumping.modalPresentationStyle = .fullScreen
                host.present(jumping, animated: false); await wait()
                let jc = try testRequire(descendants(jumping.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing controls: jumping")
                let jcPlayer = try testRequire(jc.player, "Missing player: jc")
                let je = try testRequire(jcPlayer.currentPlayerManager as? ZFAVPlayerManager, "Unexpected player manager: jc")
                _ = await until { je.isPlaying }; jc.playButton.sendActions(for: .touchUpInside)
                var target = 12.0
                if seekKind == "slider" {
                    jc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.6)
                } else {
                    target = je.currentTime + 5
                    jc.gestureBeganPan(jcPlayer.gestureControl, panDirection: .H, panLocation: .left)
                    jc.gestureChangedPan(jcPlayer.gestureControl, panDirection: .H, panLocation: .left, withVelocity: CGPoint(x: 1000, y: 0))
                    jc.gestureEndedPan(jcPlayer.gestureControl, panDirection: .H, panLocation: .left)
                }
                jc.nextButton.sendActions(for: .touchUpInside)
                let saved = jumpEvents.last { ($0["index"] as? Int) == 0 && ($0["reason"] as? String) == "pause" }?["position"] as? Double ?? -1
                check(seekKind + "-immediate-switch-saves-target", abs(saved - target) < 0.1)
                _ = await until { jumping.session.index == 1 && je.isPlaying }
                jc.previousButton.sendActions(for: .touchUpInside)
                let resumed = await until { jumping.session.index == 0 && je.isPlaying }
                check(seekKind + "-switch-back-restores-target", resumed && je.currentTime >= target - 0.1 && je.currentTime < target + 2)
                // A completed seek must stop masking the live clock.
                jc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.5)
                await wait(0.8)
                jc.playButton.sendActions(for: .touchUpInside)
                let advanced = jumpEvents.last?["position"] as? Double ?? -1
                check(seekKind + "-completed-seek-progress-advances", advanced > 10.3 && advanced < 13)
                jc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.3)
                jc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.65)
                je.pause()
                await wait(0.3)
                check(seekKind + "-replacement-seek-survives-pause", abs(je.currentTime - 13) < 0.1 && !je.isPlaying)
                jc.portraitControlView.slider.delegate?.sliderTouchEnded?(0.7)
                jumping.closePlayer()
                check(seekKind + "-immediate-close-saves-target", abs((jumpEvents.last?["position"] as? Double ?? -1) - 14) < 0.1)
                await wait(0.7)
            }

            // Expire the timer synchronously after ready starts a resume seek.
            // Test initial open and switching episodes, with both an immediate play
            // request and a play request after the seek has finished while paused.
            for targetIndex in [0, 1] {
                for immediatePlay in [false, true] {
                    var deadlineNow = Date(timeIntervalSince1970: 2000)
                    let deadline = SleepTimer(now: { deadlineNow })
                    let timed = PlayerController(session: session(), origin: origin, cookies: [], sleepTimer: deadline)
                    timed.loadViewIfNeeded()
                    let tc = try testRequire(Mirror(reflecting: timed).children.first { $0.label == "controls" }?.value as? HomeTVPlayerControls, "Missing or invalid reflected controls: timed")
                    let tcPlayer = try testRequire(tc.player, "Missing player: tc")
                    let te = try testRequire(tcPlayer.currentPlayerManager as? ZFAVPlayerManager, "Unexpected player manager: tc")
                    var injected = false
                    var pausedAtDeadline = false
                    let observation = te.observe(\.assetURL, options: [.new]) { _, _ in
                        guard te.assetURL != nil, timed.session.index == targetIndex, !injected else { return }
                        let original = tcPlayer.playerReadyToPlay
                        tcPlayer.playerReadyToPlay = { asset, url in
                            original?(asset, url)
                            injected = true
                            deadline.set(minutes: 1); deadlineNow += 60
                            tc.playButton.sendActions(for: .touchUpInside)
                            pausedAtDeadline = !te.isPlaying && (te.player?.rate ?? 0) == 0 && !timed.session.autoplayNext
                            if immediatePlay { tc.playButton.sendActions(for: .touchUpInside) }
                        }
                    }
                    timed.modalPresentationStyle = .fullScreen
                    host.present(timed, animated: false)
                    if targetIndex == 1 {
                        _ = await until { te.isPlaying }
                        tc.nextButton.sendActions(for: .touchUpInside)
                    }
                    _ = await until { injected }; await wait(0.5)
                    let prefix = "sleep-during-resume-episode-\(targetIndex)-immediate-\(immediatePlay)"
                    check(prefix + "-stops", pausedAtDeadline && (immediatePlay || !te.isPlaying))
                    if !immediatePlay { tc.playButton.sendActions(for: .touchUpInside) }
                    let playing = await until { te.isPlaying && (te.player?.rate ?? -1) > 0 }
                    let start = targetIndex == 0 ? 4.0 : 2.0
                    await wait(0.3)
                    check(prefix + "-manual-resume", playing && te.currentTime > start && te.currentTime < start + 3)
                    timed.closePlayer(); await wait(0.7); observation.invalidate()
                }
            }

            // Deadline races use the real engine and controls with an injected clock.
            // Keep these 38 boundary checks in the default integration suite; the
            // separate one-minute suite verifies actual unattended wall-clock timing.
            for scenario in ["switch-before", "switch-at", "end-at", "late-end", "rotate-asleep", "background-expiry", "background-asleep"] {
                let prefix = "sleep-boundary-" + scenario
                var clock = Date(timeIntervalSince1970: 5000)
                let deadline = SleepTimer(now: { clock })
                let tested = PlayerController(session: session(), origin: origin, cookies: [], sleepTimer: deadline)
                var boundaryEvents: [[String: Any]] = []
                tested.onProgress = { boundaryEvents.append($0) }
                tested.modalPresentationStyle = .fullScreen
                host.present(tested, animated: false)
                await wait()
                let c = try testRequire(descendants(tested.view).compactMap { $0 as? HomeTVPlayerControls }.first, "Missing sleep boundary controls")
                let z = try testRequire(c.player, "Missing sleep boundary player")
                let e = try testRequire(z.currentPlayerManager as? ZFAVPlayerManager, "Missing sleep boundary engine")
                let ready = await until { e.isPlaying && e.currentTime >= 4 }
                check(prefix + "-ready", ready)
                let oldEnd = try testRequire(z.playerDidToEnd, "Missing episode-end callback: " + scenario)
                deadline.set(minutes: 1)
                if scenario == "switch-before" {
                    c.nextButton.sendActions(for: .touchUpInside)
                    let switched = await until { tested.session.index == 1 && e.isPlaying }
                    check(prefix + "-deadline-survives-switch", switched && deadline.minutesRemaining == 1)
                }
                if scenario == "background-expiry" {
                    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
                    check(prefix + "-paused-before-deadline", !e.isPlaying)
                }
                clock += 60
                if scenario == "switch-at" { c.nextButton.sendActions(for: .touchUpInside) }
                else if scenario == "end-at" { oldEnd(e) }
                else { NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil) }
                _ = await until { boundaryEvents.contains { $0["reason"] as? String == "sleep" } }
                await wait(0.3)
                if scenario == "late-end" { oldEnd(e) }
                if scenario == "rotate-asleep" {
                    for mask: UIInterfaceOrientationMask in [.landscapeRight, .portrait] {
                        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
                        let rotated = await until { mask == .portrait ? scene.interfaceOrientation == .portrait : scene.interfaceOrientation == .landscapeRight }
                        check(prefix + "-orientation-" + String(mask.rawValue), rotated && e.player == nil && !e.isPlaying && !UIApplication.shared.isIdleTimerDisabled)
                    }
                }
                if scenario.hasPrefix("background") {
                    for _ in 0..<2 {
                        NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
                        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
                    }
                }
                e.play()
                await wait(0.4)
                check(prefix + "-no-restart", !e.isPlaying && e.player == nil && !UIApplication.shared.isIdleTimerDisabled)
                check(prefix + "-no-autonext", tested.session.index == (scenario == "switch-before" ? 1 : 0) && !tested.session.autoplayNext)
                check(prefix + "-single-sleep", boundaryEvents.filter { $0["reason"] as? String == "sleep" }.count == 1)
                // Explicit episode selection after stopping is intentional playback.
                c.nextButton.sendActions(for: .touchUpInside)
                if scenario != "switch-before" {
                    let resumed = await until { tested.session.index == 1 && e.isPlaying }
                    check(prefix + "-explicit-next-works", resumed && UIApplication.shared.isIdleTimerDisabled)
                }
                tested.closePlayer()
                let dismissed = await until { host.presentedViewController == nil }
                let portrait = await until { scene.interfaceOrientation == .portrait }
                _ = try testRequire(dismissed && portrait ? true : nil, "Sleep boundary cleanup failed: " + scenario)
            }

        } catch {
            aborted = true
            failures.append("harness-prerequisite")
            failureDetails.append(String(describing: error))
            print("PLAYER_HARNESS_FAILURE: \(error)")
        }
        do { try writeReport("player-integration.json") }
        catch {
            FileHandle.standardError.write(Data("PLAYER_REPORT_ERROR: \(error)\n".utf8))
            return
        }
        print("PLAYER_INTEGRATION_DONE failures=\(failures.count)")
        fflush(stdout)
    }
}
