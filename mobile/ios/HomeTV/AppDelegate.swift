import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        OfflineDownloads.shared.handleBackground(identifier, completion: completionHandler)
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Main", sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        PlaybackLogStore.shared.record("app-launch", fields: [
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
            "os": UIDevice.current.systemVersion
        ])
        let window = UIWindow(windowScene: scene)
        window.rootViewController = BrowserController()
        window.makeKeyAndVisible(); self.window = window
    }
    func sceneDidEnterBackground(_ scene: UIScene) {
        PlaybackLogStore.shared.record("scene-background")
        var task = UIBackgroundTaskIdentifier.invalid
        let finish = {
            guard task != .invalid else { return }
            UIApplication.shared.endBackgroundTask(task); task = .invalid
        }
        task = UIApplication.shared.beginBackgroundTask(withName: "Flush playback diagnostics", expirationHandler: finish)
        PlaybackLogStore.shared.flush(completion: finish)
    }
}
