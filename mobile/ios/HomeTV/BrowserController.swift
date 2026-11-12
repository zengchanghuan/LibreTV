import UIKit
import WebKit

final class BrowserController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var web: WKWebView!
    private var origin: URL?
    private var player: PlayerController? { PlaybackCoordinator.shared.current }
    private var openRevision = UUID()
    private let status = UILabel()
    private let navigationBar = UINavigationBar()
    private let pageNavigationItem = UINavigationItem(title: "首页")
    private var navigationURL: URL?
    private let bottomBackground = UIView()
    private var darkTheme = UserDefaults.standard.object(forKey: "native.theme.dark") as? Bool ?? true
    override var preferredStatusBarStyle: UIStatusBarStyle { darkTheme ? .lightContent : .darkContent }
    private let tabBar = HomeTabBar()
    private var collectionSheetOpen = false
    private var tabBarHeight: NSLayoutConstraint!
    private var navigationBarHeight: NSLayoutConstraint!
    private var webBottomToTabs: NSLayoutConstraint!
    private var webBottomToSafeArea: NSLayoutConstraint!
    private var watchLayout = false
    private let connectionStatus = UIStackView()
    private let offlineButton = UIButton(type: .system)
    private let retry = UIButton(type: .system)
    private var pending: [String: [String: Any]] = [:]
    private var storageKey: String { "native.pending." + (origin?.absoluteString ?? "") }

    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.applicationNameForUserAgent = "LibreTVNative/1"
        config.userContentController.add(self, name: "libretvNative")
        let bridge = """
        window.__LIBRETV_NATIVE__={version:1,platform:'ios',watchLayout:true,postMessage:m=>window.webkit.messageHandlers.libretvNative.postMessage(m)};
        window.addEventListener('libretv:show-download-manager',e=>{e.stopImmediatePropagation();window.__LIBRETV_NATIVE__.postMessage({type:'downloads'});});
        window.addEventListener('libretv:add-download',e=>{e.stopImmediatePropagation();window.__LIBRETV_NATIVE__.postMessage({type:'download',url:e.detail?.url,title:e.detail?.title});});
        window.dispatchEvent(new Event('libretv:native-ready'));
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge + "\n" + NativeNavigation.script + "\n" + NativeNavigation.themeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self
        web.isOpaque = false; web.backgroundColor = .black
        navigationBar.accessibilityIdentifier = "browser.navigation"
        navigationBar.items = [pageNavigationItem]
        tabBar.onSelect = { [weak self] index in self?.selectTab(index) }
        status.textColor = .white; status.numberOfLines = 0; status.textAlignment = .center
        retry.setTitle("重试", for: .normal); retry.isHidden = true
        retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        retry.addTarget(self, action: #selector(reload), for: .touchUpInside)
        offlineButton.setTitle("我的缓存 · 离线观看", for: .normal)
        offlineButton.accessibilityIdentifier = "offline.open"
        offlineButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        offlineButton.addTarget(self, action: #selector(showDownloads), for: .touchUpInside)
        OfflineDownloads.shared.restore()
        connectionStatus.axis = .vertical; connectionStatus.spacing = 12
        connectionStatus.addArrangedSubview(status); connectionStatus.addArrangedSubview(retry); connectionStatus.addArrangedSubview(offlineButton)
        for sub in [web!, connectionStatus, bottomBackground, tabBar, navigationBar] { sub.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(sub) }
        tabBarHeight = tabBar.heightAnchor.constraint(equalToConstant: 83)
        navigationBarHeight = navigationBar.heightAnchor.constraint(equalToConstant: 44)
        webBottomToTabs = web.bottomAnchor.constraint(equalTo: tabBar.topAnchor)
        webBottomToSafeArea = web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        NSLayoutConstraint.activate([
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor), tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor), tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor), tabBarHeight,
            bottomBackground.topAnchor.constraint(equalTo: tabBar.topAnchor), bottomBackground.bottomAnchor.constraint(equalTo: view.bottomAnchor), bottomBackground.leadingAnchor.constraint(equalTo: view.leadingAnchor), bottomBackground.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            navigationBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), navigationBar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), navigationBar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor), navigationBarHeight,
            web.topAnchor.constraint(equalTo: navigationBar.bottomAnchor), webBottomToTabs, web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            connectionStatus.centerXAnchor.constraint(equalTo: web.centerXAnchor), connectionStatus.centerYAnchor.constraint(equalTo: web.centerYAnchor), connectionStatus.widthAnchor.constraint(lessThanOrEqualTo: web.widthAnchor, constant: -40)
        ])
        applyTheme(dark: darkTheme)
        let saved = UserDefaults.standard.string(forKey: "serviceURL").flatMap(serviceOrigin)
        let bundled = (Bundle.main.object(forInfoDictionaryKey: "HomeTVServiceURL") as? String).flatMap(serviceOrigin)
        if let url = bundled ?? saved { connect(url) }
        else { status.text = "请先设置家庭服务的 HTTPS 地址" }
        NotificationCenter.default.addObserver(self, selector: #selector(flush), name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let height = watchLayout || collectionSheetOpen ? 0 : 56 + view.safeAreaInsets.bottom
        if abs(tabBarHeight.constant - height) > 0.5 { tabBarHeight.constant = height }
    }
    private func setWatchLayout(_ enabled: Bool) {
        guard watchLayout != enabled else { return }
        watchLayout = enabled
        updateChrome()
        view.setNeedsLayout()
    }
    private func updateChrome() {
        let hiddenTabs = watchLayout || collectionSheetOpen
        let webHeader = navigationURL.flatMap { url in origin.map { NativeNavigation.usesWebHomeHeader(for: url, origin: $0) } } ?? false
        let hiddenHeader = watchLayout || collectionSheetOpen || webHeader
        navigationBar.isHidden = hiddenHeader; navigationBarHeight.constant = hiddenHeader ? 0 : 44
        tabBar.isHidden = hiddenTabs; bottomBackground.isHidden = hiddenTabs
        NSLayoutConstraint.deactivate([webBottomToTabs, webBottomToSafeArea])
        (hiddenTabs ? webBottomToSafeArea : webBottomToTabs)?.isActive = true
        view.setNeedsLayout()
    }
    private func applyTheme(dark: Bool) {
        darkTheme = dark
        UserDefaults.standard.set(dark, forKey: "native.theme.dark")
        let theme = NativeTheme(dark: dark)
        view.backgroundColor = theme.surface; view.tintColor = theme.accent
        bottomBackground.backgroundColor = theme.surface
        web.backgroundColor = theme.page; web.scrollView.backgroundColor = theme.page
        status.textColor = theme.content
        theme.apply(to: navigationBar)
        tabBar.apply(theme)
        setNeedsStatusBarAppearanceUpdate()
    }
    private func connect(_ url: URL) {
        origin = url; UserDefaults.standard.set(url.absoluteString, forKey: "serviceURL")
        pending = UserDefaults.standard.data(forKey: storageKey).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: [String: Any]] } ?? [:]
        showHome(); updateSelectedTab(url); retry.isHidden = true; offlineButton.isHidden = false
        status.text = "正在连接…"; web.load(URLRequest(url: url))
    }
    private func showHome() {
        tabBar.selectedIndex = 0
    }
    private func selectTab(_ index: Int) {
        guard let origin, let url = NativeNavigation.url(forTab: index, origin: origin, currentURL: web.url, retrying: !retry.isHidden) else { return }
        retry.isHidden = true; offlineButton.isHidden = false; status.text = "正在连接…"
        web.load(URLRequest(url: url))
    }
    @objc private func navigateBack() {
        guard let origin, let current = navigationURL ?? web.url,
              let destination = NativeNavigation.backURL(from: current, previous: web.backForwardList.backItem?.url, origin: origin) else { return }
        view.endEditing(true)
        if let previous = web.backForwardList.backItem, previous.url == destination { web.go(to: previous) }
        else { web.load(URLRequest(url: destination)) }
    }
    @objc private func showPlaybackSettings() {
        guard presentedViewController == nil else { return }
        present(UINavigationController(rootViewController: BackgroundPlaybackSettingsController()), animated: true)
    }
    @objc private func showDownloads() {
        guard presentedViewController == nil else { return }
        present(UINavigationController(rootViewController: OfflineDownloadsController()), animated: true)
    }
    private func download(url: URL, title: String) {
        guard let origin else { return }
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self, self.origin == origin else { return }
            do { try OfflineDownloads.shared.enqueue(url: url, title: title, origin: origin, cookies: cookies); self.showDownloads() }
            catch {
                let alert = UIAlertController(title: "无法下载", message: error.localizedDescription, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "好", style: .default)); self.present(alert, animated: true)
            }
        }
    }
    @objc private func reload() {
        if let origin { connect(origin) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = action.request.url, let origin else { decisionHandler(.cancel); return }
        if sameOrigin(target, origin) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && ["https", "http"].contains(target.scheme) { UIApplication.shared.open(target) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        status.text = ""; retry.isHidden = true; offlineButton.isHidden = true
        if let url = web.url { updateSelectedTab(url) }
        flush()
    }
    private func updateSelectedTab(_ url: URL) {
        guard let origin, let index = NativeNavigation.tabIndex(for: url, origin: origin) else { return }
        tabBar.selectedIndex = index
        collectionSheetOpen = false
        navigationURL = url
        setWatchLayout(NativeNavigation.usesWatchLayout(for: url, origin: origin))
        updateChrome()
        pageNavigationItem.rightBarButtonItem = url.path == "/settings" ? UIBarButtonItem(title: "播放器配置", style: .plain, target: self, action: #selector(showPlaybackSettings)) : nil
        if let page = NativeNavigation.page(for: url, origin: origin) {
            pageNavigationItem.title = page.title
            if page.parent != nil {
                let back = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), style: .plain, target: self, action: #selector(navigateBack))
                back.accessibilityLabel = "返回"
                back.accessibilityIdentifier = "browser.back"
                pageNavigationItem.leftBarButtonItem = back
            } else { pageNavigationItem.leftBarButtonItem = nil }
        }
    }
    private func connectionFailed(_ error: Error) {
        let failure = error as NSError
        if failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled { return }
        // Keep native navigation available if the web page cannot render its controls.
        collectionSheetOpen = false
        setWatchLayout(false)
        updateChrome()
        navigationBar.isHidden = false; navigationBarHeight.constant = 44
        let detail = "\(failure.domain) (\(failure.code)): \(failure.localizedDescription)"
        UserDefaults.standard.set(detail, forKey: "lastConnectionError")
        status.text = "连接失败：\(failure.localizedDescription)\n错误码 \(failure.code)"
        retry.isHidden = false; offlineButton.isHidden = false
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { connectionFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { connectionFailed(error) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let origin, let frame = message.frameInfo.request.url, sameOrigin(frame, origin),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "collectionSheet", let open = body["open"] as? Bool {
            collectionSheetOpen = open; updateChrome(); return
        }
        if type == "theme", let dark = body["dark"] as? Bool { applyTheme(dark: dark); return }
        if type == "downloads" { showDownloads(); return }
        if type == "download", let text = body["url"] as? String, let url = URL(string: text, relativeTo: origin)?.absoluteURL, let title = body["title"] as? String { download(url: url, title: title); return }
        if type == "ready" { flush(); return }
        if type == "navigation", let raw = body["url"] as? String, let url = URL(string: raw) {
            updateSelectedTab(url); return
        }
        if type == "ack", let id = body["eventId"] as? String {
            pending = pending.filter { $0.value["eventId"] as? String != id }; persist(); return
        }
        // The web panel sends close when it unmounts. Page navigation must not stop
        // the independently owned mini/background session.
        if type == "close", let id = body["sessionId"] as? String, player?.session.id == id { player?.persistPlaybackProgress(); return }
        guard type == "open", let raw = body["session"], JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw), let session = try? JSONDecoder().decode(PlaybackSession.self, from: data), session.isValid(origin: origin) else { return }
        openRevision = UUID(); let revision = openRevision
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self, self.openRevision == revision, self.origin == origin, self.web.url.map({ sameOrigin($0, origin) }) == true else { return }
            if let current = self.player, current.origin == origin, current.session.sourceKey == session.sourceKey,
               current.session.vodId == session.vodId, current.session.index == session.index,
               current.session.profileId == session.profileId, !current.hasStopped {
                current.rebindWebSession(session)
                PlaybackCoordinator.shared.expand(current)
                return
            }
            let controller = PlayerController(session: session, origin: origin, cookies: cookies)
            controller.onProgress = { [weak self] event in self?.record(event) }
            PlaybackCoordinator.shared.start(controller, from: self)
        }
    }
    private func record(_ event: [String: Any]) {
        guard let session = event["sessionId"] as? String, let index = event["index"] as? Int else { return }
        pending["\(session):\(index)"] = event
        persist(); send(event)
    }
    private func persist() { if let data = try? JSONSerialization.data(withJSONObject: pending) { UserDefaults.standard.set(data, forKey: storageKey) } }
    private func send(_ event: [String: Any]) {
        guard let origin, web.url.map({ sameOrigin($0, origin) }) == true,
              let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('libretv:native-progress',{detail:\(json)}))", completionHandler: nil)
    }
    @objc private func flush() {
        for event in pending.values.sorted(by: {
            let a = $0["openedAt"] as? Int64 ?? 0, b = $1["openedAt"] as? Int64 ?? 0
            return a == b ? ($0["sequence"] as? Int ?? 0) < ($1["sequence"] as? Int ?? 0) : a < b
        }) { send(event) }
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}
