import UIKit
import AVFoundation

/// Copied into an isolated app by run-player-integration.py, never into HomeTV.
@MainActor func runPlayerIntegration(window: UIWindow, scene: UIWindowScene) {
    Task { @MainActor in
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        var results: [String: Any] = [:]
        var failures: [String] = []
        func wait(_ seconds: Double = 0.3) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        func check(_ name: String, _ value: Bool) { results[name] = value; if !value { failures.append(name) }; print("PLAYER_CHECK \(name): \(value)") }
        func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
        func until(_ condition: () -> Bool) async -> Bool {
            for _ in 0..<100 { if condition() { return true }; await wait(0.1) }; return false
        }
        func snapshot(_ name: String) {
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            try? image.pngData()?.write(to: output.appendingPathComponent(name + ".png"))
        }
        func session(_ path: String = "/video.mp4", autoplay: Bool = true) -> PlaybackSession {
            PlaybackSession(id: UUID().uuidString, title: "HomeTV 播放器验收 · 横竖屏与续播", sourceKey: "fixture", vodId: "player", sourceUrl: nil, profileId: nil, index: 0,
              episodes: [Episode(url: "http://127.0.0.1:18085" + path, title: "第一集", position: 4), Episode(url: "http://127.0.0.1:18085/video.mp4?second", title: "第二集", position: 2)],
              rate: 1.5, autoplayNext: autoplay, baseRevision: 0, openedAt: 1)
        }
        let host = window.rootViewController!
        var now = Date(timeIntervalSince1970: 1000)
        let timer = SleepTimer(now: { now })
        let controller = PlayerController(session: session(), origin: URL(string: "http://127.0.0.1:18085")!, cookies: [], sleepTimer: timer)
        var events: [[String: Any]] = []
        controller.onProgress = { events.append($0) }
        controller.modalPresentationStyle = .fullScreen
        host.present(controller, animated: false)
        await wait()
        let controls = descendants(controller.view).compactMap { $0 as? HomeTVPlayerControls }.first!
        let engine = controls.player!.currentPlayerManager as! ZFAVPlayerManager
        check("uses-ZFPlayer-engine-and-controls", engine.view.superview != nil && controls.superview != nil)
        let ready = await until { engine.isPlaying && engine.currentTime >= 4 }
        check("restores-position-before-autoplay", ready && engine.currentTime < 8)
        check("restores-playback-rate", abs(engine.player.rate - 1.5) < 0.01)
        controls.playButton.sendActions(for: .touchUpInside)
        check("pause-button", !engine.isPlaying && events.last?["reason"] as? String == "pause")
        // Put a long title on-screen and exercise the actual rotation button.
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)); await wait(1)
        if !controls.controlViewAppeared { controls.gestureSingleTapped(controls.player!.gestureControl) }
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
        controls.gestureSingleTapped(controls.player!.gestureControl); await wait()
        check("tap-shows-controls", controls.controlViewAppeared && controls.playButton.superview?.alpha == 1)
        controls.gestureDoubleTapped(controls.player!.gestureControl)
        check("double-tap-resumes", engine.isPlaying)
        controls.gestureDoubleTapped(controls.player!.gestureControl)
        check("double-tap-pauses", !engine.isPlaying)
        engine.seek(toTime: 10, completionHandler: nil); await wait()
        check("seek-while-paused", abs(engine.currentTime - 10) < 0.5 && !engine.isPlaying)
        controls.nextButton.sendActions(for: .touchUpInside)
        let second = await until { controller.session.index == 1 && engine.isPlaying && engine.currentTime >= 2 }
        check("next-episode-restores-own-position", second && engine.currentTime < 6 && abs(engine.player.rate - 1.5) < 0.01)
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
        await wait(1.2)
        check("sleep-deadline-stops-and-disables-autoplay", !engine.isPlaying && !controller.session.autoplayNext && events.last?["reason"] as? String == "sleep")
        controls.playButton.sendActions(for: .touchUpInside)
        engine.seek(toTime: 19.5, completionHandler: nil)
        let finalEnd = await until { !engine.isPlaying && events.last?["reason"] as? String == "ended" }
        check("last-episode-stops-at-end", finalEnd && controller.session.index == 1)
        controls.portraitControlView.sliderValueChanging?(0.5, false)
        engine.seek(toTime: 10, completionHandler: nil); await wait()
        controls.playButton.sendActions(for: .touchUpInside); await wait()
        check("seek-after-end-resumes-selected-position", engine.isPlaying && engine.currentTime >= 10 && engine.currentTime < 14)
        controller.closePlayer(); await wait(0.6)
        check("close-releases-player", engine.player == nil && host.presentedViewController == nil && !UIApplication.shared.isIdleTimerDisabled)

        let retryController = PlayerController(session: session("/fail.mp4", autoplay: false), origin: URL(string: "http://127.0.0.1:18085")!, cookies: [])
        retryController.modalPresentationStyle = .fullScreen
        host.present(retryController, animated: false); await wait()
        let retryControls = descendants(retryController.view).compactMap { $0 as? HomeTVPlayerControls }.first!
        let retryEngine = retryControls.player!.currentPlayerManager as! ZFAVPlayerManager
        let recovered = await until { retryEngine.isPlaying && retryEngine.currentTime >= 4 }
        check("proxy-fallback-restores-position", recovered && retryEngine.assetURL?.path == "/api/proxy" && retryEngine.currentTime < 8)
        retryController.closePlayer(); await wait(0.5)
        let failed = PlayerController(session: session("/always-fail.mp4"), origin: URL(string: "http://127.0.0.1:18085")!, cookies: [])
        var errors = 0
        failed.onProgress = { if $0["reason"] as? String == "error" { errors += 1 } }
        failed.modalPresentationStyle = .fullScreen
        host.present(failed, animated: false); await wait()
        let failControls = descendants(failed.view).compactMap { $0 as? HomeTVPlayerControls }.first!
        _ = await until { errors == 1 }
        check("failed-source-shows-retry", !failControls.failBtn.isHidden && errors == 1)
        failControls.failBtn.sendActions(for: .touchUpInside)
        let retried = await until { errors == 2 }
        check("retry-button-reloads-failed-source", retried && !failControls.failBtn.isHidden)
        failed.closePlayer(); await wait(0.5)
        results["failures"] = failures
        try? JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("player-integration.json"))
        print("PLAYER_INTEGRATION_DONE failures=\(failures.count)")
        fflush(stdout)
    }
}
