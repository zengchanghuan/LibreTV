import UIKit
import AVFoundation
import WebKit

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
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
            _ = await until { scene.interfaceOrientation == .portrait && host.view.bounds.height > host.view.bounds.width }
            let browser = try testRequire(host as? BrowserController, "Missing browser host")
            let tabs = try testRequire(descendants(host.view).compactMap { $0 as? UITabBar }.first, "Missing native tabs")
            let web = try testRequire(descendants(host.view).compactMap { $0 as? WKWebView }.first, "Missing browser web view")
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
            check("four-tabs-portrait-layout", tabs.bounds.height >= 49 + host.view.safeAreaInsets.bottom && web.frame.maxY <= tabs.frame.minY + 1)
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            _ = await until { scene.interfaceOrientation == .landscapeRight }; await wait(0.5)
            snapshot("hd-tabs-landscape")
            check("four-tabs-landscape-layout", tabs.bounds.height >= 49 + host.view.safeAreaInsets.bottom && web.frame.maxY <= tabs.frame.minY + 1)
            browser.tabBar(tabs, didSelect: tabItems[3])
            let settingsLoaded = await until { !web.isLoading && web.url?.path == "/settings" && tabs.selectedItem?.tag == 3 }
            check("settings-after-hd-highlights-fourth-tab", settingsLoaded)
            browser.tabBar(tabs, didSelect: tabItems[0])
            _ = await until { !web.isLoading && tabs.selectedItem?.tag == 0 }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
            _ = await until { scene.interfaceOrientation == .portrait }; await wait(0.5)
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
            // Put a long title on-screen and exercise the actual rotation button.
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)); await wait(1)
            if !controls.controlViewAppeared { controls.gestureSingleTapped(controlsPlayer.gestureControl) }
            await wait()
            func layoutIsSafe() -> Bool {
                let safe = controller.view.safeAreaLayoutGuide.layoutFrame
                let buttons = [controls.backButton, controls.rotateButton, controls.previousButton, controls.playButton, controls.nextButton, controls.episodesButton, controls.speedButton, controls.sleepButton]
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
            check("speed-and-sleep-menus", controls.speedButton.menu?.children.count == 8 && controls.sleepButton.menu?.children.count == 7)
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
            let slept = await until { events.contains { $0["reason"] as? String == "sleep" } }
            check("sleep-deadline-stops-and-disables-autoplay", slept && !engine.isPlaying && !controller.session.autoplayNext)
            controls.playButton.sendActions(for: .touchUpInside)
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
            rc.episodesButton.sendActions(for: .touchUpInside); await wait(0.4)
            if let nav = rotation.presentedViewController as? UINavigationController, let table = nav.topViewController as? UITableViewController {
                rotation.tableView(table.tableView, didSelectRowAt: IndexPath(row: 1, section: 0))
                _ = await until { rotation.session.index == 1 && re.isPlaying }
                check("picker-selects-episode", rotation.session.index == 1 && re.currentTime >= 2 && re.currentTime < 6)
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
                            pausedAtDeadline = !te.isPlaying && (te.player?.rate ?? -1) == 0 && !timed.session.autoplayNext
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
