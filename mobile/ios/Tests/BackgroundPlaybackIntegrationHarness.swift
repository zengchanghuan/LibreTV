import UIKit
import AVFoundation
import AVKit
import MediaPlayer
import WebKit

/// Real player/presentation tests in an isolated simulator bundle, never production.
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
            print("PLAYER_CHECK \(name): \(passed)"); fflush(stdout); try? report("player-progress.json")
        }
        func wait(_ seconds: Double = 0.25) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        func until(_ seconds: Double = 12, _ condition: () -> Bool) async -> Bool {
            for _ in 0..<Int(seconds * 10) { if condition() { return true }; await wait(0.1) }; return false
        }
        @MainActor func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
        @MainActor func snapshot(_ name: String) throws {
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                for surface in scene.windows.sorted(by: { $0.windowLevel.rawValue < $1.windowLevel.rawValue }) where !surface.isHidden {
                    surface.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                }
            }
            try image.pngData()?.write(to: output.appendingPathComponent(name + ".png"))
        }
        func session(_ id: String, rate: Float = 0.5) -> PlaybackSession {
            PlaybackSession(id: id, title: "后台播放测试 · 合成短片", sourceKey: "fixture", vodId: id, sourceUrl: nil, profileId: nil, index: 0, episodes: [Episode(url: "http://127.0.0.1:18085/video.mp4?" + id, title: "测试影片", position: 0)], rate: rate, autoplayNext: false, baseRevision: 0, openedAt: 1)
        }
        do {
            let host = try testRequire(window.rootViewController, "Host")
            _ = await until { host.viewIfLoaded?.window != nil }
            UserDefaults.standard.removeObject(forKey: "playback.backgroundMode")
            check("default-is-pip-with-background-audio", BackgroundPlaybackMode.current == .pictureInPicture)
            check("background-audio-capability-enabled", (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("audio") == true)
            var now = Date(); let timer = SleepTimer(now: { now })
            let controller = PlayerController(session: session("first"), origin: URL(string: "http://127.0.0.1:18085")!, cookies: [], sleepTimer: timer)
            var events: [[String: Any]] = []; controller.onProgress = { events.append($0) }
            let coordinator = PlaybackCoordinator.shared
            coordinator.start(controller, from: host)
            _ = await until { controller.isViewLoaded && controller.isPlaybackRunning }
            let controls = try testRequire(Mirror(reflecting: controller).children.first { $0.label == "controls" }?.value as? HomeTVPlayerControls, "Controls")
            let engine = try testRequire(controls.player?.currentPlayerManager as? HomeTVPlayerManager, "Engine")
            let avPlayer = try testRequire(engine.player, "AVPlayer")
            check("player-starts-and-publishes-lock-screen-info", engine.isPlaying && MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyTitle] as? String == controller.session.title)
            check("remote-controls-registered", MPRemoteCommandCenter.shared().playCommand.isEnabled && MPRemoteCommandCenter.shared().skipForwardCommand.isEnabled)
            controls.backButton.sendActions(for: .touchUpInside)
            let minimized = await until { controller.parent != nil && host.presentedViewController == nil }
            check("back-minimizes-without-replacing-player", minimized && coordinator.current === controller && engine.player === avPlayer)
            let before = engine.currentTime; await wait(1)
            check("mini-video-keeps-playing", engine.currentTime > before + 0.1 && engine.isPlaying)
            check("mini-releases-screen-awake-lock", !UIApplication.shared.isIdleTimerDisabled)
            try snapshot("background-mini-portrait")
            let overlay = try testRequire(scene.windows.first { $0 !== window && !$0.isHidden && descendants($0).contains(where: { $0.accessibilityIdentifier == "player.mini" }) }, "Mini window")
            check("mini-window-passes-outside-touches-through", overlay.hitTest(CGPoint(x: 2, y: 2), with: nil) == nil)
            let miniPlay = try testRequire(descendants(overlay).compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "player.mini.play" }, "Mini play")
            miniPlay.sendActions(for: .touchUpInside); await wait()
            check("mini-pause-stops-playback", !engine.isPlaying && engine.player?.rate == 0)
            NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil); await wait()
            check("foreground-does-not-undo-user-pause", !engine.isPlaying)
            miniPlay.sendActions(for: .touchUpInside); _ = await until { engine.isPlaying }
            coordinator.expand(controller)
            let expanded = await until { controller.presentingViewController != nil && controller.parent == nil }
            check("expand-reuses-player-and-rate", expanded && engine.player === avPlayer && controller.session.rate == 0.5)
            await wait(0.7)
            check("expanded-player-is-visible", controller.view.window === window && controller.view.bounds.size == window.bounds.size && !controls.isHidden)
            if !controls.controlViewAppeared, let gesture = controls.player?.gestureControl { controls.gestureSingleTapped(gesture) }
            try snapshot("background-player-portrait")
            controller.minimizePlayer(); _ = await until { controller.parent != nil }; await wait(0.5)
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight))
            _ = await until { scene.interfaceOrientation == .landscapeRight }; await wait(0.5)
            try snapshot("background-mini-landscape")
            let landscapeOverlay = try testRequire(scene.windows.first { $0 !== window && !$0.isHidden && descendants($0).contains(where: { $0.accessibilityIdentifier == "player.mini" }) }, "Landscape mini window")
            let miniCard = try testRequire(descendants(landscapeOverlay).first { $0.accessibilityIdentifier == "player.mini" }, "Mini card")
            check("mini-fits-landscape-safe-area", landscapeOverlay.bounds.inset(by: landscapeOverlay.safeAreaInsets).contains(miniCard.convert(miniCard.bounds, to: landscapeOverlay)))
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
            _ = await until { scene.interfaceOrientation == .portrait }; await wait(0.5)
            let web = try testRequire(descendants(host.view).compactMap { $0 as? WKWebView }.first, "Browser web view")
            _ = try await web.evaluateJavaScript("window.webkit.messageHandlers.libretvNative.postMessage({type:'close',sessionId:'first'});true")
            await wait()
            check("web-page-unmount-preserves-mini-session", coordinator.current === controller && engine.player === avPlayer && controller.parent != nil && engine.isPlaying)
            var reopened = try testRequire(try JSONSerialization.jsonObject(with: JSONEncoder().encode(controller.session)) as? [String: Any], "Reopened session")
            reopened["id"] = "reopened"; reopened["rate"] = 1.5
            let openMessage = try JSONSerialization.data(withJSONObject: ["type": "open", "session": reopened])
            let openJSON = try testRequire(String(data: openMessage, encoding: .utf8), "Open JSON")
            _ = try await web.evaluateJavaScript("window.webkit.messageHandlers.libretvNative.postMessage(\(openJSON));true")
            let rebound = await until { controller.session.id == "reopened" && controller.presentingViewController != nil }
            await wait(0.7)
            check("reopening-same-film-reuses-live-session", rebound && coordinator.current === controller && engine.player === avPlayer && controller.session.rate == 0.5)
            // Incoming calls can resume only if the OS permits it and no user pause intervened.
            NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil, userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
            check("interruption-pauses", !engine.isPlaying)
            controller.pausePlayback()
            NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil, userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue, AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue])
            check("manual-pause-during-call-prevents-resume", !engine.isPlaying)
            controller.togglePlayback(); await wait()
            NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil, userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
            NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil, userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue, AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue])
            check("permitted-interruption-resumes", engine.isPlaying)
            NotificationCenter.default.post(name: AVAudioSession.routeChangeNotification, object: nil, userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue]); await wait()
            check("headphone-disconnect-stays-paused", !engine.isPlaying)
            controller.togglePlayback(); await wait()
            // Actual simulator app switching is performed by the runner after this marker.
            for mode in [BackgroundPlaybackMode.audio, .pictureInPicture] {
                BackgroundPlaybackMode.current = mode
                let suffix = mode.rawValue
                var enteredBackground = false, returned = false, backgroundPosition = 0.0
                var returnedAt = Date()
                let bg = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
                    MainActor.assumeIsolated {
                        enteredBackground = true; backgroundPosition = avPlayer.currentTime().seconds
                        check("entered-real-background-" + suffix, true)
                    }
                }
                let fg = NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
                    MainActor.assumeIsolated { if enteredBackground { returned = true; returnedAt = Date() } }
                }
                check("ready-for-real-background-" + suffix, true)
                let roundTrip = await until(25) { enteredBackground && returned }
                NotificationCenter.default.removeObserver(bg); NotificationCenter.default.removeObserver(fg)
                _ = await until { UIApplication.shared.applicationState == .active }; await wait(0.8)
                // Use AVPlayer's playback clock, as production progress does.
                // The vendor's currentTime reads AVPlayerItem's rendering clock,
                // which can remain stale while the video layer is detached.
                // Subtract ALL foreground advancement so foreground-only playback fails.
                let advanced = avPlayer.currentTime().seconds - backgroundPosition
                let foregroundAllowance = Date().timeIntervalSince(returnedAt) * Double(controller.session.rate)
                check("real-background-keeps-advancing-" + suffix, roundTrip && advanced > foregroundAllowance + 0.6)
                results["background-media-seconds-" + suffix] = advanced - foregroundAllowance
                check("foreground-restores-video-layer-" + suffix, engine.avPlayerLayer?.player === engine.player)
            }
            BackgroundPlaybackMode.current = .pause
            NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
            check("pause-mode-stops-on-background", !engine.isPlaying)
            NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
            BackgroundPlaybackMode.current = .pictureInPicture; controller.togglePlayback()
            // Exercise actual AVKit PiP when the simulator exposes it; report otherwise.
            let possible = await until(5) { controller.isPictureInPictureActive || (Mirror(reflecting: controller).children.first { $0.label == "pip" }?.value as? AVPictureInPictureController)?.isPictureInPicturePossible == true }
            if possible {
                if !controller.isPictureInPictureActive { controls.pipButton.sendActions(for: .touchUpInside) }
                let active = await until { controller.isPictureInPictureActive }
                check("system-pip-starts", active)
                if active, let pip = Mirror(reflecting: controller).children.first(where: { $0.label == "pip" })?.value as? AVPictureInPictureController {
                    let same = engine.player
                    var restored = false
                    controller.pictureInPictureController(pip, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler: { restored = $0 })
                    _ = await until { restored }; pip.stopPictureInPicture()
                    _ = await until { !controller.isPictureInPictureActive }
                    check("pip-restore-preserves-session", restored && coordinator.current === controller && engine.player === same && !controller.hasStopped)
                }
            } else { results["pip-runtime-note"] = "Simulator did not make PiP available; device verification required" }
            controller.minimizePlayer(); _ = await until { controller.parent != nil }
            timer.set(minutes: 1); now += 61
            _ = await until { engine.player == nil }
            check("sleep-timer-stops-mini-and-preserves-progress", engine.player == nil && events.contains { $0["reason"] as? String == "sleep" } && !controller.hasStopped)
            NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil); engine.play(); await wait()
            check("late-play-cannot-restart-expired-session", engine.player == nil && !engine.isPlaying)
            controller.togglePlayback(); _ = await until { engine.isPlaying }
            check("explicit-play-after-sleep-restarts", engine.isPlaying)
            // Replacing a minimized session must stop its decoder and save its progress.
            let second = PlayerController(session: session("second"), origin: URL(string: "http://127.0.0.1:18085")!, cookies: [])
            coordinator.start(second, from: host)
            let replaced = await until { coordinator.current === second && second.isPlaybackRunning }
            check("new-film-stops-old-session", replaced && controller.hasStopped && engine.player == nil && events.last?["reason"] as? String == "close")
            second.minimizePlayer(); _ = await until { second.parent != nil }
            second.closePlayer(); _ = await until { coordinator.current == nil }
            check("explicit-close-removes-mini-and-system-controls", coordinator.current == nil && second.hasStopped && MPNowPlayingInfoCenter.default().nowPlayingInfo == nil && !MPRemoteCommandCenter.shared().playCommand.isEnabled)
            check("close-never-reenables-screen-awake", !UIApplication.shared.isIdleTimerDisabled)
            let settings = BackgroundPlaybackSettingsController(); host.present(UINavigationController(rootViewController: settings), animated: false)
            await wait(); try snapshot("background-settings")
            check("settings-default-restored", BackgroundPlaybackMode.current == .pictureInPicture)
            host.dismiss(animated: false)
        } catch { failures.append("harness-prerequisite"); details.append(String(describing: error)) }
        do { try report("player-integration.json") } catch { print("PLAYER_REPORT_ERROR: \(error)") }
        print("PLAYER_INTEGRATION_DONE failures=\(failures.count)"); fflush(stdout)
    }
}
