import UIKit
import WebKit

final class BrowserController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, UITabBarDelegate {
    private var web: WKWebView!
    private var origin: URL?
    private var player: PlayerController?
    private let status = UILabel()
    private let tabBar = UITabBar()
    private var tabBarHeight: NSLayoutConstraint!
    private let connectionStatus = UIStackView()
    private let retry = UIButton(type: .system)
    private var pending: [String: [String: Any]] = [:]
    private var storageKey: String { "native.pending." + (origin?.absoluteString ?? "") }

    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.applicationNameForUserAgent = "LibreTVNative/1"
        config.userContentController.add(self, name: "libretvNative")
        let bridge = """
        window.__LIBRETV_NATIVE__={version:1,platform:'ios',postMessage:m=>window.webkit.messageHandlers.libretvNative.postMessage(m)};
        window.dispatchEvent(new Event('libretv:native-ready'));
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge + "\n" + NativeNavigation.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self
        web.isOpaque = false; web.backgroundColor = .black
        tabBar.delegate = self
        tabBar.items = [UITabBarItem(title: "首页", image: UIImage(systemName: "house"), tag: 0), UITabBarItem(title: "直播", image: UIImage(systemName: "play.tv"), tag: 1), UITabBarItem(title: "设置", image: UIImage(systemName: "gearshape"), tag: 2)]
        tabBar.selectedItem = tabBar.items?.first
        let appearance = UITabBarAppearance(); appearance.configureWithOpaqueBackground()
        tabBar.standardAppearance = appearance; tabBar.scrollEdgeAppearance = appearance
        let bottomBackground = UIView(); bottomBackground.backgroundColor = .systemBackground
        status.textColor = .white; status.numberOfLines = 0; status.textAlignment = .center
        retry.setTitle("重试", for: .normal); retry.isHidden = true
        retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        retry.addTarget(self, action: #selector(reload), for: .touchUpInside)
        connectionStatus.axis = .vertical; connectionStatus.spacing = 12
        connectionStatus.addArrangedSubview(status); connectionStatus.addArrangedSubview(retry)
        for sub in [web!, connectionStatus, bottomBackground, tabBar] { sub.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(sub) }
        tabBarHeight = tabBar.heightAnchor.constraint(equalToConstant: 83)
        NSLayoutConstraint.activate([
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor), tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor), tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor), tabBarHeight,
            bottomBackground.topAnchor.constraint(equalTo: tabBar.topAnchor), bottomBackground.bottomAnchor.constraint(equalTo: view.bottomAnchor), bottomBackground.leadingAnchor.constraint(equalTo: view.leadingAnchor), bottomBackground.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: tabBar.topAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            connectionStatus.centerXAnchor.constraint(equalTo: web.centerXAnchor), connectionStatus.centerYAnchor.constraint(equalTo: web.centerYAnchor), connectionStatus.widthAnchor.constraint(lessThanOrEqualTo: web.widthAnchor, constant: -40)
        ])
        let saved = UserDefaults.standard.string(forKey: "serviceURL").flatMap(serviceOrigin)
        let bundled = (Bundle.main.object(forInfoDictionaryKey: "HomeTVServiceURL") as? String).flatMap(serviceOrigin)
        if let url = bundled ?? saved { connect(url) }
        else { status.text = "请先设置家庭服务的 HTTPS 地址" }
        NotificationCenter.default.addObserver(self, selector: #selector(flush), name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // A system tab bar includes the home-indicator inset in its own height.
        // Constraining it above that inset compresses its icon/title content.
        let fitted = tabBar.sizeThatFits(CGSize(width: view.bounds.width, height: 0)).height
        let height = max(49 + view.safeAreaInsets.bottom, fitted)
        if abs(tabBarHeight.constant - height) > 0.5 { tabBarHeight.constant = height }
    }
    private func connect(_ url: URL) {
        origin = url; UserDefaults.standard.set(url.absoluteString, forKey: "serviceURL")
        pending = UserDefaults.standard.data(forKey: storageKey).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: [String: Any]] } ?? [:]
        showHome(); retry.isHidden = true
        status.text = "正在连接…"; web.load(URLRequest(url: url))
    }
    private func showHome() {
        tabBar.selectedItem = tabBar.items?.first
    }
    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard let origin, let url = NativeNavigation.url(forTab: item.tag, origin: origin, currentURL: web.url, retrying: !retry.isHidden) else { return }
        retry.isHidden = true; status.text = "正在连接…"
        web.load(URLRequest(url: url))
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
        status.text = ""; retry.isHidden = true
        if let url = web.url { updateSelectedTab(url) }
        flush()
    }
    private func updateSelectedTab(_ url: URL) {
        guard let origin, let index = NativeNavigation.tabIndex(for: url, origin: origin),
              let items = tabBar.items, items.indices.contains(index) else { return }
        tabBar.selectedItem = items[index]
    }
    private func connectionFailed(_ error: Error) {
        let failure = error as NSError
        if failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled { return }
        let detail = "\(failure.domain) (\(failure.code)): \(failure.localizedDescription)"
        UserDefaults.standard.set(detail, forKey: "lastConnectionError")
        status.text = "连接失败：\(failure.localizedDescription)\n错误码 \(failure.code)"
        retry.isHidden = false
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { connectionFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { connectionFailed(error) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let origin, let frame = message.frameInfo.request.url, sameOrigin(frame, origin),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "ready" { flush(); return }
        if type == "navigation", let raw = body["url"] as? String, let url = URL(string: raw) {
            updateSelectedTab(url); return
        }
        if type == "ack", let id = body["eventId"] as? String {
            pending = pending.filter { $0.value["eventId"] as? String != id }; persist(); return
        }
        if type == "close", let id = body["sessionId"] as? String, player?.session.id == id { player?.closePlayer(); return }
        guard type == "open", player == nil, let raw = body["session"], JSONSerialization.isValidJSONObject(raw),
              let data = try? JSONSerialization.data(withJSONObject: raw), let session = try? JSONDecoder().decode(PlaybackSession.self, from: data), session.isValid(origin: origin) else { return }
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self, self.player == nil, self.origin == origin, self.web.url.map({ sameOrigin($0, origin) }) == true else { return }
            let controller = PlayerController(session: session, origin: origin, cookies: cookies)
            controller.onProgress = { [weak self] event in self?.record(event) }
            controller.onClose = { [weak self] in self?.player = nil }
            controller.modalPresentationStyle = .fullScreen; self.player = controller
            self.present(controller, animated: true)
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
